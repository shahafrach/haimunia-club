"use strict";
// ---- The club tab: feed, reactions, announcements, coach tools --------------------
//
// Shown only to a connected member of the club (src/connect.js says who that is). Reads
// what the backend lets a member read and calls its RPCs; the backend does the
// authorising, this file only decides what to show. Nothing from the private log is
// involved: the feed is other members' posts, and reacting sends a post id and a kind.
//
// Roles: owner and coach may post announcements, delete any post, remove members and
// rotate the join link (the coach cannot remove the owner or another coach; the server
// enforces it, the buttons just are not drawn). Members see announcements read-only.
//
// Classic script, one IIFE, exports window.haimuniaClub. Reads esc, bidiText,
// askAppConfirm, showToast, render from the shared scope, only inside function bodies.
(function () {
  var PAGE = 30;
  var KINDS = [
    { kind: "fist_bump", emoji: "👊", label: "אגרוף" },
    { kind: "fire", emoji: "🔥", label: "אש" },
    { kind: "clap", emoji: "👏", label: "מחיאות כפיים" },
  ];
  var ROLE_LABEL = { owner: "בעלים", coach: "מאמן/ת" };

  var C = {
    clubId: null,
    feed: { rows: [], loaded: false, loading: false, done: false, error: false },
    ann: { rows: [], loaded: false, loading: false, error: false },
    members: { rows: [], loaded: false, loading: false, error: false, open: false },
    postDraft: "", postPinned: false, annError: "", adminOpen: false,
    newLink: "", newCode: "", qr: "", linkCopied: false, codeCopied: false, busy: {},
  };

  function connect() { return window.haimuniaConnect; }
  function info() { return connect() ? connect().info() : { inClub: false }; }
  function available() { var i = info(); return !!(i.inClub && i.clubId); }
  function client() { return connect().getClient(); }
  function reset() {
    C.clubId = null; C.feed = { rows: [], loaded: false, loading: false, done: false, error: false };
    C.ann = { rows: [], loaded: false, loading: false, error: false };
    C.members = { rows: [], loaded: false, loading: false, error: false, open: false };
    C.postDraft = ""; C.postPinned = false; C.annError = ""; clearLink(); C.busy = {};
  }
  function again() { if (typeof render === "function" && typeof tab !== "undefined" && tab === "club") render(); }
  function toast(t) { if (typeof showToast === "function") showToast(t); }
  // A share that failed: the toast offers "שליחת משוב", which opens the feedback sheet on the club screen.
  function failToast(t) {
    if (typeof showToast !== "function") return;
    if (window.HaimuniaFeedback) showToast(t, { label: "שליחת משוב", run: function () { window.HaimuniaFeedback.open("club"); } });
    else showToast(t);
  }

  // ---- Loading ----------------------------------------------------------------------
  async function loadFeed(more) {
    var f = C.feed;
    if (f.loading || (more && f.done) || !available()) return;
    f.loading = true; f.error = false; again();
    try {
      var c = await client();
      var cursor = more && f.rows.length ? f.rows[f.rows.length - 1].published_at : null;
      var r = await c.rpc("circle_feed", { p_club_id: C.clubId, p_cursor: cursor, p_limit: PAGE });
      if (r.error) throw r.error;
      var page = Array.isArray(r.data) ? r.data : [];
      f.rows = more ? f.rows.concat(page) : page;
      f.done = page.length < PAGE; f.loaded = true;
    } catch (e) { f.error = true; }
    f.loading = false; again();
  }
  async function loadAnnouncements() {
    var a = C.ann;
    if (a.loading || !available()) return;
    a.loading = true; a.error = false;
    try {
      var c = await client();
      var r = await c.from("club_announcements").select("id,body,pinned,created_at")
        .eq("club_id", C.clubId).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(20);
      if (r.error) throw r.error;
      a.rows = r.data || []; a.loaded = true;
    } catch (e) { a.error = true; }
    a.loading = false; again();
  }
  async function loadMembers() {
    var m = C.members;
    if (m.loading || !available()) return;
    m.loading = true; m.error = false; again();
    try {
      var c = await client();
      var r = await c.from("circle_members").select("user_id,role,joined_at,profiles(display_name,emoji)")
        .eq("club_id", C.clubId).order("joined_at", { ascending: true });
      if (r.error) throw r.error;
      m.rows = (r.data || []).map(function (x) {
        return { user_id: x.user_id, role: x.role, name: (x.profiles && x.profiles.display_name) || "", emoji: (x.profiles && x.profiles.emoji) || "🙂" };
      });
      m.loaded = true;
    } catch (e) { m.error = true; }
    m.loading = false; again();
  }
  function ensureLoaded() {
    var i = info();
    if (C.clubId !== i.clubId) { reset(); C.clubId = i.clubId; }
    if (!C.feed.loaded && !C.feed.loading && !C.feed.error) setTimeout(function () { loadFeed(false); }, 0);
    if (!C.ann.loaded && !C.ann.loading && !C.ann.error) setTimeout(loadAnnouncements, 0);
  }
  function refresh() { C.feed.error = false; C.ann.error = false; C.feed.loaded = false; C.ann.loaded = false; C.members.loaded = false; again(); }

  // ---- Actions ----------------------------------------------------------------------
  function errText(e, fallback) {
    var m = String((e && e.message) || "");
    if (/rate_limited/.test(m)) return "יותר מדי פעמים להיום. אפשר לנסות שוב מאוחר יותר.";
    if (/not authorized/.test(m)) return "אין הרשאה לפעולה הזאת.";
    if (/failed to fetch|network/i.test(m)) return "אין חיבור כרגע. נסו שוב כשהחיבור חוזר.";
    return fallback;
  }
  function newKey() { try { return crypto.randomUUID(); } catch (e) { return null; } }

  async function react(postId, kind) {
    var row = C.feed.rows.find(function (r) { return r.post_id === postId; });
    if (!row || C.busy["r:" + postId + kind]) return;
    C.busy["r:" + postId + kind] = true;
    var mine = (row.my_reactions || []).slice(), origCounts = Object.assign({}, row.reaction_counts || {}), counts = Object.assign({}, origCounts);
    var had = mine.indexOf(kind) >= 0;
    // Optimistic, rolled back if the server says no.
    row.my_reactions = had ? mine.filter(function (k) { return k !== kind; }) : mine.concat(kind);
    counts[kind] = Math.max(0, (counts[kind] || 0) + (had ? -1 : 1));
    row.reaction_counts = counts;
    again();
    try {
      var c = await client();
      var args = { p_post_id: postId, p_kind: kind };
      var key = newKey(); if (key) args.p_idempotency_key = key;
      var r = await c.rpc("toggle_reaction", args);
      if (r.error) throw r.error;
    } catch (e) {
      row.my_reactions = mine; row.reaction_counts = origCounts;
      toast(errText(e, "התגובה לא נשמרה, נסו שוב"));
    }
    delete C.busy["r:" + postId + kind];
    again();
  }

  async function postAnnouncement(body, pinned) {
    var text = String(body || "").trim();
    if (!text) { C.annError = "כתבו משהו לפני הפרסום."; return again(); }
    if (text.length > 500) { C.annError = "ההודעה ארוכה מדי. אפשר עד 500 תווים."; return again(); }
    C.busy.ann = true; C.annError = ""; again();
    try {
      var c = await client();
      var r = await c.rpc("club_announcement_post", { p_club_id: C.clubId, p_body: text, p_pinned: !!pinned });
      if (r.error) throw r.error;
      C.postDraft = ""; C.postPinned = false; C.ann.loaded = false;
      toast("ההודעה פורסמה");
    } catch (e) { C.annError = errText(e, "הפרסום נכשל, נסו שוב"); }
    delete C.busy.ann; again();
    if (!C.ann.loaded) loadAnnouncements();
  }
  async function simpleRpc(name, args, okText, after) {
    try {
      var c = await client();
      var r = await c.rpc(name, args);
      if (r.error) throw r.error;
      if (okText) toast(okText);
      if (after) after(r.data);
    } catch (e) { toast(errText(e, "הפעולה נכשלה, נסו שוב")); }
    again();
  }
  function setPinned(id, pinned) {
    simpleRpc("club_announcement_set_pinned", { p_id: id, p_pinned: pinned }, null, function () { C.ann.loaded = false; loadAnnouncements(); });
  }
  // Q-37: the join link is short (#j=<8-character code>), with a QR of it and the code in large type, so a
  // member can scan it, tap it, or type the code into the installed app. rotate_club_invite (backend
  // 202611180002) returns {token, code} once; before that backend is live the long link still works.
  var CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;
  function clearLink() { C.newLink = ""; C.newCode = ""; C.qr = ""; C.linkCopied = false; C.codeCopied = false; }
  function setLink(token, code) {
    clearLink();
    var base = location.origin + location.pathname;
    if (typeof code === "string" && CODE_RE.test(code)) { C.newCode = code; C.newLink = base + "#j=" + code; }
    else if (typeof token === "string" && /^[0-9a-f]{64}$/.test(token)) C.newLink = base + "#join=" + token;
    if (!C.newLink) return;
    var link = C.newLink;
    loadQr().then(function () {
      if (C.newLink !== link) return;
      try { C.qr = qrSvg(link); } catch (e) { C.qr = ""; }
      again();
    }, function () {});
  }
  function missingFunction(err) { return !!err && (err.code === "PGRST202" || /could not find the function/i.test(String(err.message || ""))); }
  async function rotateLink() {
    try {
      var c = await client();
      var r = await c.rpc("rotate_club_invite", { p_club_id: C.clubId });
      if (r.error && missingFunction(r.error)) {
        r = await c.rpc("rotate_club_link", { p_club_id: C.clubId });
        if (r.error) throw r.error;
        setLink(r.data, "");
      } else {
        if (r.error) throw r.error;
        setLink(r.data && r.data.token, r.data && r.data.code);
      }
    } catch (e) { toast(errText(e, "הפעולה נכשלה, נסו שוב")); }
    again();
  }

  // The QR encoder (vendor/qrcode.js, qrcode-generator 1.4.4, MIT) loads only when staff makes a link.
  var qrPromise = null;
  function loadQr() {
    if (typeof window.qrcode === "function") return Promise.resolve();
    if (qrPromise) return qrPromise;
    qrPromise = new Promise(function (ok, no) {
      var s = document.createElement("script");
      s.src = "./vendor/qrcode.js";
      s.onload = function () { typeof window.qrcode === "function" ? ok() : no(); };
      s.onerror = function () { qrPromise = null; no(); };
      document.head.appendChild(s);
    });
    return qrPromise;
  }
  // Dark modules on a light ground in both schemes (a QR does not scan inverted on every phone), with the
  // four-module quiet zone the standard asks for.
  function qrSvg(text) {
    var q = window.qrcode(0, "M");
    q.addData(text);
    q.make();
    var n = q.getModuleCount(), quiet = 4, size = n + quiet * 2, d = "";
    for (var r = 0; r < n; r++) for (var col = 0; col < n; col++) if (q.isDark(r, col)) d += "M" + (col + quiet) + " " + (r + quiet) + "h1v1h-1z";
    return '<svg class="join-qr" viewBox="0 0 ' + size + " " + size + '" role="img" aria-label="קוד QR של קישור ההצטרפות" shape-rendering="crispEdges">' +
      '<rect class="join-qr-bg" width="' + size + '" height="' + size + '"/><path class="join-qr-fg" d="' + d + '"/></svg>';
  }
  function codeGroups(code) { return code.slice(0, 4) + " " + code.slice(4); }

  // Destructive actions go through the app's own confirm sheet.
  function askConfirm(opts) {
    askAppConfirm({
      title: opts.title, message: opts.message, confirmLabel: opts.confirmLabel, destructive: true,
      action: "club-action", payload: opts.payload, opener: null,
    });
  }
  function runConfirmed(p) {
    if (!p) return;
    if (p.op === "delete-post") {
      simpleRpc("post_delete", { post_id: p.id }, "הפוסט נמחק", function () {
        C.feed.rows = C.feed.rows.filter(function (r) { return r.post_id !== p.id; });
      });
    } else if (p.op === "delete-announcement") {
      simpleRpc("club_announcement_delete", { p_id: p.id }, "ההודעה נמחקה", function () {
        C.ann.rows = C.ann.rows.filter(function (r) { return r.id !== p.id; });
      });
    } else if (p.op === "remove-member") {
      simpleRpc("remove_member", { p_club_id: C.clubId, p_user_id: p.id }, "החבר/ה הוסר/ה", function () {
        C.members.rows = C.members.rows.filter(function (r) { return r.user_id !== p.id; });
        C.feed.loaded = false; C.feed.rows = []; C.feed.done = false;
      });
    } else if (p.op === "rotate") {
      rotateLink();
    }
  }

  // ---- Rendering --------------------------------------------------------------------
  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("he-IL", { day: "numeric", month: "short" });
  }
  function name(n) { return n ? bidiText(n) : "חבר/ה"; }

  // Q-43 (owner approved 2026-11-18): the tab reads top to bottom as pinned announcements, the feed, one
  // members row, and, for staff only, everything that changes the club behind "ניהול המועדון".
  function annCard(x, tools) {
    return '<div class="card" style="margin-bottom:10px;">' +
      (x.pinned ? '<div style="color:var(--steel); font-size:var(--fs-caption); font-weight:700; margin-bottom:4px;">📌 נעוץ</div>' : "") +
      '<div style="white-space:pre-wrap; font-size:var(--fs-2); line-height:1.55;" dir="auto">' + bidiText(x.body) + "</div>" +
      '<div style="color:var(--steel); font-size:var(--fs-caption); margin-top:6px;">' + esc(when(x.created_at)) + "</div>" + (tools || "") + "</div>";
  }
  // Decided by fixes, owner to confirm: the member view shows pinned announcements only; an unpinned one is
  // the coach's to pin or delete, under ניהול המועדון.
  function announcementsHtml() {
    var a = C.ann;
    if (a.error) return '<div style="color:var(--steel); font-size:var(--fs-2); margin-bottom:12px;">לא הצלחנו לטעון הודעות.</div>';
    var rows = a.rows.filter(function (x) { return x.pinned; }).map(function (x) { return annCard(x); }).join("");
    return rows ? '<h2 class="section-label" style="margin-top:6px;">הודעות</h2>' + rows : "";
  }
  function annAdminHtml() {
    var a = C.ann;
    var form = '<form data-club-form="ann" class="card" style="margin-bottom:12px;" novalidate>' +
        '<label for="clubAnnBody" style="display:block; color:var(--steel); font-size:var(--fs-1); margin-bottom:6px;">הודעה חדשה לכל המועדון (עד 500 תווים, בלי התראה)</label>' +
        '<textarea id="clubAnnBody" name="body" class="text-input" rows="3" maxlength="500" dir="auto" style="margin-bottom:8px;">' + esc(C.postDraft) + "</textarea>" +
        '<label class="flex items-center gap-8" style="font-size:var(--fs-2); min-height:44px;"><input type="checkbox" name="pinned"' + (C.postPinned ? " checked" : "") + " /> לנעוץ בראש הדף</label>" +
        (C.annError ? '<div role="alert" style="color:var(--red-text); font-size:var(--fs-1); margin-bottom:8px;">' + esc(C.annError) + "</div>" : "") +
        '<button type="submit" class="save-btn" style="max-width:none;"' + (C.busy.ann ? " disabled" : "") + ">" + (C.busy.ann ? "רגע…" : "פרסום") + "</button></form>";
    var rows = a.rows.map(function (x) {
      return annCard(x, '<div class="chip-row" style="margin-top:8px;">' +
        '<button class="chip-btn" data-club="pin" data-id="' + esc(x.id) + '" data-pinned="' + (x.pinned ? "0" : "1") + '">' + (x.pinned ? "ביטול נעיצה" : "נעיצה") + "</button>" +
        '<button class="chip-btn danger" data-club="del-ann" data-id="' + esc(x.id) + '">מחיקה</button></div>');
    }).join("");
    return '<h3 class="section-label">הודעות</h3>' + form + rows;
  }
  function adminHtml() {
    // Open when the member left it open, and whenever a new join link is showing (it is shown once only).
    var open = C.adminOpen || !!C.newLink;
    return '<details class="club-admin" id="clubAdmin"' + (open ? " open" : "") + '>' +
      '<summary class="exercise-row"><span style="font-weight:700; font-size:var(--fs-2);">ניהול המועדון</span>' + chevron(open) + "</summary>" +
      annAdminHtml() + linkToolHtml() + "</details>";
  }

  function reactionsHtml(r) {
    var mine = r.my_reactions || [], counts = r.reaction_counts || {};
    return '<div class="chip-row" style="margin-top:10px;" role="group" aria-label="תגובות">' + KINDS.map(function (k) {
      var on = mine.indexOf(k.kind) >= 0, n = counts[k.kind] || 0;
      return '<button class="chip-btn' + (on ? " primary" : "") + '" data-club="react" data-id="' + esc(r.post_id) + '" data-kind="' + k.kind +
        '" aria-pressed="' + on + '" aria-label="' + esc(k.label + (n ? ", " + n : "")) + '"><span aria-hidden="true">' + k.emoji + "</span>" + (n ? " " + n : "") + "</button>";
    }).join("") + "</div>";
  }
  function postHtml(r, staff) {
    var del = staff ? '<button class="link-btn link-btn--tap" data-club="del-post" data-id="' + esc(r.post_id) + '">מחיקת הפוסט</button>' : "";
    return '<article class="card" style="margin-bottom:10px;" aria-label="' + esc("פוסט של " + (r.author_name || "חבר/ה")) + '">' +
      '<div class="who" style="margin:0 0 8px;"><div class="who-avatar" aria-hidden="true">' + esc(r.author_emoji || "🙂") + "</div>" +
      '<div style="flex:1; min-width:0;"><div class="who-name">' + name(r.author_name) + '</div><div class="who-sub">' + esc(when(r.published_at)) + "</div></div></div>" +
      (r.title ? '<div style="font-weight:800; font-size:var(--fs-3);" dir="auto">' + bidiText(r.title) + "</div>" : "") +
      (r.result_text ? '<div style="font-size:var(--fs-2); margin-top:2px;" dir="auto">' + bidiText(r.result_text) + "</div>" : "") +
      (r.body ? '<div style="color:var(--steel); font-size:var(--fs-2); margin-top:6px; white-space:pre-wrap;" dir="auto">' + bidiText(r.body) + "</div>" : "") +
      reactionsHtml(r) + (del ? '<div style="margin-top:4px;">' + del + "</div>" : "") + "</article>";
  }
  function feedHtml(staff) {
    var f = C.feed;
    var head = '<h2 class="section-label" style="margin-top:16px;">הפיד</h2>';
    if (f.error) return head + '<div class="card" style="text-align:center;"><div style="margin-bottom:10px;">לא הצלחנו לטעון את הפיד.</div><button class="chip-btn" data-club="retry">ניסיון חוזר</button></div>';
    if (!f.loaded) return head + '<div style="color:var(--steel); text-align:center; padding:16px;" role="status">טוענים…</div>';
    if (!f.rows.length) return head + '<div class="card" style="text-align:center; color:var(--steel);">עוד אין פוסטים במועדון.</div>';
    return head + f.rows.map(function (r) { return postHtml(r, staff); }).join("") +
      (f.done ? "" : '<div style="text-align:center;"><button class="chip-btn" data-club="more"' + (f.loading ? " disabled" : "") + ">עוד פוסטים</button></div>");
  }

  // The app's own accordion chevron (ICONS.chevron, the nav icon set), turned the way every other
  // expandable row in app.js turns it: 180deg points it left (closed, the RTL "forward"), 90deg down (open).
  function chevron(open) {
    var icon = typeof ICONS === "object" && ICONS.chevron ? ICONS.chevron : "";
    return '<span aria-hidden="true" style="display:inline-flex; flex-shrink:0; transition:transform .2s; transform:rotate(' + (open ? "90deg" : "180deg") + ');">' + icon + "</span>";
  }

  function membersHtml(i) {
    var m = C.members;
    var toggle = '<button class="exercise-row" data-club="members" aria-expanded="' + m.open + '" style="margin-top:14px;"><span style="font-weight:700; font-size:var(--fs-2);">חברי המועדון' +
      (m.loaded ? " (" + m.rows.length + ")" : "") + "</span>" + chevron(m.open) + "</button>";
    if (!m.open) return toggle;
    if (m.error) return toggle + '<div class="card" style="text-align:center;"><div style="margin-bottom:10px;">לא הצלחנו לטעון את החברים.</div><button class="chip-btn" data-club="members-retry">ניסיון חוזר</button></div>';
    if (!m.loaded) return toggle + '<div style="color:var(--steel); text-align:center; padding:12px;" role="status">טוענים…</div>';
    return toggle + m.rows.map(function (x) {
      // The server refuses what the role may not do; the button is only drawn where it can work.
      var canRemove = i.staff && x.user_id !== i.userId && x.role !== "owner" && (x.role !== "coach" || i.role === "owner");
      return '<div class="who" style="margin:8px 0;"><div class="who-avatar" aria-hidden="true">' + esc(x.emoji) + "</div>" +
        '<div style="flex:1; min-width:0;"><div class="who-name">' + name(x.name) + "</div>" + (ROLE_LABEL[x.role] ? '<div class="who-sub">' + esc(ROLE_LABEL[x.role]) + "</div>" : "") + "</div>" +
        (canRemove ? '<button class="chip-btn danger" data-club="rm-member" data-id="' + esc(x.user_id) + '" data-name="' + esc(x.name) + '">הסרה</button>' : "") + "</div>";
    }).join("");
  }

  function linkToolHtml() {
    var code = C.newCode;
    var out = C.newLink
      ? '<div class="card join-invite" id="clubInvite" style="margin-bottom:10px;">' +
        '<div style="font-weight:700; font-size:var(--fs-2); margin-bottom:4px;">קישור ההצטרפות החדש</div>' +
        '<div style="color:var(--steel); font-size:var(--fs-1); margin-bottom:10px;">מוצג פעם אחת בלבד, והקישור הישן כבר לא עובד. שולחים אותו עכשיו, או מדפיסים.</div>' +
        (C.qr ? '<div class="join-qr-wrap">' + C.qr + "</div>" : "") +
        (code ? '<div class="join-code-label">קוד הצטרפות</div><div class="join-code-big" dir="ltr" id="clubInviteCode" aria-label="' + esc(code.split("").join(" ")) + '">' + esc(codeGroups(code)) + "</div>" : "") +
        '<div dir="ltr" class="join-link-text" id="clubInviteLink">' + esc(C.newLink) + "</div>" +
        '<div class="chip-row" style="justify-content:center;">' +
        '<button class="chip-btn" data-club="copy-link">' + (C.linkCopied ? "הקישור הועתק" : "העתקת הקישור") + "</button>" +
        (code ? '<button class="chip-btn" data-club="copy-code">' + (C.codeCopied ? "הקוד הועתק" : "העתקת הקוד") + "</button>" : "") +
        '<button class="chip-btn" data-club="print-link">הדפסה</button>' +
        '<button class="link-btn link-btn--tap" data-club="hide-link">סגירה</button></div></div>' +
        printCardHtml()
      : "";
    return '<h3 class="section-label" style="margin-top:16px;">קישור הצטרפות</h3>' + out +
      '<button class="exercise-row" data-club="rotate"><div style="text-align:right;"><div style="font-weight:700; font-size:var(--fs-2);">קישור הצטרפות חדש</div>' +
      '<div style="color:var(--steel); font-size:var(--fs-1); margin-top:2px;">מחליף את הקישור הקבוע. הישן מפסיק לעבוד.</div></div></button>';
  }

  // The printed sheet for the front desk: the QR, three steps and the code, black on white. index.html's
  // print stylesheet shows only this (.invite-print-card) and hides the rest of the app.
  function printCardHtml() {
    var name = info().clubName || "האימוניה";
    return '<div class="invite-print-card" data-invite-print aria-hidden="true">' +
      '<div class="invite-print-club">' + esc(name) + "</div>" +
      '<div class="invite-print-title">הצטרפות למועדון באפליקציית האימוניה</div>' +
      (C.qr ? '<div class="invite-print-qr">' + C.qr + "</div>" : "") +
      '<ol class="invite-print-steps">' +
      "<li>סורקים את הקוד במצלמה של הטלפון, או נכנסים לכתובת שמתחת.</li>" +
      "<li>מוסיפים את האפליקציה למסך הבית ופותחים אותה מהאייקון.</li>" +
      "<li>מקלידים את קוד ההצטרפות.</li></ol>" +
      '<div class="invite-print-link" dir="ltr">' + esc(C.newLink) + "</div>" +
      (C.newCode ? '<div class="invite-print-code-label">קוד הצטרפות</div><div class="invite-print-code" dir="ltr">' + esc(codeGroups(C.newCode)) + "</div>" : "") +
      "</div>";
  }

  function renderTab() {
    var i = info();
    // Q-49: a guest gets the same join code field as on רישום (the one join component), on the club's own page.
    if (!i.inClub) {
      return '<section class="scene-page scene-page--community" aria-labelledby="pageTitle-club">' +
        '<div class="scene-page__media" aria-hidden="true"></div><div class="scene-page__scrim" aria-hidden="true"></div>' +
        '<div class="scene-page__intro"><h1 id="pageTitle-club" class="scene-page__title">מועדון</h1></div>' +
        '<div class="scene-sheet"><div class="stripe-ribbon" aria-hidden="true"></div>' +
        '<div class="join-lead" style="margin-bottom:12px;">בפיד של המועדון רואים את האימונים של כולם, מגיבים, וקוראים הודעות מהמאמן. הקוד נמצא בקבוצת המועדון, או ב-QR שבמועדון.</div>' +
        (window.haimuniaJoin ? window.haimuniaJoin.cardHtml("club") : "") + "</div></section>";
    }
    ensureLoaded();
    return '<section class="scene-page scene-page--community" aria-labelledby="pageTitle-club">' +
      '<div class="scene-page__media" aria-hidden="true"></div><div class="scene-page__scrim" aria-hidden="true"></div>' +
      '<div class="scene-page__intro"><div class="scene-page__brand">' + esc(typeof brandWordmark === "function" ? brandWordmark() : "") + "</div>" +
      '<h1 id="pageTitle-club" class="scene-page__title">' + esc(i.clubName || "המועדון") + "</h1></div>" +
      '<div class="scene-sheet"><div class="stripe-ribbon" aria-hidden="true"></div>' +
      announcementsHtml() + feedHtml(i.staff) + membersHtml(i) + (i.staff ? adminHtml() : "") +
      "</div></section>";
  }

  // ---- Sharing workouts to the club ----------------------------------------------------
  // Owner decision (2026-11-11): connected mode has a feed and reactions. Owner decision (2026-11-14):
  // the member chooses per workout. Q-43: a "לשתף במועדון" box on the save bar; only the
  // workouts saved with it ticked reach the day's post. The answer is kept on this phone (CHOICE_KEY). The unit
  // is a training DAY, the same as BOX-LOG: one post per member per day, upserted on
  // (author_id, club_id, source_type, source_record_id) so a second lift that day updates it.
  // What is sent: the movement or WOD names and the results without weights, nothing else. Body weight
  // is a different record and never reaches here.
  function cid() { return C.clubId || info().clubId; }
  var CLUB_DEFAULTS = { share_workouts: true, show_weights: false };
  function shareDefaults() { return Object.assign({}, CLUB_DEFAULTS, info().shareDefaults || {}); }
  function sharingOn() { return shareDefaults().share_workouts === true; }
  // { "<club>|<log id>": true | false }: what the member answered for each workout. No answer = not shared.
  var CHOICE_KEY = "haimunia:clubShareChoice";
  function choices() { try { var v = JSON.parse(localStorage.getItem(CHOICE_KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } }
  function isShared(id) { return !!id && choices()[cid() + "|" + id] === true; }
  function setShared(id, yes) {
    if (!id) return;
    var v = choices(); v[cid() + "|" + id] = !!yes;
    try { localStorage.setItem(CHOICE_KEY, JSON.stringify(v)); } catch (e) { /* this answer is lost, the log is not */ }
  }
  /** The row for one day, or null when nothing is sent. Pure: summary is clubDaySummary(day). */
  function dayPostRow(summary, clubId, userId, defaults) {
    // The per-workout answer is the consent: summary.lines holds only the workouts answered yes.
    if (!summary || !summary.day || !clubId || !userId || !defaults) return null;
    var lines = (summary.lines || []).filter(function (l) { return l && l.title; });
    if (!lines.length) return null;
    var text = lines.map(function (l) {
      var t = defaults.show_weights === true ? l.text : l.textNoWeight;
      return t ? l.title + " " + t : l.title;
    }).join(" · ");
    return {
      author_id: userId, club_id: clubId, source_type: "strength_entry", source_record_id: "day:" + summary.day,
      visibility: "club", occurred_on: summary.day,
      title: (lines.length === 1 ? lines[0].title : lines[0].title + " ועוד " + (lines.length - 1)).slice(0, 120),
      result_text: text.slice(0, 240) || null,
      rx: lines.length === 1 && typeof lines[0].rx === "boolean" ? lines[0].rx : null,
    };
  }
  var posting = {};
  /** The id of my own live post with this source_record_id in the club, or null (RLS shows no removed row). */
  async function myPostId(c, sourceRecordId) {
    var r = await c.from("workout_posts").select("id").eq("author_id", info().userId).eq("club_id", cid())
      .eq("source_record_id", sourceRecordId).limit(1);
    if (r.error) throw r.error;
    return r.data && r.data[0] ? r.data[0].id : null;
  }
  // A removed post (post_delete is a soft delete) keeps its key, and it is invisible to its own author,
  // so an upsert onto it is refused. A day that comes back after its post was removed (by its member
  // here, or by the coach) gets the next key: day:D, then day:D:2, day:D:3. The count is kept on this
  // phone, keyed by club and day.
  var REV_KEY = "haimunia:clubDayRev";
  function revs() { try { var v = JSON.parse(localStorage.getItem(REV_KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } }
  function dayKey(day) { var n = revs()[cid() + "|" + day] || 0; return n ? "day:" + day + ":" + (n + 1) : "day:" + day; }
  function bumpDay(day) {
    var v = revs(), k = cid() + "|" + day; v[k] = (v[k] || 0) + 1;
    try { localStorage.setItem(REV_KEY, JSON.stringify(v)); } catch (e) { /* the retry below still works this once */ }
  }
  function rlsRefused(e) { return /row-level security|violates|42501/i.test(String((e && (e.message || e.code)) || "")); }
  /**
   * Called by app.js after a workout is saved, deleted or restored. The day's post follows the log:
   * updated while the day has logged results, removed when its last one is deleted. Silent on success;
   * a failure never touches the log.
   */
  async function postDay(day) {
    var i = info();
    if (!available() || !i.userId || !day) return false;
    if (posting[day]) { posting[day] = "again"; return false; }
    var summary = typeof clubDaySummary === "function" ? clubDaySummary(day) : null;
    var defaults = shareDefaults();
    var row = dayPostRow(summary, i.clubId, i.userId, defaults);
    var empty = !summary || !(summary.lines || []).length;
    if (!row && !empty) return false;
    posting[day] = true;
    try {
      var c = await client();
      if (row) {
        var conflict = { onConflict: "author_id,club_id,source_type,source_record_id" };
        row.source_record_id = dayKey(day);
        var r = await c.from("workout_posts").upsert(row, conflict);
        if (r.error && rlsRefused(r.error)) {
          // This day's post was removed earlier: write it under the next key.
          bumpDay(day); row.source_record_id = dayKey(day);
          r = await c.from("workout_posts").upsert(row, conflict);
        }
        if (r.error) throw r.error;
      } else {
        // The day's last entry was deleted: the post goes too, and a later entry that day starts a new one.
        var id = await myPostId(c, dayKey(day));
        if (id) { var d = await c.rpc("post_delete", { post_id: id }); if (d.error) throw d.error; bumpDay(day); }
      }
      C.feed.loaded = false;
      return true;
    } catch (e) {
      failToast("השינוי נשמר בטלפון. המועדון לא התעדכן הפעם.");
      return false;
    } finally {
      var redo = posting[day] === "again";
      delete posting[day];
      if (redo) postDay(day);
    }
  }
  // The PRs this phone shared, so a deleted PR entry that is restored (undo) gets its card back.
  // { "<club>|<entry id>": { name, pct, n } }, n = how many of its posts were removed. A removed PR post
  // keeps its key and pr_share returns it as is, so a restored one is sent under pr:<id>:<n+1>.
  var PR_KEY = "haimunia:clubPrShared";
  function prs() { try { var v = JSON.parse(localStorage.getItem(PR_KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } }
  function savePr(entryId, rec) {
    var v = prs(); if (rec) v[cid() + "|" + entryId] = rec; else delete v[cid() + "|" + entryId];
    try { localStorage.setItem(PR_KEY, JSON.stringify(v)); } catch (e) { /* the post itself is already sent */ }
  }
  function prRec(entryId) { return prs()[cid() + "|" + entryId] || null; }
  function prKey(entryId) { var r = prRec(entryId), n = r && r.n ? r.n : 0; return n ? "pr:" + entryId + ":" + (n + 1) : "pr:" + entryId; }
  /** A personal record as a percent improvement, never kilograms (club default share_prs, percent only). */
  async function postPr(entryId, movementName, pct) {
    var d = shareDefaults();
    if (!available() || !entryId || !(pct > 0) || !isShared(entryId) || d.share_prs === false) return false;
    var prev = prRec(entryId);
    savePr(entryId, { name: String(movementName || "").slice(0, 80), pct: pct, n: prev && prev.n ? prev.n : 0 });
    try {
      var c = await client();
      var args = { p_club_id: cid(), record_id: prKey(entryId), note: "שיא אישי ב" + String(movementName || "").slice(0, 80) + ": +" + pct + "%" };
      var key = newKey(); if (key) args.p_idempotency_key = key;
      var r = await c.rpc("pr_share", args);
      if (r.error) throw r.error;
      C.feed.loaded = false;
      return true;
    } catch (e) { failToast("השיא נשמר בטלפון. השיתוף במועדון לא הצליח הפעם."); return false; }
  }
  /** The PR post of a deleted entry is removed with it. What it said is kept, for an undo. */
  async function removePr(entryId) {
    if (!available() || !entryId) return false;
    try {
      var c = await client();
      var id = await myPostId(c, prKey(entryId));
      if (!id) return false;
      var d = await c.rpc("post_delete", { post_id: id });
      if (d.error) throw d.error;
      var r = prRec(entryId);
      if (r) savePr(entryId, Object.assign({}, r, { n: (r.n || 0) + 1 }));
      C.feed.loaded = false;
      return true;
    } catch (e) { return false; }
  }
  /** Undo of a deleted entry: its PR card comes back if this phone had shared one. */
  async function restorePr(entryId) {
    var r = prRec(entryId);
    if (!r || !r.n) return false;
    return postPr(entryId, r.name, r.pct);
  }
  // Q-43: what is shared, and the default for the save bar's "לשתף במועדון" box, live in Settings > מועדון.

  // ---- Events -----------------------------------------------------------------------
  function onClick(e) {
    var t = e.target.closest && e.target.closest("[data-club]");
    if (!t) return;
    var a = t.getAttribute("data-club"), id = t.getAttribute("data-id");
    if (a === "react") react(id, t.getAttribute("data-kind"));
    else if (a === "more") loadFeed(true);
    else if (a === "retry") { C.feed.error = false; C.ann.error = false; again(); }
    else if (a === "pin") setPinned(id, t.getAttribute("data-pinned") === "1");
    else if (a === "del-ann") askConfirm({ title: "מחיקת הודעה", message: "ההודעה תימחק לכל המועדון.", confirmLabel: "מחיקה", payload: { op: "delete-announcement", id: id } });
    else if (a === "del-post") askConfirm({ title: "מחיקת פוסט", message: "הפוסט יימחק לכל המועדון.", confirmLabel: "מחיקה", payload: { op: "delete-post", id: id } });
    else if (a === "rm-member") askConfirm({ title: "הסרת חבר/ה", message: (t.getAttribute("data-name") || "החבר/ה") + " יוסר/ו מהמועדון, והפוסטים שלהם יימחקו.", confirmLabel: "הסרה", payload: { op: "remove-member", id: id } });
    else if (a === "rotate") askConfirm({ title: "קישור הצטרפות חדש", message: "הקישור הנוכחי יפסיק לעבוד ולא יהיה אפשר לשחזר אותו.", confirmLabel: "יצירת קישור חדש", payload: { op: "rotate" } });
    else if (a === "members") { C.members.open = !C.members.open; if (C.members.open && !C.members.loaded) loadMembers(); again(); }
    else if (a === "members-retry") { C.members.error = false; loadMembers(); }
    else if (a === "hide-link") { clearLink(); again(); }
    else if (a === "print-link") { try { window.print(); } catch (err) {} }
    else if (a === "copy-code") {
      var doneCode = function (ok) { C.codeCopied = !!ok; again(); };
      try { navigator.clipboard.writeText(C.newCode).then(function () { doneCode(true); }, function () { doneCode(false); }); } catch (err) { doneCode(false); }
    }
    else if (a === "copy-link") {
      var done = function (ok) { C.linkCopied = !!ok; again(); };
      try { navigator.clipboard.writeText(C.newLink).then(function () { done(true); }, function () { done(false); }); } catch (err) { done(false); }
    }
  }
  function onSubmit(e) {
    var f = e.target.closest && e.target.closest("[data-club-form='ann']");
    if (!f) return;
    e.preventDefault();
    if (C.busy.ann) return;
    C.postDraft = String(f.elements.body.value || ""); C.postPinned = !!f.elements.pinned.checked;
    postAnnouncement(C.postDraft, C.postPinned);
  }

  function init() {
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    document.addEventListener("toggle", function (e) {
      if (e.target && e.target.id === "clubAdmin") {
        C.adminOpen = e.target.open;
        var ch = e.target.querySelector("summary > span[aria-hidden='true']");
        if (ch) ch.style.transform = "rotate(" + (e.target.open ? "90deg" : "180deg") + ")";
      }
    }, true);
    if (connect()) connect().onChange(function () {
      var i = info();
      if (C.clubId !== i.clubId) reset();
      if (typeof render === "function") render();
    });
  }

  window.haimuniaClub = { init: init, available: available, renderTab: renderTab, runConfirmed: runConfirmed, refresh: refresh,
    postDay: postDay, postPr: postPr, removePr: removePr, restorePr: restorePr, dayPostRow: dayPostRow, sharingOn: sharingOn,
    isShared: isShared, setShared: setShared };
})();

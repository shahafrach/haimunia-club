"use strict";
// ---- The club tab: announcements, members, coach tools -----------------------------
//
// Shown only to a connected member of the club (src/connect.js says who that is). Reads
// what the backend lets a member read and calls its RPCs; the backend does the
// authorising, this file only decides what to show. Nothing from the private log is
// involved. There is deliberately NO feed and NO posting: no workout is ever posted from this app, so
// the tab shows announcements, the roster and the coach's tools only.
//
// Roles: owner and coach may post announcements, remove members and rotate the join link (the coach cannot remove the owner or another coach; the server
// enforces it, the buttons just are not drawn). Members see announcements read-only.
//
// Classic script, one IIFE, exports window.haimuniaClub. Reads esc, bidiText,
// askAppConfirm, showToast, render from the shared scope, only inside function bodies.
(function () {
  var ROLE_LABEL = { owner: "בעלים", coach: "מאמן/ת" };

  var C = {
    clubId: null,
    ann: { rows: [], loaded: false, loading: false, error: false },
    members: { rows: [], loaded: false, loading: false, error: false, open: false },
    postDraft: "", postPinned: false, annError: "",
    newLink: "", linkCopied: false, busy: {},
  };

  function connect() { return window.haimuniaConnect; }
  function info() { return connect() ? connect().info() : { inClub: false }; }
  function available() { var i = info(); return !!(i.inClub && i.clubId); }
  function client() { return connect().getClient(); }
  function reset() {
    C.clubId = null;
    C.ann = { rows: [], loaded: false, loading: false, error: false };
    C.members = { rows: [], loaded: false, loading: false, error: false, open: false };
    C.postDraft = ""; C.postPinned = false; C.annError = ""; C.newLink = ""; C.linkCopied = false; C.busy = {};
  }
  function again() { if (typeof render === "function" && typeof tab !== "undefined" && tab === "club") render(); }
  function toast(t) { if (typeof showToast === "function") showToast(t); }

  // ---- Loading ----------------------------------------------------------------------
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
    if (!C.ann.loaded && !C.ann.loading && !C.ann.error) setTimeout(loadAnnouncements, 0);
  }
  function refresh() { C.ann.error = false; C.ann.loaded = false; C.members.loaded = false; again(); }

  // ---- Actions ----------------------------------------------------------------------
  function errText(e, fallback) {
    var m = String((e && e.message) || "");
    if (/rate_limited/.test(m)) return "יותר מדי פעמים להיום. אפשר לנסות שוב מאוחר יותר.";
    if (/not authorized/.test(m)) return "אין הרשאה לפעולה הזאת.";
    if (/failed to fetch|network/i.test(m)) return "אין חיבור כרגע. נסו שוב כשהחיבור חוזר.";
    return fallback;
  }
  function newKey() { try { return crypto.randomUUID(); } catch (e) { return null; } }

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
  async function rotateLink() {
    await simpleRpc("rotate_club_link", { p_club_id: C.clubId }, null, function (token) {
      if (typeof token === "string" && /^[0-9a-f]{64}$/.test(token)) {
        C.newLink = location.origin + location.pathname + "#join=" + token; C.linkCopied = false;
      }
    });
  }

  // Destructive actions go through the app's own confirm sheet.
  function askConfirm(opts) {
    askAppConfirm({
      title: opts.title, message: opts.message, confirmLabel: opts.confirmLabel, destructive: true,
      action: "club-action", payload: opts.payload, opener: null,
    });
  }
  function runConfirmed(p) {
    if (!p) return;
    if (p.op === "delete-announcement") {
      simpleRpc("club_announcement_delete", { p_id: p.id }, "ההודעה נמחקה", function () {
        C.ann.rows = C.ann.rows.filter(function (r) { return r.id !== p.id; });
      });
    } else if (p.op === "remove-member") {
      simpleRpc("remove_member", { p_club_id: C.clubId, p_user_id: p.id }, "החבר/ה הוסר/ה", function () {
        C.members.rows = C.members.rows.filter(function (r) { return r.user_id !== p.id; });
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

  function announcementsHtml(staff) {
    var a = C.ann, rows = a.rows.map(function (x) {
      var tools = staff
        ? '<div class="chip-row" style="margin-top:8px;">' +
          '<button class="chip-btn" data-club="pin" data-id="' + esc(x.id) + '" data-pinned="' + (x.pinned ? "0" : "1") + '">' + (x.pinned ? "ביטול נעיצה" : "נעיצה") + "</button>" +
          '<button class="chip-btn danger" data-club="del-ann" data-id="' + esc(x.id) + '">מחיקה</button></div>'
        : "";
      return '<div class="card" style="margin-bottom:10px;">' +
        (x.pinned ? '<div style="color:var(--steel); font-size:11.5px; font-weight:700; margin-bottom:4px;">📌 נעוץ</div>' : "") +
        '<div style="white-space:pre-wrap; font-size:14px; line-height:1.55;" dir="auto">' + bidiText(x.body) + "</div>" +
        '<div style="color:var(--steel); font-size:11.5px; margin-top:6px;">' + esc(when(x.created_at)) + "</div>" + tools + "</div>";
    }).join("");
    var form = staff
      ? '<form data-club-form="ann" class="card" style="margin-bottom:12px;" novalidate>' +
        '<label for="clubAnnBody" style="display:block; color:var(--steel); font-size:12px; margin-bottom:6px;">הודעה חדשה לכל המועדון (עד 500 תווים, בלי התראה)</label>' +
        '<textarea id="clubAnnBody" name="body" class="text-input" rows="3" maxlength="500" dir="auto" style="margin-bottom:8px;">' + esc(C.postDraft) + "</textarea>" +
        '<label class="flex items-center gap-8" style="font-size:13px; min-height:44px;"><input type="checkbox" name="pinned"' + (C.postPinned ? " checked" : "") + " /> לנעוץ בראש הדף</label>" +
        (C.annError ? '<div role="alert" style="color:var(--red-text); font-size:12.5px; margin-bottom:8px;">' + esc(C.annError) + "</div>" : "") +
        '<button type="submit" class="save-btn" style="max-width:none;"' + (C.busy.ann ? " disabled" : "") + ">" + (C.busy.ann ? "רגע…" : "פרסום") + "</button></form>"
      : "";
    var body = a.error ? '<div style="color:var(--steel); font-size:13px; margin-bottom:12px;">לא הצלחנו לטעון הודעות.</div>'
      : (a.loaded && !rows ? "" : rows);
    if (!form && !body && a.loaded) body = '<div class="card" style="text-align:center; color:var(--steel);">אין הודעות כרגע.</div>';
    if (!form && !body) return "";
    return '<h2 class="settings-block-title" style="margin:6px 0 8px;">הודעות</h2>' + form + body;
  }

  function membersHtml(i) {
    var m = C.members;
    var toggle = '<button class="exercise-row" data-club="members" aria-expanded="' + m.open + '" style="margin-top:14px;"><span style="font-weight:700; font-size:13.5px;">חברי המועדון' +
      (m.loaded ? " (" + m.rows.length + ")" : "") + '</span><span style="color:var(--steel);">' + (m.open ? "▲" : "▼") + "</span></button>";
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
    var out = C.newLink
      ? '<div class="card" style="margin-bottom:10px;"><div style="color:var(--steel); font-size:12.5px; margin-bottom:6px;">הקישור החדש. הוא מוצג פעם אחת בלבד, והקישור הישן כבר לא עובד.</div>' +
        '<div dir="ltr" style="word-break:break-all; font-family:ui-monospace,monospace; font-size:12px; user-select:all; margin-bottom:8px;">' + esc(C.newLink) + "</div>" +
        '<button class="chip-btn" data-club="copy-link">' + (C.linkCopied ? "הועתק" : "העתקה") + '</button> <button class="link-btn link-btn--tap" data-club="hide-link">סגירה</button></div>'
      : "";
    return '<h2 class="settings-block-title" style="margin:14px 0 8px;">כלי מאמן</h2>' + out +
      '<button class="exercise-row" data-club="rotate"><div style="text-align:right;"><div style="font-weight:700; font-size:13.5px;">קישור הצטרפות חדש</div>' +
      '<div style="color:var(--steel); font-size:12px; margin-top:2px;">מחליף את הקישור הקבוע. הישן מפסיק לעבוד.</div></div></button>';
  }

  function renderTab() {
    var i = info();
    if (!i.inClub) return '<div class="card" style="margin:16px; text-align:center;">המועדון זמין אחרי התחברות והצטרפות. אפשר להתחיל מההגדרות.</div>';
    ensureLoaded();
    return '<section class="scene-page scene-page--community" aria-labelledby="pageTitle-club">' +
      '<div class="scene-page__media" aria-hidden="true"></div><div class="scene-page__scrim" aria-hidden="true"></div>' +
      '<div class="scene-page__intro"><div class="scene-page__brand">' + esc(typeof brandWordmark === "function" ? brandWordmark() : "") + "</div>" +
      '<h1 id="pageTitle-club" class="scene-page__title">' + esc(i.clubName || "המועדון") + "</h1></div>" +
      '<div class="scene-sheet"><div class="stripe-ribbon" aria-hidden="true"></div>' +
      announcementsHtml(i.staff) + membersHtml(i) + (i.staff ? linkToolHtml() : "") +
      "</div></section>";
  }

  // ---- Events -----------------------------------------------------------------------
  function onClick(e) {
    var t = e.target.closest && e.target.closest("[data-club]");
    if (!t) return;
    var a = t.getAttribute("data-club"), id = t.getAttribute("data-id");
    if (a === "pin") setPinned(id, t.getAttribute("data-pinned") === "1");
    else if (a === "del-ann") askConfirm({ title: "מחיקת הודעה", message: "ההודעה תימחק לכל המועדון.", confirmLabel: "מחיקה", payload: { op: "delete-announcement", id: id } });
    else if (a === "rm-member") askConfirm({ title: "הסרת חבר/ה", message: (t.getAttribute("data-name") || "החבר/ה") + " יוסר/ו מהמועדון, והפוסטים שלהם יימחקו.", confirmLabel: "הסרה", payload: { op: "remove-member", id: id } });
    else if (a === "rotate") askConfirm({ title: "קישור הצטרפות חדש", message: "הקישור הנוכחי יפסיק לעבוד ולא יהיה אפשר לשחזר אותו.", confirmLabel: "יצירת קישור חדש", payload: { op: "rotate" } });
    else if (a === "members") { C.members.open = !C.members.open; if (C.members.open && !C.members.loaded) loadMembers(); again(); }
    else if (a === "members-retry") { C.members.error = false; loadMembers(); }
    else if (a === "hide-link") { C.newLink = ""; again(); }
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
    if (connect()) connect().onChange(function () {
      var i = info();
      if (C.clubId !== i.clubId) reset();
      if (typeof render === "function") render();
    });
  }

  window.haimuniaClub = { init: init, available: available, renderTab: renderTab, runConfirmed: runConfirmed, refresh: refresh };
})();

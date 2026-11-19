// THE FEEDBACK BOX: "מה לא עובד טוב?" (3.12.0). Since Q-27 also the menu's "תמיכה ודיווח על תקלה": the one
// feedback screen. The old WhatsApp / e-mail / copy bug report is gone.
//
// A sheet with one text box. What is sent: the text the member typed, the screen it is about, the app
// version, the device type (ios, android, desktop, other) and whether the app is installed. Never a name or a
// username, even in connected mode. The server stores no IP; its limits use HMACs of the IP and of a random
// id made on this phone for this purpose only (haimunia:feedbackDeviceId, apart from the usage-count id)
// (haimunia-app-demo 202611150003, feedback_submit()). Only the app's operator reads it.
//
// Offline, a network failure or a 5xx (or 408/429): the message waits in localStorage (5 at most) and goes
// when the app is online again or next starts. The member sees "נשלח כשיהיה חיבור".
// Any other 4xx means the server refused the fields: it is not queued (3.14.0). The member sees
// "המשוב לא נשלח. נסו לקצר או לנסח אחרת." and the draft stays in the box. A refused entry already in the
// queue (from 3.12.0/3.13.0) is dropped on the next flush instead of being retried at every start.
//
// Classic script, one IIFE, exports window.HaimuniaFeedback. Reads esc() and the app's dialog helpers from
// the shared scope, only inside function bodies.
(function (global) {
  "use strict";
  var QUEUE_KEY = "haimunia:feedbackQueue";
  var DEVICE_KEY = "haimunia:feedbackDeviceId";
  var MAX_QUEUE = 5;
  var MAX_LEN = 1000;
  var SCREENS = [["add", "רישום"], ["history", "התקדמות"], ["calendar", "לוח שנה"], ["wod", "אימונים"], ["club", "מועדון"], ["settings", "הגדרות"], ["other", "אחר"]];
  var TEXT = {
    sent: "תודה. קראנו כל פנייה.",
    queued: "נשלח כשיהיה חיבור",
    full: "כבר מחכות 5 הודעות לשליחה. נסו שוב כשיש חיבור.",
    empty: "כתבו כמה מילים לפני השליחה.",
    refused: "המשוב לא נשלח. נסו לקצר או לנסח אחרת.",
  };
  var S = { screen: "other", note: "", noteKind: "", busy: false, opener: null };

  function el(id) { return global.document.getElementById(id); }
  function ls(fn) { try { return fn(global.localStorage); } catch (e) { return null; } }
  function readQueue() {
    var raw = ls(function (s) { return s.getItem(QUEUE_KEY); });
    try { var v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function writeQueue(list) { ls(function (s) { s.setItem(QUEUE_KEY, JSON.stringify(list.slice(0, MAX_QUEUE))); }); }
  function endpoint() {
    var c = (global.HAIMUNIA_CONFIG && global.HAIMUNIA_CONFIG.usage) || null;
    if (!c || typeof c.url !== "string" || typeof c.key !== "string" || !c.url || !c.key) return null;
    return { url: c.url.replace(/\/+$/, "") + "/rest/v1/rpc/feedback_submit", key: c.key };
  }
  function deviceId() {
    var id = ls(function (s) { return s.getItem(DEVICE_KEY); });
    if (id && /^[A-Za-z0-9-]{16,64}$/.test(id)) return id;
    if (global.crypto && typeof global.crypto.randomUUID === "function") id = global.crypto.randomUUID();
    else {
      var b = new Uint8Array(16);
      global.crypto.getRandomValues(b);
      id = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    }
    ls(function (s) { s.setItem(DEVICE_KEY, id); });
    return id;
  }
  function deviceType() {
    var n = global.navigator || {};
    var ua = String(n.userAgent || "");
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && n.maxTouchPoints > 1)) return "ios";
    if (/Android/.test(ua)) return "android";
    if (/Windows|Macintosh|Linux|CrOS/.test(ua)) return "desktop";
    return "other";
  }
  function standalone() {
    try {
      if (typeof isStandalone === "function") return !!isStandalone(); // eslint-disable-line no-undef
      return !!(global.matchMedia && global.matchMedia("(display-mode: standalone)").matches);
    } catch (e) { return false; }
  }
  function appVersion() {
    try { if (typeof APP_VERSION === "string") return APP_VERSION.slice(0, 20); } catch (e) { /* TDZ */ } // eslint-disable-line no-undef
    return "unknown";
  }
  function screenKnown(s) { return SCREENS.some(function (x) { return x[0] === s; }); }
  function currentScreen() {
    try {
      var t = typeof tab === "string" ? tab : ""; // eslint-disable-line no-undef
      if (screenKnown(t)) return t;
    } catch (e) { /* app.js not run yet */ }
    return "other";
  }
  function online() { return !(global.navigator && global.navigator.onLine === false); }

  // Exactly what leaves the phone. Exposed for tests.
  function payload(body, screen) {
    return {
      p_app_version: appVersion(),
      p_screen: screenKnown(screen) ? screen : "other",
      p_device_type: deviceType(),
      p_standalone: standalone(),
      p_body: String(body).slice(0, MAX_LEN),
      p_device: deviceId(),
    };
  }
  // Resolves "sent", "refused" (a 4xx other than 408/429: sending it again cannot help) or "retry".
  function post(p) {
    var ep = endpoint();
    if (!ep || typeof global.fetch !== "function" || !online()) return Promise.resolve("retry");
    return global.fetch(ep.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ep.key, Prefer: "return=minimal" },
      body: JSON.stringify(p),
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }).then(function (res) {
      if (res && res.ok) return "sent";
      var st = res ? Number(res.status) : 0;
      return st >= 400 && st < 500 && st !== 408 && st !== 429 ? "refused" : "retry";
    }, function () { return "retry"; });
  }

  // Sends what waited, oldest first; keeps what still fails. Always resolves.
  var flushing = null;
  function flush() {
    if (flushing) return flushing;
    flushing = (function () {
      var list = readQueue();
      if (!list.length || !online()) return Promise.resolve(0);
      return list.reduce(function (chain, p) {
        return chain.then(function (acc) {
          return post(p).then(function (r) { if (r === "retry") acc.left.push(p); else if (r === "sent") acc.sent++; return acc; });
        });
      }, Promise.resolve({ sent: 0, left: [] })).then(function (acc) {
        // Anything queued while this ran was appended after the snapshot: keep it too.
        writeQueue(acc.left.concat(readQueue().slice(list.length)));
        return acc.sent;
      });
    })().then(function (n) { flushing = null; return n; }, function () { flushing = null; return 0; });
    return flushing;
  }

  function sheetHtml() {
    var esc_ = typeof esc === "function" ? esc : function (s) { return String(s); }; // eslint-disable-line no-undef
    var draft = el("feedbackText") ? el("feedbackText").value : "";
    return '<div style="color:var(--chalk); font-size:var(--fs-3); font-weight:700; line-height:1.5; margin-bottom:4px;">מה לא עובד טוב, או מה היה עוזר לכם?</div>' +
      '<div style="color:var(--steel); font-size:var(--fs-2); line-height:1.6; margin-bottom:12px;">נשלח בלי שם ובלי שם משתמש, ורק מפעיל האפליקציה קורא.</div>' +
      '<div class="settings-block-title" id="feedbackScreenLabel">איפה זה קרה? (לא חובה)</div>' +
      '<div class="chip-row" role="radiogroup" aria-labelledby="feedbackScreenLabel" style="flex-wrap:wrap; margin-bottom:12px;">' +
      SCREENS.map(function (x) {
        var on = S.screen === x[0];
        return '<button type="button" class="format-chip' + (on ? " active" : "") + '" data-feedback-screen="' + x[0] + '" role="radio" aria-checked="' + on + '">' + esc_(x[1]) + "</button>";
      }).join("") +
      "</div>" +
      '<label for="feedbackText" class="sr-only">מה לא עובד טוב?</label>' +
      '<textarea id="feedbackText" class="text-input" dir="auto" rows="6" maxlength="' + MAX_LEN + '" aria-describedby="feedbackCount" style="width:100%; min-height:140px; resize:vertical; font-family:inherit; font-size:var(--fs-3); line-height:1.5;">' + esc_(draft) + "</textarea>" +
      '<div id="feedbackCount" class="footer-note" style="text-align:left; margin:4px 0 12px;" dir="ltr">' + draft.length + "/" + MAX_LEN + "</div>" +
      '<div id="feedbackNote" role="status" aria-live="polite" class="footer-note" style="margin-bottom:10px;' + (S.noteKind === "warn" ? " color:var(--danger-text);" : "") + '">' + esc_(S.note) + "</div>" +
      '<button type="button" class="save-btn" data-feedback="send" style="max-width:none;"' + (S.busy ? " disabled" : "") + ">" + (S.busy ? "שולחים…" : "שליחה") + "</button>";
  }
  function paint() { var b = el("feedbackBody"); if (b) b.innerHTML = sheetHtml(); }
  function isOpen() { var o = el("feedbackOverlay"); return !!(o && o.classList.contains("open")); }
  function open(screen) {
    var o = el("feedbackOverlay");
    if (!o) return;
    S.screen = screenKnown(screen) ? screen : currentScreen();
    S.note = ""; S.noteKind = ""; S.busy = false;
    S.opener = global.document.activeElement;
    var b = el("feedbackBody");
    if (b) b.innerHTML = ""; // a fresh sheet: no draft from last time
    paint();
    global.document.body.style.overflow = "hidden";
    o.classList.add("open");
    setTimeout(function () { var t = el("feedbackText"); if (t) { try { t.focus(); } catch (e) { /* ok */ } } }, 50);
  }
  function close() {
    var o = el("feedbackOverlay");
    if (!o) return;
    o.classList.remove("open");
    if (typeof releaseScrollLockIfLastDialog === "function") releaseScrollLockIfLastDialog(); else global.document.body.style.overflow = ""; // eslint-disable-line no-undef
    if (S.opener && typeof S.opener.focus === "function") { try { S.opener.focus(); } catch (e) { /* ok */ } }
    S.opener = null;
  }
  function setNote(text, kind) { S.note = text; S.noteKind = kind || ""; var n = el("feedbackNote"); if (n) { n.textContent = text; n.style.color = kind === "warn" ? "var(--danger-text)" : ""; } }

  async function send() {
    if (S.busy) return;
    var t = el("feedbackText");
    var body = (t ? t.value : "").trim();
    if (!body) { setNote(TEXT.empty, "warn"); return; }
    var p = payload(body, S.screen);
    S.busy = true; paint();
    var r = "retry";
    try { r = await post(p); } catch (e) { r = "retry"; }
    S.busy = false;
    if (r === "refused") { paint(); setNote(TEXT.refused, "warn"); return; } // paint() keeps the draft
    if (r === "sent") {
      var sentBox = el("feedbackText"); // paint() above replaced the box: clear the one on screen
      if (sentBox) sentBox.value = "";
      paint();
      setNote(TEXT.sent);
      return;
    }
    var list = readQueue();
    if (list.length >= MAX_QUEUE) { paint(); setNote(TEXT.full, "warn"); return; } // the draft stays in the box
    list.push(p);
    writeQueue(list);
    var box = el("feedbackText");
    if (box) box.value = "";
    paint();
    setNote(TEXT.queued);
  }

  function onClick(e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var scr = t.closest("[data-feedback-screen]");
    if (scr && isOpen()) {
      S.screen = scr.getAttribute("data-feedback-screen");
      global.document.querySelectorAll("[data-feedback-screen]").forEach(function (b) {
        var on = b === scr;
        b.classList.toggle("active", on);
        b.setAttribute("aria-checked", String(on));
      });
      return;
    }
    if (t.closest("[data-feedback='send']")) { send(); return; }
    var openBtn = t.closest("[data-feedback-open]");
    if (openBtn) { open(openBtn.getAttribute("data-feedback-open") || ""); }
  }
  function onInput(e) {
    if (e.target && e.target.id === "feedbackText") {
      var c = el("feedbackCount");
      if (c) c.textContent = e.target.value.length + "/" + MAX_LEN;
    }
  }

  if (global.document && typeof global.document.addEventListener === "function") {
    global.document.addEventListener("click", onClick);
    global.document.addEventListener("input", onInput);
  }
  if (typeof global.addEventListener === "function") {
    global.addEventListener("online", function () { flush(); });
    setTimeout(function () { flush(); }, 0);
  }

  global.HaimuniaFeedback = Object.freeze({ open: open, close: close, isOpen: isOpen, flush: flush, payload: payload, TEXT: TEXT });
})(typeof window !== "undefined" ? window : globalThis);

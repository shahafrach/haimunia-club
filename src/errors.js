// ANONYMOUS ERROR REPORTS (3.12.0).
//
// When something fails in the app, this file tells the club's server what failed, and nothing else:
//
//   kind         "error" (an uncaught exception), "unhandledrejection", or "storage" (a failed save,
//                from noteStorageError() in app.js)
//   name         the error's class, letters only ("TypeError"), or none
//   message      a short technical description with everything a member could have typed taken out:
//                quoted text, URLs, whatever follows the colon of a JSON error, and every character that
//                is not plain ASCII (so Hebrew never passes, quoted or not). At most 200 characters.
//   file, line, col   which of this app's own .js files and where; "other" for anything else
//   fp           8 hex: a fingerprint of kind, name, file, line and the cleaned message
//   screen, app_version
//
// No device id, no name, no workout, no stack. The server stores no IP and keys its limits by an HMAC
// (haimunia-app-demo 202611150003, client_error_report()).
//
// OFF IS OFF: it follows the usage-counting switch (src/usage.js). Off means nothing is sent and anything
// waiting is dropped.
// LIMITS: at most 5 reports per page load, one per fingerprint a day, and at most 8 waiting for a connection.
// NEVER IN THE WAY: every failure is swallowed; nothing here throws, waits or retries in a loop.
(function (global) {
  "use strict";
  var SENT_KEY = "haimunia:errorReportDays";    // { fp: "YYYY-MM-DD" }
  var PENDING_KEY = "haimunia:errorReportsPending"; // [report, ...]
  var PAGE_CAP = 5;
  var MAX_PENDING = 8;
  var SCREENS = { add: 1, history: 1, calendar: 1, wod: 1, club: 1, settings: 1, other: 1 };
  var sentThisPage = 0;
  var seenThisPage = {};

  function ls(fn) { try { return fn(global.localStorage); } catch (e) { return null; } }
  function readJson(key, fallback) {
    var raw = ls(function (s) { return s.getItem(key); });
    if (!raw) return fallback;
    try { var v = JSON.parse(raw); return v && typeof v === "object" ? v : fallback; } catch (e) { return fallback; }
  }
  function writeJson(key, value) { ls(function (s) { s.setItem(key, JSON.stringify(value)); }); }
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function isOn() {
    try { return !global.HaimuniaUsage || global.HaimuniaUsage.isOn(); } catch (e) { return false; }
  }
  function endpoint() {
    var c = (global.HAIMUNIA_CONFIG && global.HAIMUNIA_CONFIG.usage) || null;
    if (!c || typeof c.url !== "string" || typeof c.key !== "string" || !c.url || !c.key) return null;
    return { url: c.url.replace(/\/+$/, "") + "/rest/v1/rpc/client_error_report", key: c.key };
  }

  // FNV-1a, 32 bits, as 8 hex.
  function fnv1a(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  // The message, with nothing a member could have written left in it.
  function sanitize(message) {
    var m = String(message == null ? "" : message);
    // A JSON error quotes or describes the input after its colon ("JSON.parse: unexpected character at
    // line 1 ..." / "Unexpected token 'a', "abc" is not valid JSON"): keep only what comes before it.
    if (/JSON/i.test(m)) {
      var colon = m.indexOf(":");
      if (colon >= 0) m = m.slice(0, colon);
    }
    m = m
      .replace(/"[^"]*"|'[^']*'|`[^`]*`|“[^”]*”|‘[^’]*’|«[^»]*»/g, "")   // quoted substrings
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, "")                       // URLs
      .replace(/\b(?:blob|data|javascript):\S*/gi, "")
      .replace(/[^\x20-\x7E]/g, "")                                       // anything not plain ASCII
      .replace(/\s+/g, " ")
      .trim();
    return m.slice(0, 200);
  }
  function errorName(err) {
    var n = err && (err.name || (err.constructor && err.constructor.name));
    return typeof n === "string" && /^[A-Za-z]{1,40}$/.test(n) ? n : null;
  }
  function errorMessage(err, fallback) {
    if (err && typeof err.message === "string") return err.message;
    if (typeof err === "string") return err;
    return typeof fallback === "string" ? fallback : "";
  }
  // Only this app's own scripts are named; anything else (an extension, a CDN, eval) is "other".
  function ownFile(filename) {
    try {
      if (!filename) return "other";
      var u = new URL(String(filename), global.location && global.location.href);
      if (global.location && u.origin !== global.location.origin) return "other";
      var base = u.pathname.split("/").pop();
      return /^[A-Za-z0-9_-]{1,60}\.js$/.test(base) ? base : "other";
    } catch (e) { return "other"; }
  }
  function toCount(n) {
    var v = Number(n);
    return Number.isFinite(v) && v >= 0 && v <= 10000000 ? Math.floor(v) : null;
  }
  function currentScreen() {
    try {
      var settings = global.document && global.document.getElementById("settingsOverlay");
      if (settings && settings.classList.contains("open")) return "settings";
      // app.js's top-level `tab`: classic scripts share one global lexical scope.
      var t = typeof tab === "string" ? tab : ""; // eslint-disable-line no-undef
      if (t === "add" || t === "history" || t === "calendar" || t === "wod" || t === "club") return t;
    } catch (e) { /* app.js not run yet */ }
    return "other";
  }
  function appVersion() {
    try { if (typeof APP_VERSION === "string" && /^[0-9A-Za-z._-]{1,20}$/.test(APP_VERSION)) return APP_VERSION; } catch (e) { /* TDZ */ } // eslint-disable-line no-undef
    return "unknown";
  }

  // The report as it is sent. Exposed for tests: the whole privacy argument is this shape.
  function describe(kind, err, info) {
    var i = info || {};
    var k = kind === "storage" ? "storage" : kind === "unhandledrejection" ? "unhandledrejection" : "error";
    var name = errorName(err);
    var file = ownFile(i.filename);
    var line = toCount(i.lineno);
    var col = toCount(i.colno);
    var message = sanitize(errorMessage(err, i.message));
    var screen = SCREENS[i.screen] ? i.screen : currentScreen();
    return {
      p_app_version: appVersion(),
      p_screen: screen,
      p_kind: k,
      p_name: name,
      p_message: message,
      p_file: file,
      p_line: line,
      p_col: col,
      p_fp: fnv1a([k, name || "", file, line == null ? "" : line, message].join("|")),
    };
  }

  function post(report, ep) {
    return global.fetch(ep.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ep.key, Prefer: "return=minimal" },
      body: JSON.stringify(report),
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }).then(function (res) { return !!(res && res.ok); }, function () { return false; });
  }
  function online() { return !(global.navigator && global.navigator.onLine === false); }
  function queue(report) {
    var list = readJson(PENDING_KEY, []);
    if (!Array.isArray(list)) list = [];
    if (list.some(function (r) { return r && r.p_fp === report.p_fp; })) return;
    list.push(report);
    writeJson(PENDING_KEY, list.slice(-MAX_PENDING));
  }
  function markSent(fp) {
    var sent = readJson(SENT_KEY, {});
    var t = today();
    Object.keys(sent).forEach(function (k) { if (sent[k] !== t) delete sent[k]; }); // only today's matter
    sent[fp] = t;
    writeJson(SENT_KEY, sent);
  }

  // Returns a promise that always resolves (to whether a report was sent).
  function report(kind, err, info) {
    try {
      if (!isOn()) return Promise.resolve(false);
      if (sentThisPage >= PAGE_CAP) return Promise.resolve(false);
      var r = describe(kind, err, info);
      if (seenThisPage[r.p_fp]) return Promise.resolve(false);
      if (readJson(SENT_KEY, {})[r.p_fp] === today()) return Promise.resolve(false);
      seenThisPage[r.p_fp] = true;
      sentThisPage++;
      var ep = endpoint();
      if (!ep) return Promise.resolve(false);
      if (typeof global.fetch !== "function" || !online()) { queue(r); return Promise.resolve(false); }
      return post(r, ep).then(function (ok) { if (ok) markSent(r.p_fp); else queue(r); return ok; }, function () { queue(r); return false; });
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  // Sends what waited for a connection, once. Off drops it.
  function flush() {
    try {
      var list = readJson(PENDING_KEY, []);
      if (!Array.isArray(list) || !list.length) return Promise.resolve(0);
      if (!isOn()) { ls(function (s) { s.removeItem(PENDING_KEY); }); return Promise.resolve(0); }
      var ep = endpoint();
      if (!ep || typeof global.fetch !== "function" || !online()) return Promise.resolve(0);
      ls(function (s) { s.removeItem(PENDING_KEY); });
      return Promise.all(list.map(function (r) {
        return post(r, ep).then(function (ok) { if (ok) markSent(r.p_fp); else queue(r); return ok; });
      })).then(function (res) { return res.filter(Boolean).length; }, function () { return 0; });
    } catch (e) {
      return Promise.resolve(0);
    }
  }

  function install() {
    if (typeof global.addEventListener !== "function") return;
    global.addEventListener("error", function (event) {
      try {
        if (!event || (typeof event.message !== "string" && !event.error)) return; // a resource load, not a script error
        report("error", event.error, { filename: event.filename, lineno: event.lineno, colno: event.colno, message: event.message });
      } catch (e) { /* never in the way */ }
    });
    global.addEventListener("unhandledrejection", function (event) {
      try { report("unhandledrejection", event ? event.reason : undefined, {}); } catch (e) { /* never in the way */ }
    });
    global.addEventListener("online", function () { flush(); });
    setTimeout(function () { flush(); }, 0);
  }

  global.HaimuniaErrors = Object.freeze({ report: report, describe: describe, sanitize: sanitize, flush: flush });
  install();
})(typeof window !== "undefined" ? window : globalThis);

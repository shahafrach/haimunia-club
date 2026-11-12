// ANONYMOUS USAGE COUNTING.
//
// The club wants to know how many people use this app and how many log
// workouts. The app has no accounts and keeps everything on the phone, so the
// only way to know is for the app to say so - and this file is the whole of
// what it says:
//
//   device_id  a random id made on this phone the first time it counts
//   event      "app_open", "workout_logged" or "screen_open"
//   screen     which of the four screens, for "screen_open" only
//
// No name, no workout, no weight, no date or time (the server stamps the
// day), no account. One fact is sent at most once a day per device, because
// that is all the club's report ever reads; the server drops repeats too.
//
// OFF IS OFF. Settings has a switch. Turning it off stops every request and
// forgets this phone's id, so turning it back on later is a new device.
//
// NEVER IN THE WAY. Offline, blocked, misconfigured, the server down - every
// failure is swallowed. Nothing waits on this, nothing retries in a loop, and
// the app does not know or care whether a count arrived. A fact that could
// not be sent is kept (a handful at most) and tried once more the next time
// the app counts something.
(function (global) {
  "use strict";
  var OFF_KEY = "haimunia:usageCountingOff";   // "1" when the member turned it off
  var DEVICE_KEY = "haimunia:usageDeviceId";
  var SENT_KEY = "haimunia:usageSentDays";     // { "event|screen": "YYYY-MM-DD" }
  var PENDING_KEY = "haimunia:usagePending";   // ["event|screen", ...]
  var EVENTS = { app_open: 1, workout_logged: 1, screen_open: 1 };
  var SCREENS = { add: 1, history: 1, calendar: 1, wod: 1 };
  var MAX_PENDING = 8;

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
  function endpoint() {
    var c = (global.HAIMUNIA_CONFIG && global.HAIMUNIA_CONFIG.usage) || null;
    if (!c || typeof c.url !== "string" || typeof c.key !== "string" || !c.url || !c.key) return null;
    return { url: c.url.replace(/\/+$/, "") + "/rest/v1/training_log_usage", key: c.key };
  }
  function isOn() { return ls(function (s) { return s.getItem(OFF_KEY); }) !== "1"; }
  function newId() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") return global.crypto.randomUUID();
    var b = new Uint8Array(16);
    global.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function deviceId() {
    var id = ls(function (s) { return s.getItem(DEVICE_KEY); });
    if (id && /^[0-9a-f-]{36}$/i.test(id)) return id;
    id = newId();
    ls(function (s) { s.setItem(DEVICE_KEY, id); });
    return id;
  }
  function factKey(event, screen) { return event + "|" + (screen || ""); }

  function send(key, ep) {
    var parts = key.split("|");
    var body = { device_id: deviceId(), event: parts[0] };
    if (parts[1]) body.screen = parts[1];
    return global.fetch(ep.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ep.key, Prefer: "return=minimal" },
      body: JSON.stringify(body),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      // No keepalive: the apikey/Prefer headers make this a CORS-preflighted
      // request, and keepalive with a preflight has been refused by some
      // browsers. Nothing here is sent at unload, so it would buy nothing.
    }).then(function (res) { return !!(res && res.ok); }, function () { return false; });
  }

  function markSent(key) {
    var sent = readJson(SENT_KEY, {});
    sent[key] = today();
    writeJson(SENT_KEY, sent);
  }
  function setPending(list) { writeJson(PENDING_KEY, list.slice(-MAX_PENDING)); }
  // Two counts can be in flight at once (app_open and the first screen fire
  // together on open), so the pending list is re-read and merged, never
  // overwritten: overwriting let the second failure erase the first.
  function settlePending(sentOk, failed) {
    var current = readJson(PENDING_KEY, []);
    if (!Array.isArray(current)) current = [];
    var next = current.filter(function (k) { return sentOk.indexOf(k) === -1; });
    failed.forEach(function (k) { if (next.indexOf(k) === -1) next.push(k); });
    setPending(next);
  }

  // Returns a promise that always resolves (to whether anything was sent), so
  // a caller may await it in a test and must never need to catch it.
  function count(event, screen) {
    try {
      if (!EVENTS[event]) return Promise.resolve(false);
      if (event === "screen_open" ? !SCREENS[screen] : screen) return Promise.resolve(false);
      if (!isOn()) return Promise.resolve(false);
      var ep = endpoint();
      if (!ep || typeof global.fetch !== "function") return Promise.resolve(false);
      var key = factKey(event, screen);
      var sent = readJson(SENT_KEY, {});
      var pending = readJson(PENDING_KEY, []);
      if (!Array.isArray(pending)) pending = [];
      var queue = pending.filter(function (k) { return k !== key; });
      if (sent[key] !== today()) queue.push(key);
      if (!queue.length) return Promise.resolve(false);
      if (global.navigator && global.navigator.onLine === false) { settlePending([], queue); return Promise.resolve(false); }
      return Promise.all(queue.map(function (k) {
        return send(k, ep).then(function (ok) { if (ok) markSent(k); return ok; });
      })).then(function (results) {
        settlePending(queue.filter(function (_, i) { return results[i]; }), queue.filter(function (_, i) { return !results[i]; }));
        return results.some(Boolean);
      }, function () { return false; });
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function setOn(on) {
    ls(function (s) {
      if (on) { s.removeItem(OFF_KEY); return; }
      s.setItem(OFF_KEY, "1");
      s.removeItem(DEVICE_KEY);
      s.removeItem(SENT_KEY);
      s.removeItem(PENDING_KEY);
    });
  }

  global.HaimuniaUsage = Object.freeze({ count: count, isOn: isOn, setOn: setOn });
})(typeof window !== "undefined" ? window : globalThis);

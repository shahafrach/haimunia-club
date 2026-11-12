"use strict";
// ---- Transfer code: bring a log over from the old app --------------------------------
//
// The old app (haimuniya.github.io) encrypts a backup ON THE PHONE and uploads only ciphertext,
// under a lookup derived from a one-time code the member copies. This side takes it once, decrypts
// it ON THIS PHONE and merges it through the same import path as a backup file. The key exists only
// in the code: the server never sees it, so it cannot read the log (body weight included).
// The protocol is fixed by haimunia-app-demo (docs/club/research.md D, test/transfer-edge-functions.test.mjs):
//   code      13 random bytes, shown as 21 Crockford base32 characters (4-4-4-4-5)
//   HKDF      SHA-256, empty salt; info "haimunia-transfer:lookup:v1" -> 32 bytes (hex = lookup)
//                                       "haimunia-transfer:key:v1"    -> AES-GCM-256 key
//   AES-GCM   12-byte IV, AAD "haimunia-transfer:v1"; plaintext = gzip(JSON backup, optional "prefs")
//   take      POST {supabaseUrl}/functions/v1/transfer-take {lookup} -> {iv, ciphertext} (base64), ONCE
//
// Installed app only: an iPhone's home-screen app has storage separate from Safari's, so a log
// imported in a browser tab would be invisible to the installed app. The decrypted data stays in
// memory while the dialog is open and is never written anywhere except through the import.
//
// Classic script, one IIFE, exports window.haimuniaTransfer. Reads esc, isStandalone, importBackupData,
// downloadBackup, todayISO, render from the shared scope, only inside function bodies.
(function () {
  var ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  var CODE_CHARS = 21, CODE_BYTES = 13;
  var AAD = "haimunia-transfer:v1";
  var INFO_LOOKUP = "haimunia-transfer:lookup:v1", INFO_KEY = "haimunia-transfer:key:v1";
  var MAX_PLAIN = 25 * 1024 * 1024; // the same cap as a backup file
  var TIMEOUT_MS = 20000;

  var T = { view: "", busy: false, error: "", draft: "", payload: null, message: "" };
  var opener = null;

  function el(id) { return document.getElementById(id); }
  function isOpen() { var o = el("transferOverlay"); return !!(o && o.classList.contains("open")); }
  function cfg() { return (window.HAIMUNIA_CONFIG && window.HAIMUNIA_CONFIG.cloud) || null; }
  function installed() { return typeof isStandalone === "function" ? isStandalone() : false; }
  function webCrypto() { return window.crypto && window.crypto.subtle ? window.crypto : null; }

  // ---- The code ----------------------------------------------------------------------
  /** The 13 bytes behind a typed code, or null. Case, spaces and dashes do not matter; O reads as 0, I and L as 1. */
  function decodeCode(text) {
    var s = String(text == null ? "" : text).toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
    if (s.length !== CODE_CHARS) return null;
    var bits = 0, acc = 0, out = [];
    for (var i = 0; i < s.length; i++) {
      var v = ALPHABET.indexOf(s.charAt(i));
      if (v < 0) return null;
      acc = (acc << 5) | v; bits += 5;
      if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); acc &= (1 << bits) - 1; }
    }
    return out.length === CODE_BYTES ? new Uint8Array(out) : null;
  }
  function groupCode(text) {
    var s = String(text || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, CODE_CHARS);
    return [s.slice(0, 4), s.slice(4, 8), s.slice(8, 12), s.slice(12, 16), s.slice(16)].filter(Boolean).join("-");
  }
  var enc = function (t) { return new TextEncoder().encode(t); };
  var hex = function (u8) { return Array.prototype.map.call(u8, function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); };
  function fromB64(b64) { var bin = atob(b64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

  async function derive(codeBytes) {
    var subtle = webCrypto().subtle;
    var base = await subtle.importKey("raw", codeBytes, "HKDF", false, ["deriveBits", "deriveKey"]);
    var salt = new Uint8Array(0);
    var lookup = new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt, info: enc(INFO_LOOKUP) }, base, 256));
    var key = await subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: salt, info: enc(INFO_KEY) }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    return { lookup: hex(lookup), key: key };
  }
  async function gunzip(bytes) {
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    var reader = stream.getReader(), chunks = [], total = 0;
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      total += r.value.length;
      if (total > MAX_PLAIN) { try { await reader.cancel(); } catch (e) {} throw new Error("too_large"); }
      chunks.push(r.value);
    }
    var out = new Uint8Array(total), at = 0;
    chunks.forEach(function (c) { out.set(c, at); at += c.length; });
    return out;
  }

  /** Everything between the typed code and the decoded backup. Throws an Error whose message is a reason code. */
  async function fetchAndDecrypt(code) {
    var c = cfg();
    if (!c || !c.supabaseUrl) throw new Error("not_configured");
    if (!webCrypto() || typeof DecompressionStream !== "function") throw new Error("no_crypto");
    var bytes = decodeCode(code);
    if (!bytes) throw new Error("bad_code");
    var d = await derive(bytes);
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);
    var res;
    try {
      res = await fetch(c.supabaseUrl + "/functions/v1/transfer-take", {
        method: "POST", headers: { "Content-Type": "application/json", apikey: c.supabasePublishableKey },
        body: JSON.stringify({ lookup: d.lookup }), signal: ctl ? ctl.signal : undefined, cache: "no-store", credentials: "omit",
      });
    } catch (e) { throw new Error("network"); } finally { clearTimeout(timer); }
    if (res.status === 404) throw new Error("not_found");
    if (res.status === 429) throw new Error("rate_limited");
    if (!res.ok) throw new Error("server");
    var body;
    try { body = await res.json(); } catch (e) { throw new Error("server"); }
    var plain;
    try {
      plain = await webCrypto().subtle.decrypt({ name: "AES-GCM", iv: fromB64(body.iv), additionalData: enc(AAD) }, d.key, fromB64(body.ciphertext));
    } catch (e) { throw new Error("decrypt"); }
    var json;
    try { json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await gunzip(new Uint8Array(plain)))); }
    catch (e) { throw new Error(e && e.message === "too_large" ? "too_large" : "unreadable"); }
    if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("unreadable");
    return json;
  }

  var ERRORS = {
    bad_code: "הקוד לא נראה תקין. הוא באורך 21 תווים, למשל XXXX-XXXX-XXXX-XXXX-XXXXX.",
    not_found: "הקוד לא נמצא. הוא תקף פעם אחת ו-24 שעות בלבד. אפשר ליצור קוד חדש באפליקציה הישנה.",
    rate_limited: "יותר מדי ניסיונות. אפשר לנסות שוב בעוד רבע שעה.",
    network: "אין חיבור כרגע. אפשר לנסות שוב כשהחיבור חוזר. הקוד לא נוצל.",
    server: "השרת לא ענה כמו שצריך. אפשר לנסות שוב בעוד רגע.",
    decrypt: "לא הצלחנו לפענח את ההעברה. ייתכן שהקוד נכתב לא נכון. אפשר ליצור קוד חדש.",
    unreadable: "ההעברה התקבלה אבל אי אפשר לקרוא אותה. אפשר ליצור קוד חדש.",
    too_large: "ההעברה גדולה מדי (מעל 25MB). אפשר להשתמש בקובץ גיבוי.",
    no_crypto: "הדפדפן הזה לא תומך בהעברה מוצפנת. אפשר להשתמש בקובץ גיבוי.",
    not_configured: "ההעברה לא מוגדרת בגרסה הזאת.",
  };

  // ---- Flow --------------------------------------------------------------------------
  async function submit(form) {
    var code = String(form.elements.code.value || "");
    T.draft = groupCode(code);
    if (!decodeCode(code)) { T.error = ERRORS.bad_code; return paint(); }
    T.busy = true; T.error = ""; paint();
    var data;
    try { data = await fetchAndDecrypt(code); }
    catch (e) {
      T.busy = false; T.error = ERRORS[e && e.message] || ERRORS.server; return paint();
    }
    // The code is now spent. Keep what came in memory until it is safely imported or saved as a file.
    T.payload = data; T.draft = ""; T.busy = false;
    await runImport();
  }
  async function runImport() {
    if (!T.payload) return;
    T.busy = true; T.error = ""; paint();
    var ok = false;
    try { ok = await importBackupData(T.payload, { prefs: T.payload.prefs }); } catch (e) { ok = false; }
    T.busy = false;
    if (ok) { T.payload = null; T.view = "done"; T.message = "הלוג עבר לטלפון הזה."; }
    else { T.view = "keep"; }
    paint();
  }
  function saveFile() {
    if (!T.payload) return;
    var copy = Object.assign({}, T.payload); delete copy.prefs;
    if (typeof downloadBackup === "function") downloadBackup(copy, "box-log-transfer-" + todayISO() + ".json");
  }

  // ---- Screens -----------------------------------------------------------------------
  function head(t, sub) {
    return '<div style="text-align:center; margin-bottom:16px;"><div style="font-weight:800; font-size:17px; margin-bottom:4px;">' + esc(t) + "</div>" +
      (sub ? '<div style="color:var(--steel); font-size:13px; line-height:1.55;">' + esc(sub) + "</div>" : "") + "</div>";
  }
  function viewHtml() {
    if (T.busy) return head("רגע, מעבירים…", "הפענוח קורה בטלפון הזה.");
    if (T.view === "done") return head("ההעברה הושלמה", T.message) + '<button type="button" class="save-btn" data-transfer="close" style="max-width:none;">סגירה</button>';
    if (T.view === "keep") {
      return head("ההעברה התקבלה ולא נשמרה עדיין", "הקוד כבר נוצל, אבל הנתונים עדיין כאן. אפשר לנסות לייבא שוב, או לשמור אותם כקובץ גיבוי. כשסוגרים את החלון הם נמחקים מהזיכרון.") +
        '<button type="button" class="save-btn" data-transfer="retry" style="max-width:none; margin-bottom:10px;">ניסיון חוזר לייבא</button>' +
        '<button type="button" class="chip-btn" data-transfer="file" style="width:100%; margin-bottom:10px;">שמירה כקובץ גיבוי</button>' +
        '<div style="text-align:center;"><button type="button" class="link-btn link-btn--tap" data-transfer="close">סגירה בלי לשמור</button></div>';
    }
    if (!installed()) {
      return head("קודם מתקינים", "ההעברה נעשית רק באפליקציה שהותקנה במסך הבית. קודם מוסיפים את האפליקציה למסך הבית, פותחים אותה מהאייקון, ואז מדביקים את הקוד כאן.") +
        '<button type="button" class="save-btn" data-transfer="close" style="max-width:none;">הבנתי</button>';
    }
    return head("העברה מהאפליקציה הישנה", "באפליקציה הישנה מבקשים קוד העברה, ומדביקים אותו כאן. הוא תקף פעם אחת ו-24 שעות. הרישומים, כולל משקל הגוף, עוברים מוצפנים ומתווספים לנתונים שכבר יש כאן.") +
      (T.error ? '<div role="alert" class="settings-warn">⚠️<span>' + esc(T.error) + "</span></div>" : "") +
      '<form data-transfer-form novalidate>' +
      '<label for="transferCode" style="display:block; color:var(--steel); font-size:12px; margin-bottom:6px;">קוד העברה</label>' +
      '<input id="transferCode" name="code" class="text-input" type="text" dir="ltr" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="26" inputmode="text" placeholder="XXXX-XXXX-XXXX-XXXX-XXXXX" value="' + esc(T.draft) + '" style="margin-bottom:14px; text-align:center; letter-spacing:1px;" />' +
      '<button type="submit" class="save-btn" style="max-width:none; margin-bottom:10px;">העברה</button></form>' +
      '<div style="text-align:center;"><button type="button" class="link-btn link-btn--tap" data-transfer="close">ביטול</button></div>';
  }
  function paint() {
    var body = el("transferBody");
    if (!body) return;
    body.innerHTML = viewHtml();
    var f = body.querySelector("input, button.save-btn");
    if (f && !T.busy) { try { f.focus(); } catch (e) {} }
  }

  function open() {
    var o = el("transferOverlay");
    if (!o) return;
    T = { view: "", busy: false, error: "", draft: "", payload: null, message: "" };
    opener = document.activeElement;
    document.body.style.overflow = "hidden";
    o.classList.add("open");
    paint();
  }
  function close() {
    var o = el("transferOverlay");
    if (!o) return;
    o.classList.remove("open");
    T.payload = null; T.draft = "";
    if (typeof releaseScrollLockIfLastDialog === "function") releaseScrollLockIfLastDialog(); else document.body.style.overflow = "";
    if (opener && typeof opener.focus === "function") { try { opener.focus(); } catch (e) {} }
    opener = null;
    if (typeof render === "function") render();
  }

  function onClick(e) {
    var t = e.target.closest && e.target.closest("[data-transfer]");
    if (!t) return;
    var a = t.getAttribute("data-transfer");
    if (a === "close") close();
    else if (a === "retry") runImport();
    else if (a === "file") saveFile();
  }
  function onSubmit(e) {
    var f = e.target.closest && e.target.closest("[data-transfer-form]");
    if (!f) return;
    e.preventDefault();
    if (!T.busy) submit(f);
  }
  function onInput(e) {
    if (e.target && e.target.id === "transferCode") {
      var g = groupCode(e.target.value);
      if (g !== e.target.value) e.target.value = g;
    }
  }
  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);
  document.addEventListener("input", onInput);

  window.haimuniaTransfer = { open: open, close: close, isOpen: isOpen, decodeCode: decodeCode, groupCode: groupCode, fetchAndDecrypt: fetchAndDecrypt };
})();

"use strict";
// ---- Connected mode: sign in with a username, join the club ----------------------
//
// OFF UNTIL THE MEMBER CHOOSES IT. Opening the app never touches the network for
// anyone who stayed offline: the Supabase library (vendor/supabase.js) and the
// Turnstile script are loaded only after a member taps "connect" (or on a device
// that already chose to be connected). The private log never leaves the phone;
// this module only handles who the member is and whether they are in the club.
//
// Sign-in is a username mapped to a synthetic address that can never receive mail
// (no email, no phone). Sign-up is: anonymous session (Turnstile) -> username and
// password -> a recovery code shown once -> join the club by the one fixed link ->
// the name the club sees. The backend is in haimuniya/haimunia-app-demo.
//
// Classic script, one IIFE, exports window.haimuniaConnect. It reads esc, bidiText,
// ICONS-free markup, dbGetSetting/dbSetSetting, userName and showToast from the
// shared scope, only inside function bodies.
(function () {
  var CHOICE_KEY = "haimunia:connectChoice"; // "offline" | "connected"
  var AUTH_STORAGE_KEY = "haimunia:auth";
  var TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  var USERNAME_RE = /^[a-z0-9_]{3,24}$/;
  var TOKEN_RE = /^[0-9a-f]{64}$/;
  // Q-37: the club link's short code (backend 202611180002): 8 of 31 characters, no 0, O, 1, I, L.
  var CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;
  var USERNAME_RULE = "3 עד 24 אותיות אנגליות קטנות, ספרות או קו תחתון";
  // Q-38g (owner, 2026-11-18): length is the whole rule, the same on the server (haimunia-app-demo #189).
  var PASSWORD_RULE = "לפחות 10 תווים";
  var RECOVERY_CODE_KEY = "haimunia:recoveryCode";
  var APP_NAME = "club";

  var S = {
    view: "", busy: false, error: "", errors: {}, drafts: {},
    code: "", saved: false, copied: false,
    user: null, profile: null, inClub: null, // inClub: null = unknown
    clubId: null, role: null, clubName: "",
    choice: null, firstRun: false, offline: false,
  };
  var client = null;
  var libPromise = null;
  var scriptPromises = {};
  var joinToken = null; // the link's token or code, in memory only, never stored or sent anywhere but join_circle
  var opener = null;

  function cfg() { return (window.HAIMUNIA_CONFIG && window.HAIMUNIA_CONFIG.cloud) || null; }
  function enabled() { var c = cfg(); return !!(c && c.supabaseUrl && c.supabasePublishableKey); }
  function el(id) { return document.getElementById(id); }
  function isOpen() { var o = el("connectOverlay"); return !!(o && o.classList.contains("open")); }

  // ---- The fixed link ------------------------------------------------------------
  // The short link "#j=<8-character code>" (Q-37), and the long "#join=<64 hex>", "#invite=<64 hex>" or
  // "#<64 hex>". Typed or pasted text may also be the code alone: any case, with spaces or dashes. Only the
  // fragment is read: it never reaches a server or a log. It is taken out of the address bar at once.
  function normCode(text) { return String(text == null ? "" : text).replace(/[\s\-\u2010-\u2015\u2212]/g, "").toUpperCase(); }
  function isCode(t) { return typeof t === "string" && CODE_RE.test(t); }
  function parseToken(text) {
    var raw = String(text == null ? "" : text).trim();
    if (!raw) return null;
    var at = raw.indexOf("#");
    var h = at >= 0 ? raw.slice(at + 1) : raw;
    var eq = h.indexOf("=");
    if (eq >= 0) {
      var key = h.slice(0, eq).toLowerCase();
      var val = h.slice(eq + 1);
      if (key === "j") { var c = normCode(val); return isCode(c) ? c : null; }
      if (key !== "join" && key !== "invite") return null;
      h = val.trim().toLowerCase();
      return TOKEN_RE.test(h) ? h : null;
    }
    if (at >= 0 || TOKEN_RE.test(raw.toLowerCase())) { h = h.trim().toLowerCase(); return TOKEN_RE.test(h) ? h : null; }
    var code = normCode(raw);
    return isCode(code) ? code : null;
  }
  function installed() { return typeof isStandalone === "function" ? !!isStandalone() : false; }
  function onIOS() { return typeof isIOSDevice === "function" ? !!isIOSDevice() : false; }
  function takeTokenFromAddress() {
    var t = parseToken(location.hash);
    if (!t) return;
    joinToken = t;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  }

  // ---- Loading the two outside pieces, on demand ------------------------------------
  function loadScript(src, key) {
    if (scriptPromises[key]) return scriptPromises[key];
    if ((key === "supabase" && window.supabase) || (key === "turnstile" && window.turnstile)) return Promise.resolve();
    scriptPromises[key] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { delete scriptPromises[key]; reject(new Error("load failed: " + key)); };
      document.head.appendChild(s);
    });
    return scriptPromises[key];
  }
  function getClient() {
    if (client) return Promise.resolve(client);
    if (!enabled()) return Promise.reject(new Error("not configured"));
    if (!libPromise) {
      libPromise = loadScript("./vendor/supabase.js", "supabase").then(function () {
        var c = cfg();
        client = window.supabase.createClient(c.supabaseUrl, c.supabasePublishableKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_STORAGE_KEY,
            // Q-38c: Supabase's native passkeys (Face ID / Touch ID). Experimental: opt-in, see decisions.md.
            experimental: { passkey: true } },
        });
        return client;
      }).catch(function (e) { libPromise = null; throw e; });
    }
    return libPromise;
  }

  // Turnstile: an invisible, single-use token for each sign-up / sign-in call. A failed
  // challenge blocks the call; it never falls through to one without a token.
  function captchaToken() {
    var c = cfg();
    if (!c || !c.captchaSiteKey) return Promise.resolve(undefined);
    return loadScript(TURNSTILE_URL, "turnstile").then(function () {
      return new Promise(function (resolve, reject) {
        var api = window.turnstile;
        if (!api || typeof api.render !== "function") return reject(new Error("captcha unavailable"));
        var host = document.createElement("div");
        host.style.display = "none";
        document.body.appendChild(host);
        var done = false;
        function finish(fn, v) { if (done) return; done = true; clearTimeout(timer); try { host.remove(); } catch (e) {} fn(v); }
        var timer = setTimeout(function () { finish(reject, new Error("captcha timed out")); }, 20000);
        try {
          api.render(host, {
            sitekey: c.captchaSiteKey, size: "invisible",
            callback: function (t) { finish(resolve, t); },
            "error-callback": function () { finish(reject, new Error("captcha failed")); },
            "expired-callback": function () { finish(reject, new Error("captcha expired")); },
          });
          if (typeof api.execute === "function") api.execute(host);
        } catch (e) { finish(reject, e); }
      });
    });
  }
  function withCaptcha(fn) {
    return captchaToken().then(fn, function () { return { error: { message: "captcha_failed" } }; });
  }

  // ---- Rules -----------------------------------------------------------------------
  function normUser(v) { return String(v || "").trim().toLowerCase(); }
  function usernameError(v) {
    var u = normUser(v);
    if (!u) return "יש להזין שם לכניסה";
    if (u.length < 3) return "שם הכניסה קצר מדי. צריך " + USERNAME_RULE + ".";
    if (u.length > 24) return "שם הכניסה ארוך מדי. צריך " + USERNAME_RULE + ".";
    if (!USERNAME_RE.test(u)) return "בשם הכניסה אפשר להשתמש באותיות אנגליות, בספרות ובקו תחתון בלבד.";
    return "";
  }
  function passwordError(v) {
    var p = String(v || "");
    if (!p) return "יש להזין סיסמה";
    if (p.length < 10) return "הסיסמה קצרה מדי. צריך " + PASSWORD_RULE + ".";
    if (p.length > 72) return "הסיסמה ארוכה מדי. אפשר עד 72 תווים.";
    return "";
  }
  function toEmail(u) { return u + "@members.haimuniya.invalid"; }
  function isRateLimit(err) { return !!err && (err.status === 429 || /rate.?limit|too many/i.test(String(err.message || err.code || ""))); }
  function isNetwork(err) { return !!err && (/failed to fetch|network|load failed|timed_out|not configured/i.test(String(err.message || "")) || err.name === "AuthRetryableFetchError"); }
  function authErrorText(err) {
    if (!err) return "";
    if (err.message === "captcha_failed") return "אימות האבטחה נכשל, נסו שוב";
    if (isRateLimit(err)) return "יותר מדי הרשמות כרגע, נסו שוב בעוד שעה";
    if (isNetwork(err)) return "אין חיבור כרגע. בדקו את האינטרנט ונסו שוב";
    return "";
  }

  // ---- State from the server ---------------------------------------------------------
  function setChoice(v) {
    S.choice = v;
    try { dbSetSetting(CHOICE_KEY, v).catch(function () {}); } catch (e) {}
  }
  async function loadAccount() {
    var c = await getClient();
    var sess = await c.auth.getSession();
    var user = sess && sess.data && sess.data.session ? sess.data.session.user : null;
    S.user = user && !user.is_anonymous ? user : (user || null);
    S.profile = null; S.inClub = null; S.clubId = null; S.role = null; S.clubName = ""; S.shareDefaults = {};
    if (!user) { changed(); return; }
    // Only the club. The same account can also be in BOX-LOG couple or friends circles, which this
    // app never shows (decisions.md, "Haimunia club").
    var m = await c.from("circle_members").select("club_id,role,share_defaults,clubs!inner(type,name)")
      .eq("user_id", user.id).eq("clubs.type", "club");
    if (m.error) throw m.error;
    S.inClub = (m.data || []).length > 0;
    if (S.inClub) {
      S.clubId = m.data[0].club_id; S.role = m.data[0].role;
      S.clubName = (m.data[0].clubs && m.data[0].clubs.name) || "";
      S.shareDefaults = m.data[0].share_defaults && typeof m.data[0].share_defaults === "object" ? m.data[0].share_defaults : {};
    }
    var p = await c.from("profiles").select("display_name,emoji").eq("id", user.id).maybeSingle();
    if (p.error) throw p.error;
    S.profile = p.data || null;
    changed();
  }
  var listeners = [];
  function changed() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }
  function signedIn() { return !!(S.user && !S.user.is_anonymous); }
  function memberName() {
    if (S.profile && S.profile.display_name) return S.profile.display_name;
    return typeof userName === "string" && userName ? userName : "";
  }

  // After any sign-in or restore: where does this member go next?
  function nextView() {
    // Q-38b: a device that chose to connect and lost its session is told so (status), never sent back to
    // the first-run choice as if it had never had an account.
    if (!signedIn()) return S.choice === "connected" ? "status" : "choice";
    if (S.inClub === false) return "join";
    if (S.inClub && (!S.profile || !S.profile.display_name)) return "profile";
    return "status";
  }

  // ---- Actions -----------------------------------------------------------------------
  function fail(view, errors, text) { S.busy = false; S.view = view; S.errors = errors || {}; S.error = text || ""; paint(); }
  function formValue(form, name) { var f = form.elements[name]; return f ? String(f.value || "") : ""; }
  function keepDrafts(form) { S.drafts = {}; Array.prototype.forEach.call(form.elements, function (f) { if (f.name && f.type !== "password") S.drafts[f.name] = f.value; }); }

  async function doSignup(form) {
    var username = normUser(formValue(form, "username"));
    var password = formValue(form, "password");
    var errs = {};
    if (usernameError(username)) errs.username = usernameError(username);
    if (passwordError(password)) errs.password = passwordError(password);
    if (password !== formValue(form, "passwordConfirm")) errs.passwordConfirm = "הסיסמאות לא תואמות";
    keepDrafts(form);
    if (Object.keys(errs).length) return fail("signup", errs);
    S.busy = true; S.error = ""; S.errors = {}; paint();
    try {
      var c = await getClient();
      if (!S.user) {
        var anon = await withCaptcha(function (t) { return c.auth.signInAnonymously(t ? { options: { captchaToken: t } } : undefined); });
        if (anon.error) return fail("signup", {}, authErrorText(anon.error) || "לא ניתן להתחבר כרגע, נסו שוב");
        S.user = anon.data && anon.data.user;
      }
      var up = await withCaptcha(function (t) { return c.auth.updateUser({ email: toEmail(username), password: password }, t ? { captchaToken: t } : undefined); });
      if (up.error) {
        var taken = /registered|exists|taken/i.test(String(up.error.message || ""));
        return fail("signup", taken ? { username: "שם הכניסה הזה כבר תפוס. בחרו שם אחר." } : {}, taken ? "" : (authErrorText(up.error) || "השמירה נכשלה, נסו שוב"));
      }
      var ref = await c.auth.refreshSession().then(function (r) { return r; }, function () { return null; });
      S.user = ref && ref.data && ref.data.session ? ref.data.session.user : (up.data && up.data.user);
      setChoice("connected");
      offerSave(username, password);
      S.drafts = {}; S.inClub = false; S.profile = null; // a new account is in no circle yet
      await issueCode();
    } catch (e) { fail("signup", {}, authErrorText(e) || "לא ניתן להתחבר כרגע, נסו שוב"); }
  }

  async function issueCode() {
    S.busy = true; S.view = "code"; S.code = ""; S.saved = false; S.copied = false; S.error = ""; paint();
    try {
      var c = await getClient();
      var r = await c.functions.invoke("issue-recovery-code", { body: {} });
      if (r.error || !r.data || typeof r.data.recovery_code !== "string") throw new Error("no code");
      S.code = r.data.recovery_code;
      keepRecoveryCode(S.code);
      S.busy = false; paint();
    } catch (e) {
      // The account exists; only the code failed. Say so and let the member retry or carry on.
      S.busy = false; S.error = "לא הצלחנו ליצור קוד שחזור. בדקו את החיבור ונסו שוב."; paint();
    }
  }

  async function doLogin(form) {
    var username = normUser(formValue(form, "username"));
    var password = formValue(form, "password");
    keepDrafts(form);
    if (!username || !password) return fail("login", { password: "יש להזין שם לכניסה וסיסמה" });
    S.busy = true; S.error = ""; S.errors = {}; paint();
    try {
      var c = await getClient();
      var r = await withCaptcha(function (t) { return c.auth.signInWithPassword({ email: toEmail(username), password: password, options: t ? { captchaToken: t } : undefined }); });
      if (r.error) {
        var text = authErrorText(r.error);
        return fail("login", text ? {} : { password: "שם הכניסה או הסיסמה לא נכונים" }, text);
      }
      S.drafts = {};
      setChoice("connected");
      await loadAccount();
      S.busy = false;
      if (await shouldOfferRestore()) { S.view = "restore-offer"; paint(); return; }
      S.view = nextView(); paint();
      if (S.view === "join" && joinToken) joinWithToken(joinToken);
    } catch (e) { fail("login", {}, authErrorText(e) || "לא ניתן להתחבר כרגע, נסו שוב"); }
  }

  var JOIN_TEXT = {
    invalid: "הקוד או הקישור לא תקפים. בודקים את 8 התווים ומנסים שוב. הקוד העדכני נמצא בקבוצת המועדון, או ב-QR במכון.",
    circle_full: "המועדון מלא כרגע.",
    too_many_circles: "החשבון כבר חבר במספר המקסימלי של מעגלים.",
    rate_limited: "ניסיתם יותר מדי פעמים בשעה האחרונה. אפשר לנסות שוב בעוד שעה.",
    offline: "אין חיבור כרגע. אפשר לנסות שוב כשהחיבור חוזר.",
    error: "ההצטרפות לא הושלמה. אפשר לנסות שוב.",
  };
  async function joinWithToken(token) {
    if (S.busy) return;
    S.busy = true; S.error = ""; S.view = "join"; paint();
    var status = "error";
    try {
      var c = await getClient();
      var r = await c.rpc("join_circle", { p_token: token });
      if (r.error) status = isNetwork(r.error) ? "offline" : "error";
      else if (r.data && typeof r.data === "object") status = String(r.data.status || "error");
    } catch (e) { status = "offline"; }
    S.busy = false;
    if (status === "joined" || status === "already_member") {
      joinToken = null; S.drafts = {};
      try { await loadAccount(); } catch (e) { S.inClub = true; }
      // Q-37: the name from the welcome sheet becomes the club name, so the profile screen is skipped.
      // It still opens when there is no usable name, and the status screen can change it later.
      if (nextView() === "profile" && autoName()) await saveProfile(autoName(), "💪");
      S.view = nextView(); S.error = ""; paint();
      return;
    }
    // A token that cannot work is dropped; the others keep it for a retry.
    if (status === "invalid" || status === "circle_full" || status === "too_many_circles") joinToken = null;
    S.error = JOIN_TEXT[status] || JOIN_TEXT.error;
    paint();
  }

  // ---- Signing in and getting back in (Q-38c, Q-38d, Q-38e) ---------------------------------------------
  // Self-service only; no coach, no owner, no person. Face ID (a passkey, Supabase's native WebAuthn, relying
  // party haimunia.pages.dev) is offered right after sign-up and is the first button on every sign-in screen.
  // The password stays as a fallback. Forgot: Face ID, or the recovery code; when both are gone, a new account
  // with the club's join code (the training log is on the phone, never on the server; the old account is
  // deleted after a year without use, backend 202611180003).
  async function invokeFn(name, body) {
    try {
      var c = await getClient();
      var r = await c.functions.invoke(name, { body: body });
      if (r.error) return { ok: false, network: isNetwork(r.error) || r.error.name === "FunctionsFetchError" };
      return { ok: !!(r.data && r.data.ok), data: r.data || {} };
    } catch (e) { return { ok: false, network: true }; }
  }
  // Where the browser can store a password itself (Chrome, Android), it is offered; Safari offers from the form.
  function offerSave(username, password) {
    try {
      if (window.PasswordCredential && navigator.credentials && navigator.credentials.store) {
        navigator.credentials.store(new window.PasswordCredential({ id: username, password: password, name: username })).catch(function () {});
      }
    } catch (e) {}
  }
  async function signInAfterReset(username, password) {
    try {
      var c = await getClient();
      var r = await withCaptcha(function (t) { return c.auth.signInWithPassword({ email: toEmail(username), password: password, options: t ? { captchaToken: t } : undefined }); });
      if (r.error) return false;
      setChoice("connected");
      await loadAccount();
      offerSave(username, password);
      return true;
    } catch (e) { return false; }
  }
  function newPassword(form, errs) {
    var pw = formValue(form, "password");
    if (passwordError(pw)) errs.password = passwordError(pw);
    if (pw !== formValue(form, "passwordConfirm")) errs.passwordConfirm = "הסיסמאות לא תואמות";
    return pw;
  }
  async function afterReset(username, password, newRecoveryCode) {
    var ok = await signInAfterReset(username, password);
    S.busy = false; S.drafts = {}; S.error = ""; S.errors = {};
    if (!ok) { S.drafts = { username: username }; S.view = "login"; paint(); if (typeof showToast === "function") showToast("הסיסמה הוחלפה. נכנסים עם הסיסמה החדשה."); return; }
    if (newRecoveryCode) { S.code = newRecoveryCode; keepRecoveryCode(S.code); S.saved = false; S.copied = false; S.view = "code"; paint(); return; }
    S.view = nextView(); paint();
    if (typeof showToast === "function") showToast("הסיסמה הוחלפה. אתם מחוברים.");
    if (S.view === "join" && joinToken) joinWithToken(joinToken);
  }
  async function doRecover(form) {
    var username = normUser(formValue(form, "username"));
    var code = formValue(form, "recoveryCode");
    keepDrafts(form);
    var errs = {};
    if (usernameError(username)) errs.username = usernameError(username);
    if (String(code).replace(/[^A-Za-z0-9]/g, "").length !== 16) errs.recoveryCode = "קוד השחזור הוא 16 תווים, למשל 7K2M-QX9D-4HNC-WB8F.";
    var pw = newPassword(form, errs);
    if (Object.keys(errs).length) return fail("forgot", errs);
    S.busy = true; S.error = ""; S.errors = {}; paint();
    var r = await invokeFn("recover-password", { username: username, recovery_code: code, new_password: pw });
    if (!r.ok) return fail("forgot", {}, r.network ? NET_FAIL : "שם המשתמש או קוד השחזור לא נכונים.");
    await afterReset(username, pw, typeof r.data.recovery_code === "string" ? r.data.recovery_code : "");
  }

  // Q-38g (owner): the recovery code can be seen again while signed in on this phone. It is kept in the app's
  // own settings (IndexedDB), never sent anywhere, and forgotten on sign-out, account deletion or "delete
  // everything". Whoever holds this unlocked, signed-in phone already holds the account.
  function keepRecoveryCode(code) { try { dbSetSetting(RECOVERY_CODE_KEY, code || null).catch(function () {}); } catch (e) {} }
  function dropRecoveryCode() { keepRecoveryCode(null); }
  async function readRecoveryCode() { try { var v = await dbGetSetting(RECOVERY_CODE_KEY); return typeof v === "string" ? v : ""; } catch (e) { return ""; } }
  // One tap: a picture of the code, to the phone's share sheet (save to Photos, send to oneself); where files
  // cannot be shared, the picture downloads; with no canvas at all, the text is shared.
  function cssVar(name) { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) { return ""; } }
  function codeImageBlob(code, username) {
    return new Promise(function (resolve) {
      var c = document.createElement("canvas");
      var g = c.getContext && c.getContext("2d");
      if (!g || !c.toBlob) return resolve(null);
      c.width = 1080; c.height = 600;
      g.fillStyle = cssVar("--surface"); g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = cssVar("--chalk"); g.textAlign = "center"; g.direction = "rtl";
      g.font = "700 46px Rubik, system-ui, sans-serif"; g.fillText("קוד השחזור של האימוניה", 540, 120);
      if (username) { g.font = "400 36px Rubik, system-ui, sans-serif"; g.fillText("שם המשתמש: " + username, 540, 200); }
      g.direction = "ltr"; g.font = "800 72px ui-monospace, monospace"; g.fillText(code, 540, 330);
      g.direction = "rtl"; g.fillStyle = cssVar("--steel"); g.font = "400 32px Rubik, system-ui, sans-serif";
      g.fillText("שומרים במקום בטוח. בעזרתו מחליפים סיסמה שנשכחה.", 540, 450);
      c.toBlob(function (b) { resolve(b); }, "image/png");
    });
  }
  async function shareRecoveryCode() {
    var code = S.code;
    if (!code) return;
    var uname = S.user && S.user.email ? String(S.user.email).split("@")[0] : "";
    var blob = await codeImageBlob(code, uname);
    try {
      if (blob && typeof File === "function") {
        var file = new File([blob], "haimunia-recovery-code.png", { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) { await navigator.share({ files: [file], title: "קוד השחזור של האימוניה" }); return; }
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = "haimunia-recovery-code.png";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} }, 10000);
        return;
      }
      if (navigator.share) { await navigator.share({ title: "קוד השחזור של האימוניה", text: "קוד השחזור של האימוניה" + (uname ? " (" + uname + ")" : "") + ": " + code }); return; }
    } catch (e) { /* the member closed the share sheet */ return; }
    if (typeof showToast === "function") showToast("אפשר להעתיק את הקוד ולשמור אותו.");
  }

  function passkeyReady() { return !!(window.PublicKeyCredential && navigator.credentials); }
  function passkeyError(err) {
    var m = String((err && (err.code || err.error_code || err.name)) || "") + " " + String((err && err.message) || "");
    if (/NotAllowed|ABORT|cancel/i.test(m)) return "הכניסה עם " + passkeyName() + " בוטלה. אפשר לנסות שוב, או להיכנס עם הסיסמה.";
    if (/credential_not_found/i.test(m)) return "בטלפון הזה אין " + passkeyName() + " שמור לחשבון. נכנסים עם הסיסמה, ואז אפשר להפעיל " + passkeyName() + ".";
    if (isNetwork(err)) return NET_FAIL;
    return "הכניסה עם " + passkeyName() + " לא הצליחה. אפשר להיכנס עם הסיסמה.";
  }
  // Q-52: Safari keeps a tap's permission to start Face ID only until the first await, so the ceremony must start
  // inside the tap. The challenge is fetched before (preparePasskey, when a screen with the button opens) and the
  // button shows only once it is ready; the tap then calls navigator.credentials.get with nothing awaited first.
  // A client without the split calls (older vendored build, tests) keeps the one-call path.
  var PK = { prep: null, at: 0, loading: false, cond: null };
  function passkeySplit(c) { return !!(c && c.auth && c.auth._startPasskeyAuthentication && c.auth._verifyPasskeyAuthentication); }
  function passkeyName() {
    var ua = String((navigator && navigator.userAgent) || "");
    var touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    if (/iPhone|iPad|iPod/.test(ua) || touchMac) return "Face ID";
    if (/Macintosh/.test(ua)) return "Touch ID";
    return "טביעת אצבע או נעילת מסך";
  }
  function b64uToBuf(v) {
    var b = String(v || "").replace(/-/g, "+").replace(/_/g, "/"); while (b.length % 4) b += "=";
    var bin = atob(b), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  function bufToB64u(buf) {
    var bytes = new Uint8Array(buf), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function toRequestOptions(o) {
    try { if (window.PublicKeyCredential && PublicKeyCredential.parseRequestOptionsFromJSON) return PublicKeyCredential.parseRequestOptionsFromJSON(o); } catch (e) { /* by hand below */ }
    var r = Object.assign({}, o, { challenge: b64uToBuf(o.challenge) });
    if (Array.isArray(o.allowCredentials)) r.allowCredentials = o.allowCredentials.map(function (c) { return Object.assign({}, c, { id: b64uToBuf(c.id) }); });
    return r;
  }
  function credentialJSON(c) {
    try { if (c && typeof c.toJSON === "function") return c.toJSON(); } catch (e) { /* by hand below */ }
    var r = c.response;
    return { id: c.id, rawId: bufToB64u(c.rawId), type: c.type, authenticatorAttachment: c.authenticatorAttachment || null,
      clientExtensionResults: c.getClientExtensionResults ? c.getClientExtensionResults() : {},
      response: { clientDataJSON: bufToB64u(r.clientDataJSON), authenticatorData: bufToB64u(r.authenticatorData), signature: bufToB64u(r.signature), userHandle: r.userHandle ? bufToB64u(r.userHandle) : null } };
  }
  // Fetches a challenge ahead of the tap (good for two minutes), then repaints so the button appears, and starts
  // the quiet autofill offer on the username field (conditional mediation) where the browser has it.
  async function preparePasskey() {
    if (!passkeyReady() || PK.loading) return;
    if (PK.prep && Date.now() - PK.at < 120000) return;
    PK.loading = true;
    var had = !!PK.prep;
    try {
      var c = await getClient();
      if (passkeySplit(c)) {
        var r = await c.auth._startPasskeyAuthentication({ options: {} });
        PK.prep = r && r.data && r.data.options ? r.data : null; PK.at = Date.now();
      }
    } catch (e) { PK.prep = null; }
    finally { PK.loading = false; }
    if (!had && el("connectBody") && /^(login|forgot|choice|status)$/.test(S.view || "choice")) paint();
    startConditionalPasskey();
  }
  function startConditionalPasskey() {
    var prep = PK.prep;
    if (!prep || PK.cond || S.view !== "login" || !el("connect-username")) return;
    if (!window.PublicKeyCredential || !PublicKeyCredential.isConditionalMediationAvailable) return;
    PublicKeyCredential.isConditionalMediationAvailable().then(function (ok) {
      if (!ok || PK.cond || PK.prep !== prep) return;
      var ac = new AbortController(); PK.cond = ac;
      var p;
      try { p = navigator.credentials.get({ mediation: "conditional", publicKey: toRequestOptions(prep.options), signal: ac.signal }); } catch (e) { PK.cond = null; return; }
      p.then(function (cred) { PK.cond = null; if (cred) { PK.prep = null; S.busy = true; paint(); finishPasskey(cred, prep, "login"); } },
        function () { PK.cond = null; });
    }, function () {});
  }
  // The button: shown once the tap can start Face ID at once (a prepared challenge, or the one-call client).
  function passkeyBtn() {
    if (!passkeyReady()) return "";
    var ready = PK.prep || (client && client.auth && client.auth.signInWithPasskey && !passkeySplit(client));
    if (!ready) { setTimeout(preparePasskey, 0); return ""; }
    return btn("כניסה עם " + passkeyName(), 'data-connect="passkey-signin"');
  }
  function doPasskeySignIn() {
    if (S.busy) return;
    var from = S.view || "login";
    var prep = PK.prep;
    if (prep && client && passkeySplit(client)) {
      if (PK.cond) { try { PK.cond.abort(); } catch (e) {} PK.cond = null; }
      var p;
      // Nothing awaited before this call: it runs inside the tap.
      try { p = navigator.credentials.get({ publicKey: toRequestOptions(prep.options) }); } catch (e) { fail(from, {}, passkeyError(e)); return; }
      PK.prep = null;
      S.busy = true; S.error = ""; S.errors = {}; paint();
      p.then(function (cred) { return finishPasskey(cred, prep, from); }, function (e) { fail(from, {}, passkeyError(e)); setTimeout(preparePasskey, 0); });
      return;
    }
    legacyPasskeySignIn(from);
  }
  async function finishPasskey(cred, prep, from) {
    try {
      var c = await getClient();
      var r = await c.auth._verifyPasskeyAuthentication({ challengeId: prep.challenge_id, credential: credentialJSON(cred) });
      if (r && r.error) { setTimeout(preparePasskey, 0); return fail(from, {}, passkeyError(r.error)); }
      await afterPasskeySignIn();
    } catch (e) { setTimeout(preparePasskey, 0); fail(from, {}, passkeyError(e)); }
  }
  async function afterPasskeySignIn() {
    setChoice("connected");
    await loadAccount();
    S.busy = false; S.drafts = {};
    if (await shouldOfferRestore()) { S.view = "restore-offer"; paint(); return; }
    S.view = nextView(); paint();
    if (S.view === "join" && joinToken) joinWithToken(joinToken);
  }
  async function legacyPasskeySignIn(from) {
    S.busy = true; S.error = ""; S.errors = {}; paint();
    try {
      var c = await getClient();
      if (!c.auth.signInWithPasskey) return fail(from, {}, "הכניסה עם " + passkeyName() + " לא זמינה כאן. אפשר להיכנס עם הסיסמה.");
      var r = await c.auth.signInWithPasskey();
      if (r.error) return fail(from, {}, passkeyError(r.error));
      await afterPasskeySignIn();
    } catch (e) { fail(from, {}, passkeyError(e)); }
  }
  // After sign-up's (or a recovery's) code screen, and from the status screen. The answer is shown as a toast;
  // a cancel or a phone without Face ID changes nothing, since the password still works.
  async function doPasskeyRegister(then) {
    var ok = false;
    try {
      var c = await getClient();
      if (c.auth.registerPasskey) { var r = await c.auth.registerPasskey(); ok = !r.error; }
    } catch (e) { ok = false; }
    if (typeof showToast === "function") showToast(ok ? "" + passkeyName() + " הופעל. בפעם הבאה נכנסים במבט." : "" + passkeyName() + " לא הופעל. אפשר להפעיל אחר כך במסך המועדון.");
    then();
  }
  function afterCodeScreen() {
    S.code = ""; S.saved = false;
    S.view = nextView();
    if (S.view === "join" && joinToken) { joinWithToken(joinToken); } else paint();
  }

  // Q-42: a 21-character transfer code typed where the join code goes is taken to the transfer screen.
  function routeTransferCode(raw) {
    var tr = window.haimuniaTransfer;
    if (tr && tr.looksLikeTransferCode && tr.looksLikeTransferCode(raw)) { close(); tr.open("take", raw); return true; }
    return false;
  }
  // Q-42: from the transfer screen, an 8-character join code: on to joining with it.
  function joinWith(code) {
    if (!isCode(code)) return;
    joinToken = code;
    if (signedIn() && S.inClub === false) { open("join", false); joinWithToken(code); return; }
    open(signedIn() ? nextView() : "signup", false);
  }
  // Q-42: the first sign-in on an empty installed app offers the old log back (once per device).
  var RESTORE_OFFERED_KEY = "haimunia:restoreOffered";
  async function shouldOfferRestore() {
    if (!installed() || typeof hasAnyMemberData !== "function" || hasAnyMemberData()) return false; // eslint-disable-line no-undef
    try { return !(await dbGetSetting(RESTORE_OFFERED_KEY)); } catch (e) { return false; }
  }

  var CODE_FORMAT_ERROR = "זה לא קוד הצטרפות. הקוד הוא 8 אותיות באנגלית וספרות, למשל ABCD 2345.";
  async function doJoinForm(form) {
    var raw = formValue(form, "link");
    S.drafts = { link: raw };
    var t = parseToken(raw);
    if (!t && routeTransferCode(raw)) return;
    if (!t) return fail("join", { link: CODE_FORMAT_ERROR });
    joinWithToken(t);
  }
  // The first screen's code field: keep the code in memory and go on to the account. join_circle runs
  // after the recovery code, as it does for a link.
  function doCodeFirst(form) {
    var raw = formValue(form, "link");
    S.drafts = { link: raw };
    var t = parseToken(raw);
    if (!t && routeTransferCode(raw)) return;
    if (!t) return fail("choice", { link: CODE_FORMAT_ERROR });
    joinToken = t; S.drafts = {};
    if (signedIn()) { setChoice("connected"); joinWithToken(t); return; }
    S.view = "signup"; paint();
  }
  function autoName() {
    var n = String(typeof userName === "string" ? userName : "").replace(/\s+/g, " ").trim();
    return n.length >= 2 && n.length <= 40 ? n : "";
  }
  async function saveProfile(name, emoji) {
    try {
      var c = await getClient();
      var r = await c.from("profiles").update({ display_name: name, emoji: emoji }).eq("id", S.user.id);
      if (r.error) return false;
      await loadAccount();
      return true;
    } catch (e) { return false; }
  }

  var EMOJI_RE = /\p{Extended_Pictographic}/u;
  async function doProfile(form) {
    var name = String(formValue(form, "displayName")).replace(/\s+/g, " ").trim();
    var emoji = formValue(form, "emoji").trim();
    S.drafts = { displayName: name, emoji: emoji };
    var errs = {};
    if (name.length < 2 || name.length > 40) errs.displayName = "השם צריך להיות באורך 2 עד 40 תווים.";
    if (!emoji || Array.from(emoji).length > 16 || !EMOJI_RE.test(emoji)) errs.emoji = "בחרו אימוג'י אחד או שניים.";
    if (Object.keys(errs).length) return fail("profile", errs);
    S.busy = true; S.error = ""; S.errors = {}; paint();
    if (!(await saveProfile(name, emoji))) return fail("profile", {}, "שמירת הפרופיל נכשלה, נסו שוב");
    S.drafts = {};
    S.busy = false; S.view = nextView(); paint();
  }

  async function doSignOut() {
    try { var c = await getClient(); await c.auth.signOut(); } catch (e) {}
    dropRecoveryCode();
    S.user = null; S.profile = null; S.inClub = null; S.clubId = null; S.role = null; S.drafts = {};
    changed();
    setChoice("offline");
    S.view = "choice"; paint();
    if (typeof showToast === "function") showToast("התנתקתם. האימונים נשארים בטלפון.");
  }
  // Account deletion (backend delete_my_account, haimunia-app-demo 202611150002): the server deletes the
  // account, the club profile, every membership, every post, the reactions given, push subscriptions and
  // notifications, at once. The training log on this phone is not touched. After it, the device is offline:
  // the session is dropped locally (the user no longer exists on the server) and the choice is "offline".
  var DELETE_TEXT = {
    rate_limited: "ניסיתם יותר מדי פעמים בשעה האחרונה. אפשר לנסות שוב בעוד שעה.",
    offline: "אין חיבור כרגע. החשבון לא נמחק. אפשר לנסות שוב כשהחיבור חוזר.",
    unknown: "אין חיבור כרגע, ולא ברור אם החשבון נמחק. כשהחיבור חוזר, פותחים שוב את המסך הזה.",
    error: "מחיקת החשבון לא הושלמה. החשבון לא נמחק. אפשר לנסות שוב.",
  };
  // "deleted" when the server says this session's user no longer exists, "offline" when it still does
  // (the delete did not happen), "unknown" when the server cannot be reached to tell.
  function userGone(err) {
    if (!err) return false;
    return err.code === "user_not_found" || err.status === 404 ||
      /user from sub claim in jwt does not exist|user not found|user does not exist/i.test(String(err.message || ""));
  }
  async function accountStateAfterLostAnswer() {
    try {
      var c = await getClient();
      var r = await c.auth.getUser();
      if (r && r.data && r.data.user && !r.error) return "offline";
      if (r && userGone(r.error)) return "deleted";
      return "unknown";
    } catch (e) { return "unknown"; }
  }
  async function doDeleteAccount() {
    if (S.busy) return;
    S.busy = true; S.error = ""; S.view = "delete"; paint();
    var status = "error";
    try {
      var c = await getClient();
      var r = await c.rpc("delete_my_account");
      if (!r || !r.error) status = "deleted";
      else if (/rate_limited/.test(String(r.error.message || ""))) status = "rate_limited";
      else if (isNetwork(r.error)) status = "offline";
    } catch (e) { status = "offline"; }
    // A network error does not say the call failed: the answer may be what was lost, after the server
    // deleted the account. Ask the server who we are before saying "not deleted".
    if (status === "offline") status = await accountStateAfterLostAnswer();
    if (status !== "deleted") { S.busy = false; S.error = DELETE_TEXT[status] || DELETE_TEXT.error; paint(); return; }
    try { var c2 = await getClient(); await c2.auth.signOut({ scope: "local" }); } catch (e) {}
    try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch (e) {}
    S.busy = false;
    dropRecoveryCode();
    S.user = null; S.profile = null; S.inClub = null; S.clubId = null; S.role = null; S.clubName = ""; S.drafts = {}; joinToken = null;
    setChoice("offline");
    changed();
    S.view = "choice";
    // showToast only queues the toast; close() renders the app, which shows it.
    if (typeof showToast === "function") showToast("החשבון נמחק. האימונים נשארים בטלפון.");
    close();
  }

  // "Delete everything" on the device also forgets the session, so the next person starts clean.
  function forget() {
    try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch (e) {}
    S.user = null; S.profile = null; S.inClub = null; S.clubId = null; S.role = null; S.choice = null; joinToken = null;
    dropRecoveryCode();
    changed();
  }

  // ---- Screens -----------------------------------------------------------------------
  // Q-38g: a rule is visible text under the field (a placeholder disappears as soon as one types), and every
  // password field has a show-password button.
  function fieldHtml(name, label, type, extra, hint) {
    var err = S.errors[name];
    var val = type === "password" ? "" : (S.drafts[name] || "");
    var id = "connect-" + name;
    var described = [hint ? id + "-hint" : "", err ? id + "-err" : ""].filter(Boolean).join(" ");
    var gap = err || hint || type === "password" ? "6" : "14";
    return '<label for="' + id + '" style="display:block; color:var(--steel); font-size:var(--fs-1); margin-bottom:6px;">' + esc(label) + "</label>" +
      '<input id="' + id + '" name="' + name + '" class="text-input" type="' + type + '" value="' + esc(val) + '" ' + (extra || "") +
      (err ? ' aria-invalid="true"' : "") + (described ? ' aria-describedby="' + described + '"' : "") + ' style="margin-bottom:' + gap + 'px;" />' +
      (hint ? '<div id="' + id + '-hint" class="join-hint">' + esc(hint) + "</div>" : "") +
      (type === "password" ? '<button type="button" class="link-btn link-btn--tap pw-toggle" data-connect="toggle-pw" data-for="' + id + '" aria-controls="' + id + '" aria-pressed="false">הצגת הסיסמה</button>' : "") +
      (err ? '<div id="' + id + '-err" role="alert" style="color:var(--red-text); font-size:var(--fs-1); margin-bottom:14px;">' + esc(err) + "</div>" : (type === "password" || hint ? '<div style="height:8px;"></div>' : ""));
  }
  function errorHtml() { return S.error ? '<div role="alert" class="settings-warn">⚠️<span>' + esc(S.error) + "</span></div>" : ""; }
  // Q-37: the join screens are for older members: one large field, large error text.
  function bigErrorHtml() { return S.error ? '<div role="alert" class="join-err" id="connect-join-error">' + esc(S.error) + "</div>" : ""; }
  function codeFieldHtml(label, name) {
    name = name || "link";
    var err = S.errors[name];
    return '<label for="connect-' + name + '" class="join-field-label">' + esc(label) + "</label>" +
      '<input id="connect-' + name + '" name="' + name + '" class="text-input join-field" type="text" dir="ltr" value="' + esc(S.drafts[name] || "") + '"' +
      ' autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="next" placeholder="ABCD 2345"' +
      (err ? ' aria-invalid="true" aria-describedby="connect-' + name + '-err"' : "") + " />" +
      (err ? '<div id="connect-' + name + '-err" role="alert" class="join-err">' + esc(err) + "</div>" : "");
  }
  function newPasswordFields() {
    // The rule is in the label, not a placeholder: at 17px a placeholder this long is cut off on a phone.
    return fieldHtml("password", "סיסמה חדשה", "password", 'autocomplete="new-password" dir="ltr" maxlength="72"', PASSWORD_RULE) +
      fieldHtml("passwordConfirm", "הסיסמה החדשה שוב", "password", 'autocomplete="new-password" dir="ltr" maxlength="72"');
  }
  function forgotLink() { return '<div style="text-align:center;"><button type="button" class="link-btn link-btn--tap join-forgot" data-connect="go-forgot">שכחתי סיסמה</button></div>'; }
  function hhmm(iso) { var d = new Date(iso); return isNaN(d) ? "" : d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }); }
  function codeGroups(code) { return code.slice(0, 4) + " " + code.slice(4); }
  var PIC = {
    share: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>',
    add: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
    dots: '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
    icon: '<img src="./icon-192.png" alt="" width="36" height="36" />',
  };
  // Q-42: which browser is this? An in-app browser (WhatsApp, Instagram, Facebook) cannot install at all;
  // iOS 26 Safari keeps Share behind ⋯; Samsung Internet has its own menu; Chrome-like browsers that fired
  // beforeinstallprompt get one install button.
  // Q-52: one install-help component for every banner and the join screen (window.haimuniaInstall below). Adds
  // Telegram, iOS Chrome/Firefox/Edge (they can add to the home screen from iOS 16.4; before that only Safari).
  function iosVersion(ua) { var m = ua.match(/OS (\d+)_(\d+)/); return m ? Number(m[1]) + Number(m[2]) / 100 : 0; }
  function browserKind() {
    var ua = String((navigator && navigator.userAgent) || "");
    if (/WhatsApp|Instagram|FBAN|FBAV|FB_IAB|Telegram|Line\/|MicroMessenger/i.test(ua)) return "inapp";
    if (onIOS()) {
      var v = iosVersion(ua);
      if (/CriOS|FxiOS|EdgiOS/i.test(ua)) return v >= 16.04 ? "ios-other" : "ios-old-other";
      return v >= 26 ? "ios26" : "ios";
    }
    if (/SamsungBrowser/i.test(ua)) return "samsung";
    if (/Android/i.test(ua)) return "android";
    return "other";
  }
  function canPromptInstall() { try { return typeof deferredInstallPrompt !== "undefined" && !!deferredInstallPrompt; } catch (e) { return false; } } // eslint-disable-line no-undef
  function stepsHtml(ios) {
    var kind = browserKind();
    if (kind === "ios-old-other") {
      return '<div class="join-err" id="connectInAppWarning" role="note">בגרסה הזו של iOS אפשר להתקין רק מ-Safari. מעתיקים את הקישור ופותחים אותו ב-Safari.</div>';
    }
    if (kind === "inapp") {
      // On Android an intent:// link opens the same page in Chrome in one tap.
      var android = /Android/i.test(String((navigator && navigator.userAgent) || ""));
      var here = String(location.host + location.pathname + location.search + location.hash);
      var escape = android ? '<a class="save-btn" id="connectOpenInChrome" style="display:flex; max-width:none; margin-bottom:10px; text-decoration:none;" href="intent://' + esc(here) + '#Intent;scheme=https;package=com.android.chrome;end">פתיחה ב-Chrome</a>' : "";
      return '<div class="join-err" id="connectInAppWarning" role="note">הדפדפן של WhatsApp, Instagram, Facebook או Telegram לא יכול להתקין אפליקציות. פותחים את הקישור ב-Safari או ב-Chrome:</div>' + escape +
        '<ol class="join-steps" id="connectInstallSteps">' +
        '<li class="join-step"><span class="join-step-pic">' + PIC.dots + '</span><span><span class="join-step-num">1. לוחצים על ⋯ או על התפריט</span><br>בפינה של המסך.</span></li>' +
        '<li class="join-step"><span class="join-step-pic">' + PIC.share + '</span><span><span class="join-step-num">2. בוחרים "פתיחה בדפדפן"</span><br>או "פתיחה ב-Safari" / "פתיחה ב-Chrome".</span></li>' +
        '<li class="join-step"><span class="join-step-pic">' + PIC.icon + '</span><span><span class="join-step-num">3. שם ממשיכים להתקנה</span><br>המסך הזה יופיע שוב עם השלבים.</span></li></ol>';
    }
    var steps = kind === "ios-other"
      ? [[PIC.share, "לוחצים על כפתור השיתוף", "בשורת הכתובת או בתפריט של הדפדפן."],
         [PIC.add, "בוחרים \"הוספה למסך הבית\"", "אם לא רואים, גוללים מעט למטה ברשימה."],
         [PIC.icon, "לוחצים \"הוספה\"", "האייקון של האימוניה יופיע במסך הבית."]]
      : kind === "ios26"
      ? [[PIC.dots, "לוחצים על ⋯ (שלוש הנקודות)", "בסרגל של Safari, ואז על \"שיתוף\"."],
         [PIC.add, "בוחרים \"הוספה למסך הבית\"", "אם לא רואים, גוללים מעט למטה ברשימה."],
         [PIC.icon, "לוחצים \"הוספה\"", "האייקון של האימוניה יופיע במסך הבית."]]
      : kind === "samsung"
      ? [[PIC.dots, "לוחצים על התפריט ☰", "בסרגל התחתון של הדפדפן."],
         [PIC.add, "בוחרים \"הוספת דף ל\"", "ואז \"מסך הבית\"."],
         [PIC.icon, "מאשרים", "האייקון של האימוניה יופיע במסך הבית."]]
      : ios
      ? [[PIC.share, "לוחצים על כפתור השיתוף", "בסרגל של Safari, בתחתית המסך."],
         [PIC.add, "בוחרים \"הוספה למסך הבית\"", "אם לא רואים, גוללים מעט למטה ברשימה."],
         [PIC.icon, "לוחצים \"הוספה\"", "האייקון של האימוניה יופיע במסך הבית."]]
      : [[PIC.dots, "לוחצים על שלוש הנקודות", "בפינה של הדפדפן, למעלה."],
         [PIC.add, "בוחרים \"התקנת אפליקציה\"", "או \"הוספה למסך הבית\"."],
         [PIC.icon, "מאשרים את ההתקנה", "האייקון של האימוניה יופיע במסך הבית."]];
    return '<ol class="join-steps" id="connectInstallSteps">' + steps.map(function (st, i) {
      return '<li class="join-step"><span class="join-step-pic">' + st[0] + "</span><span><span class=\"join-step-num\">" + (i + 1) + ". " + esc(st[1]) + "</span><br>" + esc(st[2]) + "</span></li>";
    }).join("") + "</ol>";
  }
  function btn(label, attrs, cls) { return '<button type="button" class="' + (cls || "save-btn") + '" ' + attrs + (cls ? "" : ' style="max-width:none; margin-bottom:10px;"') + ">" + esc(label) + "</button>"; }
  function submitBtn(label) { return '<button type="submit" class="save-btn" style="max-width:none; margin-bottom:10px;"' + (S.busy ? " disabled" : "") + ">" + esc(S.busy ? "רגע…" : label) + "</button>"; }
  function linkBtn(label, attrs) { return '<button type="button" class="link-btn link-btn--tap" ' + attrs + ">" + esc(label) + "</button>"; }
  function head(title, sub) {
    return '<div style="text-align:center; margin-bottom:16px;"><div style="font-weight:800; font-size:var(--fs-4); margin-bottom:4px;">' + esc(title) + "</div>" +
      (sub ? '<div style="color:var(--steel); font-size:var(--fs-2);">' + esc(sub) + "</div>" : "") + "</div>";
  }

  function viewHtml() {
    var v = S.view || "choice";
    if (v === "choice") {
      // Q-37: the code is the first thing asked. A link already carries it, so the button goes on.
      // Q-42: one primary action (the code) and one secondary (an existing account); the rest is folded.
      return head("הצטרפות למועדון", "האימונים שלכם נשמרים רק בטלפון, גם בלי חיבור. כדי להצטרף, מקלידים את קוד ההצטרפות. הקוד נמצא בקבוצת המועדון, או ב-QR במכון.") +
        (joinToken
          ? '<div class="join-lead">קוד ההצטרפות מוכן.</div>' + btn("המשך", 'data-connect="go-signup"')
          : '<form id="connectForm" data-connect-form="code-first" novalidate>' + codeFieldHtml("קוד הצטרפות (8 תווים)") + submitBtn("המשך") + "</form>") +
        '<div style="text-align:center;">' + linkBtn("כבר יש לי חשבון", 'data-connect="go-login"') + "</div>" +
        '<details class="more-options" id="connectMoreOptions"><summary>אפשרויות נוספות</summary>' +
        '<div style="text-align:center;">' + linkBtn("להישאר בלי חיבור", 'data-connect="offline"') + "</div>" +
        (joinToken ? "" : '<div style="text-align:center;">' + linkBtn("יצירת חשבון בלי קוד", 'data-connect="go-signup"') + "</div>") +
        "</details>";
    }
    if (v === "install") {
      var jc = isCode(joinToken) ? joinToken : "";
      var ios = onIOS();
      return '<div class="join-lead">מצטרפים מתוך האפליקציה. מתקינים אותה במסך הבית, ואז מקלידים בה את הקוד הזה:</div>' +
        '<div class="join-code-label">קוד ההצטרפות שלכם</div>' +
        '<div class="join-code-big" dir="ltr" id="connectJoinCode" aria-label="' + esc(jc.split("").join(" ")) + '">' + esc(codeGroups(jc)) + "</div>" +
        '<div style="text-align:center; margin-bottom:16px;">' + btn(S.copied ? "הקוד הועתק" : "העתקת הקוד", 'data-connect="copy-join-code"', "chip-btn") + "</div>" +
        (canPromptInstall() && browserKind() !== "inapp"
          ? btn("התקנה", 'data-connect="install-prompt"')
          : '<div class="join-field-label">איך מתקינים</div>' + stepsHtml(ios)) +
        '<div class="join-after" id="connectInstallAfter">אחרי ההתקנה: פותחים את האימוניה מהאייקון במסך הבית, ומקלידים את הקוד.</div>' +
        // An iPhone's home-screen app has its own storage, so joining in Safari would leave the app signed out.
        // Q-42: on Android too the installed app is where the member should be; only a computer may go on here.
        (ios || /Android/i.test(String(navigator.userAgent || "")) ? "" : '<div style="text-align:center;">' + linkBtn("להמשיך כאן בדפדפן", 'data-connect="install-skip"') + "</div>");
    }
    if (v === "signup") {
      return head("יצירת חשבון", "שם וסיסמה לכניסה מכל מכשיר. שם הכניסה הוא רק בשבילכם. אין צורך באימייל או בטלפון.") + errorHtml() +
        '<form id="connectForm" data-connect-form="signup" novalidate>' +
        fieldHtml("username", "שם לכניסה", "text", 'autocomplete="username" autocapitalize="none" spellcheck="false" dir="ltr" maxlength="24"', USERNAME_RULE + ", בלי עברית") +
        fieldHtml("password", "סיסמה", "password", 'autocomplete="new-password" dir="ltr" maxlength="72"', PASSWORD_RULE) +
        fieldHtml("passwordConfirm", "סיסמה שוב", "password", 'autocomplete="new-password" dir="ltr" maxlength="72"') +
        submitBtn("יצירת חשבון") + "</form>" +
        (joinToken ? '<div style="text-align:center;">' + linkBtn("כבר יש לי חשבון", 'data-connect="go-login"') + "</div>" : "") +
        '<div style="text-align:center;">' + linkBtn("חזרה", 'data-connect="go-choice"') + "</div>";
    }
    if (v === "login") {
      return head("כניסה לחשבון") + errorHtml() +
        (passkeyBtn() ? passkeyBtn() + '<div class="join-lead" style="margin-bottom:8px;">או עם שם משתמש וסיסמה:</div>' : "") +
        '<form id="connectForm" data-connect-form="login" novalidate>' +
        fieldHtml("username", "שם לכניסה", "text", 'autocomplete="username webauthn" autocapitalize="none" spellcheck="false" dir="ltr" maxlength="24"') +
        fieldHtml("password", "סיסמה", "password", 'autocomplete="current-password" dir="ltr" maxlength="72"') +
        submitBtn("כניסה") + "</form>" + forgotLink() +
        '<div style="text-align:center;">' + linkBtn("חזרה", 'data-connect="go-choice"') + "</div>";
    }
    if (v === "forgot") {
      if (S.busy) return head("רגע…");
      return head("שכחתי סיסמה") + bigErrorHtml() +
        passkeyBtn() +
        '<div class="join-lead">' + (passkeyBtn() ? "או: " : "") + "שם המשתמש, קוד השחזור ששמרתם בהרשמה, וסיסמה חדשה.</div>" +
        '<form id="connectForm" data-connect-form="recover" novalidate>' +
        fieldHtml("username", "שם משתמש", "text", 'autocomplete="username" autocapitalize="none" spellcheck="false" dir="ltr" maxlength="24"') +
        fieldHtml("recoveryCode", "קוד שחזור (16 תווים)", "text", 'autocomplete="off" autocapitalize="characters" spellcheck="false" dir="ltr" maxlength="24" placeholder="XXXX-XXXX-XXXX-XXXX"') +
        newPasswordFields() + submitBtn("שמירה וכניסה") + "</form>" +
        '<div class="join-after" id="connectNewAccountNote">אין ' + passkeyName() + ' ואין קוד שחזור? פותחים חשבון חדש עם קוד ההצטרפות של המועדון: האימונים בטלפון נשארים כמו שהם, והחשבון הישן נמחק לבד אחרי שנה בלי שימוש.</div>' +
        '<div style="text-align:center; margin-bottom:10px;">' + btn("פתיחת חשבון חדש", 'data-connect="new-account"', "chip-btn") + "</div>" +
        '<div style="text-align:center;">' + linkBtn("חזרה", 'data-connect="go-login"') + "</div>";
    }
    if (v === "restore-offer") {
      return head("להעביר לכאן את האימונים?", "היומן בטלפון הזה ריק. אם יש לכם אימונים מהאפליקציה הישנה או מגיבוי, מעבירים אותם עכשיו.") +
        btn("יש לי קוד העברה (21 תווים)", 'data-connect="restore-transfer"') +
        '<div style="text-align:center; margin-bottom:10px;">' + btn("שחזור מקובץ גיבוי", 'data-connect="restore-file"', "chip-btn") + "</div>" +
        '<div style="text-align:center;">' + linkBtn("לא עכשיו", 'data-connect="restore-skip"') + "</div>";
    }
    if (v === "passkey") {
      return head("כניסה מהירה עם " + passkeyName() + "", "בפעם הבאה נכנסים במבט אחד, בלי להקליד סיסמה. הסיסמה נשארת לגיבוי.") +
        btn("הפעלת " + passkeyName() + "", 'data-connect="passkey-register"') +
        '<div style="text-align:center;">' + linkBtn("לא עכשיו", 'data-connect="passkey-skip"') + "</div>";
    }
    if (v === "code") {
      if (S.busy) return head("רגע, מכינים קוד שחזור…");
      if (!S.code) return head("קוד שחזור") + errorHtml() + btn("ניסיון חוזר", 'data-connect="retry-code"') + '<div style="text-align:center;">' + linkBtn("להמשיך בלי קוד", 'data-connect="after-code"') + "</div>";
      return head("קוד השחזור שלכם", "שומרים אותו במקום בטוח: בעזרתו מחליפים סיסמה שנשכחה. אפשר לראות אותו שוב במסך המועדון כל עוד מחוברים בטלפון הזה.") +
        '<div dir="ltr" id="connectRecoveryCode" style="text-align:center; font-family:ui-monospace,monospace; font-weight:800; font-size:var(--fs-5); letter-spacing:1px; padding:14px 8px; border:1px solid var(--border); border-radius:12px; background:var(--surface2); margin-bottom:12px; user-select:all;">' + esc(S.code) + "</div>" +
        btn("שמירה כתמונה או שליחה", 'data-connect="share-code"') +
        '<div style="text-align:center; margin-bottom:12px;">' + btn(S.copied ? "הועתק" : "העתקה", 'data-connect="copy-code"', "chip-btn") + "</div>" +
        '<label class="flex items-center gap-8" style="font-size:var(--fs-2); margin-bottom:14px; min-height:44px;"><input type="checkbox" id="connectSaved" data-connect-saved' + (S.saved ? " checked" : "") + " /> שמרתי את הקוד</label>" +
        '<button type="button" class="save-btn" data-connect="after-code" style="max-width:none;"' + (S.saved ? "" : " disabled") + ">המשך</button>";
    }
    if (v === "code-view") {
      return head("קוד השחזור שלכם", "שמור בטלפון הזה כל עוד מחוברים. בעזרתו מחליפים סיסמה שנשכחה.") +
        (S.code
          ? '<div dir="ltr" id="connectRecoveryCode" style="text-align:center; font-family:ui-monospace,monospace; font-weight:800; font-size:var(--fs-5); letter-spacing:1px; padding:14px 8px; border:1px solid var(--border); border-radius:12px; background:var(--surface2); margin-bottom:12px; user-select:all;">' + esc(S.code) + "</div>" +
            btn("שמירה כתמונה או שליחה", 'data-connect="share-code"') +
            '<div style="text-align:center; margin-bottom:12px;">' + btn(S.copied ? "הועתק" : "העתקה", 'data-connect="copy-code"', "chip-btn") + "</div>"
          : '<div class="join-lead">הקוד לא שמור בטלפון הזה. אפשר ליצור קוד חדש; הקודם יפסיק לעבוד.</div>') +
        '<div style="text-align:center;">' + linkBtn(S.code ? "קוד חדש במקומו" : "יצירת קוד חדש", 'data-connect="retry-code"') + "</div>" +
        '<div style="text-align:center;">' + linkBtn("חזרה", 'data-connect="go-status"') + "</div>";
    }
    if (v === "join") {
      if (S.busy) return head("מצטרפים למועדון…");
      return head("הצטרפות למועדון", joinToken ? "הקוד מוכן." : "מקלידים את קוד ההצטרפות, או מדביקים את הקישור. הקוד נמצא בקבוצת המועדון, או ב-QR במכון.") + bigErrorHtml() +
        (joinToken
          ? btn("הצטרפות", 'data-connect="join-now"')
          : '<form id="connectForm" data-connect-form="join" novalidate>' + codeFieldHtml("קוד הצטרפות (8 תווים)") + submitBtn("הצטרפות") + "</form>") +
        '<div style="text-align:center;">' + linkBtn("אחר כך", 'data-connect="close"') + "</div>";
    }
    if (v === "delete") {
      if (S.busy) return head("מוחקים את החשבון…");
      return head("למחוק את החשבון?") + errorHtml() +
        '<div class="settings-block" style="margin-bottom:12px; font-size:var(--fs-2); line-height:1.6;">' +
        '<div style="font-weight:700; margin-bottom:4px;">מה יימחק מהשרת</div>' +
        '<div id="connectDeleteWhat" style="color:var(--steel);">שם המשתמש והחשבון, השם והאימוג׳י במועדון, החברות במועדון, כל האימונים ששיתפתם במועדון, הריאקציות שנתתם, ההתראות וההרשמה להתראות בטלפון.</div>' +
        '<div style="font-weight:700; margin:10px 0 4px;">מה נשאר</div>' +
        '<div id="connectDeleteKeep" style="color:var(--steel);">יומן האימונים בטלפון הזה נשאר כמו שהוא, וממשיכים להשתמש באפליקציה בלי חיבור.</div>' +
        '<div id="connectDeleteFinal" style="font-weight:700; margin-top:10px; color:var(--red-text);">אי אפשר לבטל את המחיקה. גם קוד השחזור לא יחזיר את החשבון.</div>' +
        "</div>" +
        '<div class="chip-row" style="margin-top:0;">' +
        btn("ביטול", 'data-connect="go-status"', "chip-btn") +
        btn("מחיקה לצמיתות", 'data-connect="delete-account"', "chip-btn primary danger") +
        "</div>";
    }
    if (v === "profile") {
      var dn = S.drafts.displayName != null ? S.drafts.displayName : ((S.profile && S.profile.display_name) || (typeof userName === "string" ? userName : ""));
      var em = S.drafts.emoji != null ? S.drafts.emoji : ((S.profile && S.profile.emoji) || "💪");
      S.drafts.displayName = dn; S.drafts.emoji = em;
      return head("השם שרואים במועדון", "זה השם והאימוג'י שחברי המועדון יראו. אפשר שם מלא, בעברית או באנגלית.") + errorHtml() +
        '<form id="connectForm" data-connect-form="profile" novalidate>' +
        fieldHtml("displayName", "שם", "text", 'autocomplete="off" dir="auto" maxlength="40"') +
        fieldHtml("emoji", "אימוג'י", "text", 'autocomplete="off" maxlength="16"') +
        submitBtn("שמירה") + "</form>" +
        (S.profile && S.profile.display_name ? '<div style="text-align:center;">' + linkBtn("ביטול", 'data-connect="go-status"') + "</div>" : "");
    }
    // status
    // Q-38b: a device that chose to connect and has no session says so, with the two ways back.
    if (S.choice === "connected" && !signedIn()) {
      return head("לא מחוברים") +
        '<div class="join-lead" id="connectSignedOut">החשבון לא מחובר בטלפון הזה. האימונים שלכם שמורים בטלפון. נכנסים שוב עם שם המשתמש והסיסמה.</div>' +
        passkeyBtn() +
        btn(passkeyBtn() ? "כניסה עם סיסמה" : "כניסה", 'data-connect="go-login"') + forgotLink();
    }
    var name = memberName();
    var uname = signedIn() && S.user.email ? String(S.user.email).split("@")[0] : "";
    return head(S.user ? "מחוברים" + (name ? " כ" + name : "") : "לא מחוברים") +
      (uname ? '<div class="settings-block" style="margin-bottom:12px;"><div style="font-size:var(--fs-2);">שם המשתמש לכניסה: <strong dir="ltr" id="connectUsername">' + esc(uname) + "</strong></div>" +
        '<div style="color:var(--steel); font-size:var(--fs-1); margin-top:4px;">רק אתם רואים אותו. בעזרתו ובסיסמה נכנסים בטלפון חדש.</div></div>' : "") +
      '<div class="settings-block" style="margin-bottom:12px;"><div style="font-size:var(--fs-2); font-weight:700;">' + (S.inClub ? "חברים במועדון" : "עדיין לא במועדון") + "</div>" +
      '<div style="color:var(--steel); font-size:var(--fs-1); margin-top:4px;">האימונים והמשקלים שלכם נשארים בטלפון הזה. למועדון נשלחים רק אימונים שבחרתם לשתף.</div></div>' +
      (S.inClub === false ? btn("הצטרפות למועדון", 'data-connect="go-join"') : "") +
      (S.inClub ? '<div style="text-align:center;">' + linkBtn("שינוי השם והאימוג'י במועדון", 'data-connect="go-profile"') + "</div>" : "") +
      (signedIn() && passkeyReady() ? '<div style="text-align:center;">' + linkBtn("הפעלת כניסה עם " + passkeyName() + "", 'data-connect="passkey-register-status"') + "</div>" : "") +
      (signedIn() ? '<div style="text-align:center;">' + linkBtn("קוד השחזור שלי", 'data-connect="go-code-view"') + "</div>" : "") +
      '<div style="text-align:center;">' + linkBtn("התנתקות", 'data-connect="signout"') + "</div>" +
      (signedIn() ? '<div style="text-align:center; margin-top:14px;">' + btn("מחיקת החשבון", 'data-connect="go-delete"', "chip-btn danger") + "</div>" : "");
  }

  var TITLES = { choice: "חיבור", signup: "יצירת חשבון", login: "כניסה", code: "קוד שחזור", "code-view": "קוד שחזור", join: "הצטרפות למועדון", install: "הצטרפות למועדון", forgot: "שכחתי סיסמה", passkey: "" + passkeyName() + "", "restore-offer": "העברת אימונים", profile: "פרופיל במועדון", status: "המועדון", delete: "מחיקת החשבון" };
  function paint() {
    var body = el("connectBody");
    if (!body) return;
    var hadFocus = document.activeElement && body.contains(document.activeElement) ? document.activeElement.id : "";
    body.innerHTML = viewHtml();
    var t = el("connectTitle");
    if (t) t.textContent = (S.view === "passkey" ? passkeyName() : TITLES[S.view || "choice"]) || "חיבור";
    var x = el("connectCloseBtn");
    // Q-54: the close button is always there (a sheet a keyboard or screen-reader user cannot leave is a trap); the
    // first run can be reopened from רישום and from the מועדון tab.
    if (x) x.style.display = "";
    var f = hadFocus && el(hadFocus);
    if (!f) f = body.querySelector("input:not([type=checkbox]), button.save-btn:not([disabled])");
    // The delete confirm opens on its safe choice.
    if (!f && S.view === "delete") f = body.querySelector('[data-connect="go-status"]');
    // A screen with no field (the install steps): its first button, so the keyboard starts in the dialog.
    if (!f) f = body.querySelector("button:not([disabled])");
    if (f && !S.busy) { try { f.focus(); } catch (e) {} }
  }

  // ---- Open and close ---------------------------------------------------------------
  function open(view, firstRun) {
    var o = el("connectOverlay");
    if (!o) return;
    S.firstRun = !!firstRun; S.error = ""; S.errors = {};
    S.view = view || nextView();
    opener = document.activeElement;
    document.body.style.overflow = "hidden";
    o.classList.add("open");
    paint();
    // A device that is already connected shows fresh state, quietly.
    if (S.choice === "connected" && !view) refresh();
  }
  function close() {
    var o = el("connectOverlay");
    if (!o) return;
    o.classList.remove("open");
    if (typeof releaseScrollLockIfLastDialog === "function") releaseScrollLockIfLastDialog(); else document.body.style.overflow = "";
    S.firstRun = false; S.drafts = {}; S.code = ""; S.saved = false;
    if (opener && typeof opener.focus === "function") { try { opener.focus(); } catch (e) {} }
    opener = null;
    if (typeof render === "function") render();
  }
  async function refresh() {
    try { await loadAccount(); S.offline = false; } catch (e) { S.offline = true; return; }
    if (isOpen() && ["status", "join", "profile"].indexOf(S.view) >= 0 && !S.busy) { S.view = nextView(); paint(); }
  }

  // ---- Events ----------------------------------------------------------------------
  function onClick(e) {
    var t = e.target.closest && e.target.closest("[data-connect]");
    if (!t) return;
    var a = t.getAttribute("data-connect");
    S.error = ""; S.errors = {};
    if (a === "go-signup") { S.view = "signup"; paint(); }
    else if (a === "go-login") { S.view = "login"; paint(); }
    else if (a === "go-choice") { S.view = "choice"; paint(); }
    else if (a === "go-join") { S.view = "join"; paint(); }
    else if (a === "go-forgot") { S.drafts = {}; S.view = "forgot"; paint(); }
    else if (a === "go-code-view") { if (signedIn()) readRecoveryCode().then(function (c) { S.code = c; S.copied = false; S.view = "code-view"; paint(); }); }
    else if (a === "share-code") { shareRecoveryCode(); }
    else if (a === "toggle-pw") {
      var inp = el(t.getAttribute("data-for") || "");
      if (inp) {
        var show = inp.type === "password";
        inp.type = show ? "text" : "password";
        t.setAttribute("aria-pressed", show ? "true" : "false");
        t.textContent = show ? "הסתרת הסיסמה" : "הצגת הסיסמה";
      }
    }
    else if (a === "passkey-signin") { doPasskeySignIn(); }
    else if (a === "install-prompt") { if (typeof installApp === "function") installApp(); } // eslint-disable-line no-undef
    else if (a === "restore-transfer" || a === "restore-file" || a === "restore-skip") {
      try { dbSetSetting(RESTORE_OFFERED_KEY, true).catch(function () {}); } catch (err) {}
      if (a === "restore-skip") { S.view = nextView(); paint(); }
      else { close(); if (a === "restore-transfer" && window.haimuniaTransfer) window.haimuniaTransfer.open("take"); if (a === "restore-file" && typeof triggerImport === "function") triggerImport(); } // eslint-disable-line no-undef
    }
    else if (a === "passkey-register") { doPasskeyRegister(afterCodeScreen); }
    else if (a === "passkey-skip") { afterCodeScreen(); }
    else if (a === "passkey-register-status") { doPasskeyRegister(function () { paint(); }); }
    // Q-38d: the last resort. A new account with the club's join code; the old one is never touched here.
    else if (a === "new-account") { S.drafts = {}; S.errors = {}; S.view = "choice"; paint(); }
    else if (a === "go-profile") { if (S.inClub) { S.drafts = {}; S.view = "profile"; paint(); } }
    else if (a === "copy-join-code") {
      var doneJ = function (ok) { S.copied = !!ok; paint(); };
      try { navigator.clipboard.writeText(isCode(joinToken) ? joinToken : "").then(function () { doneJ(true); }, function () { doneJ(false); }); } catch (err) { doneJ(false); }
    }
    else if (a === "install-skip") {
      if (signedIn() && S.inClub === false) joinWithToken(joinToken);
      else { S.view = signedIn() ? nextView() : "signup"; paint(); }
    }
    else if (a === "go-delete") { if (signedIn()) { S.view = "delete"; paint(); } }
    else if (a === "go-status") { S.view = nextView(); paint(); }
    else if (a === "delete-account") { doDeleteAccount(); }
    else if (a === "offline") { setChoice("offline"); close(); }
    else if (a === "close") { close(); }
    else if (a === "copy-code") {
      var done = function (ok) { S.copied = !!ok; paint(); };
      try { navigator.clipboard.writeText(S.code).then(function () { done(true); }, function () { done(false); }); } catch (err) { done(false); }
    }
    else if (a === "retry-code") { issueCode(); }
    else if (a === "after-code") {
      // Q-38c: right after the recovery code, one button for Face ID (once per session; the password stays).
      if (passkeyReady() && !S.passkeyOffered) { S.passkeyOffered = true; S.code = ""; S.saved = false; S.view = "passkey"; paint(); }
      else afterCodeScreen();
    }
    else if (a === "join-now") { joinWithToken(joinToken); }
    else if (a === "signout") { doSignOut(); }
  }
  function onSubmit(e) {
    var f = e.target.closest && e.target.closest("[data-connect-form]");
    if (!f) return;
    e.preventDefault();
    if (S.busy) return;
    var k = f.getAttribute("data-connect-form");
    if (k === "signup") doSignup(f);
    else if (k === "login") doLogin(f);
    else if (k === "join") doJoinForm(f);
    else if (k === "code-first") doCodeFirst(f);
    else if (k === "recover") doRecover(f);
    else if (k === "profile") doProfile(f);
  }
  function onChange(e) {
    if (e.target && e.target.hasAttribute && e.target.hasAttribute("data-connect-saved")) {
      S.saved = !!e.target.checked;
      var b = el("connectBody").querySelector('[data-connect="after-code"]');
      if (b) b.disabled = !S.saved;
    }
  }

  function wire() {
    takeTokenFromAddress();
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    document.addEventListener("change", onChange);
  }

  // True from the moment the link is read (init's first, synchronous step): app.js then leaves the welcome
  // sheet closed, so it does not cover the code. The name is asked in the installed app, where it is kept.
  function opensInstall() { return !!(joinToken && enabled() && isCode(joinToken) && !installed()); }

  // First-run: the member has just told us their name (or skipped). Ask once.
  async function openFirstRun() {
    if (!enabled()) return;
    var existing = null;
    try { existing = await dbGetSetting(CHOICE_KEY); } catch (e) {}
    if (existing) return;
    open("choice", true);
  }
  async function init() {
    wire();
    var c = null;
    try { c = await dbGetSetting(CHOICE_KEY); } catch (e) {}
    S.choice = c || null;
    // Q-37: a short link opened in a browser tab, not the installed app: the code in large type and how to
    // install. On an iPhone the home-screen app has its own storage, so the link itself cannot reach it.
    if (opensInstall()) { S.copied = false; open("install", false); return; }
    // A link opened by a member who has not chosen yet: the link already says "join", so straight to the
    // account (the choice screen would only ask it again).
    if (joinToken && enabled() && !c) { open("signup", false); return; }
    if (c === "connected" && enabled()) {
      await refresh();
      if (joinToken && S.inClub === false) open("join", false);
    }
  }

  // Q-49: the one join component, used on רישום and on the מועדון tab for a guest: the 8-character code typed in
  // place (any case, spaces and dashes ignored), a link pasted works too. joinWith() takes it from there: joins
  // at once when signed in, else opens sign-up (or sign-in) with the code kept.
  function joinCardHtml(where) {
    var w = esc(where || "add");
    return '<form class="card join-card" data-join-inline="' + w + '" id="joinCard-' + w + '" novalidate>' +
      '<div class="join-card-title">הצטרפות למועדון</div>' +
      '<label class="join-card-label" for="joinCardInput-' + w + '">קוד הצטרפות (8 תווים, מקבוצת המועדון או מה-QR במכון)</label>' +
      '<div class="join-card-row"><input id="joinCardInput-' + w + '" name="code" class="text-input join-card-input" dir="ltr" maxlength="80" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD 2345" />' +
      '<button type="submit" class="save-btn join-card-btn">הצטרפות</button></div>' +
      '<div class="join-card-err" role="alert" hidden></div></form>';
  }
  document.addEventListener("submit", function (e) {
    var f = e.target && e.target.closest ? e.target.closest("[data-join-inline]") : null;
    if (!f) return;
    e.preventDefault();
    var raw = String((f.elements.code && f.elements.code.value) || "");
    var code = parseToken(raw);
    var err = f.querySelector(".join-card-err");
    if (!code || !isCode(code)) {
      if (window.haimuniaTransfer && window.haimuniaTransfer.looksLikeTransferCode && window.haimuniaTransfer.looksLikeTransferCode(raw)) { window.haimuniaTransfer.open("take", raw); return; }
      if (err) { err.textContent = "זה לא נראה כמו קוד הצטרפות. הקוד הוא 8 תווים, אותיות ומספרים."; err.hidden = false; }
      return;
    }
    if (err) err.hidden = true;
    joinWith(code);
  });
  window.haimuniaJoin = { cardHtml: joinCardHtml };
  // Q-52: the one install-help component. Every install banner and the join screen read their steps from here.
  window.haimuniaInstall = { kind: browserKind, stepsHtml: function () { return stepsHtml(onIOS()); }, canPrompt: canPromptInstall };
  window.haimuniaConnect = {
    init: init, open: open, close: close, openFirstRun: openFirstRun, forget: forget,
    isOpen: isOpen, enabled: enabled, parseToken: parseToken, isCode: isCode, opensInstall: opensInstall, joinWith: joinWith,
    getClient: getClient,
    onChange: function (f) { listeners.push(f); },
    // What the club screen needs to know, nothing more.
    info: function () {
      return { signedIn: signedIn(), inClub: !!(signedIn() && S.inClub), userId: S.user ? S.user.id : null,
        clubId: S.clubId, role: S.role, staff: S.role === "owner" || S.role === "coach", clubName: S.clubName,
        shareDefaults: Object.assign({}, S.shareDefaults || {}) };
    },
    setShareDefaults: function (d) { S.shareDefaults = Object.assign({}, S.shareDefaults || {}, d || {}); changed(); },
    statusLabel: function () {
      if (!enabled()) return null;
      if (S.choice === "connected" && !signedIn() && !S.offline) return { title: "המועדון", sub: "לא מחוברים בטלפון הזה. נכנסים שוב עם שם המשתמש" };
      if (S.choice !== "connected" || !signedIn()) return { title: "חיבור למועדון", sub: "אפשר להתחבר עם שם משתמש ולהצטרף למועדון" };
      return { title: "המועדון", sub: S.inClub ? "מחוברים וחברים במועדון" : "מחוברים, עדיין לא במועדון" };
    },
    appName: APP_NAME,
  };
})();

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
  var USERNAME_RULE = "3 עד 24 אותיות אנגליות קטנות, ספרות או קו תחתון";
  var PASSWORD_RULE = "לפחות 10 תווים, עם אות גדולה, אות קטנה וספרה";
  var APP_NAME = "club";

  var S = {
    view: "", busy: false, error: "", errors: {}, drafts: {},
    code: "", saved: false, copied: false,
    user: null, profile: null, inClub: null, // inClub: null = unknown
    choice: null, firstRun: false, offline: false,
  };
  var client = null;
  var libPromise = null;
  var scriptPromises = {};
  var joinToken = null; // the fixed link's token, in memory only, never stored or sent anywhere but join_circle
  var opener = null;

  function cfg() { return (window.HAIMUNIA_CONFIG && window.HAIMUNIA_CONFIG.cloud) || null; }
  function enabled() { var c = cfg(); return !!(c && c.supabaseUrl && c.supabasePublishableKey); }
  function el(id) { return document.getElementById(id); }
  function isOpen() { var o = el("connectOverlay"); return !!(o && o.classList.contains("open")); }

  // ---- The fixed link ------------------------------------------------------------
  // "#join=<64 hex>", "#invite=<64 hex>" or "#<64 hex>". Only the fragment is read: it never
  // reaches a server or a log. It is taken out of the address bar at once.
  function parseToken(text) {
    var raw = String(text == null ? "" : text).trim();
    if (!raw) return null;
    var at = raw.indexOf("#");
    var h = at >= 0 ? raw.slice(at + 1) : raw;
    var eq = h.indexOf("=");
    if (eq >= 0) {
      var key = h.slice(0, eq).toLowerCase();
      if (key !== "join" && key !== "invite") return null;
      h = h.slice(eq + 1);
    } else if (at < 0 && !TOKEN_RE.test(h.trim().toLowerCase())) {
      return null;
    }
    h = h.trim().toLowerCase();
    return TOKEN_RE.test(h) ? h : null;
  }
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
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_STORAGE_KEY },
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
    if (!/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/[0-9]/.test(p)) return "הסיסמה צריכה לכלול אות גדולה, אות קטנה וספרה באנגלית.";
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
    S.profile = null; S.inClub = null;
    if (!user) return;
    var m = await c.from("circle_members").select("club_id,role").eq("user_id", user.id);
    if (m.error) throw m.error;
    S.inClub = (m.data || []).length > 0;
    var p = await c.from("profiles").select("display_name,emoji").eq("id", user.id).maybeSingle();
    if (p.error) throw p.error;
    S.profile = p.data || null;
  }
  function signedIn() { return !!(S.user && !S.user.is_anonymous); }
  function memberName() {
    if (S.profile && S.profile.display_name) return S.profile.display_name;
    return typeof userName === "string" && userName ? userName : "";
  }

  // After any sign-in or restore: where does this member go next?
  function nextView() {
    if (!signedIn()) return "choice";
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
      S.busy = false; S.view = nextView(); paint();
      if (S.view === "join" && joinToken) joinWithToken(joinToken);
    } catch (e) { fail("login", {}, authErrorText(e) || "לא ניתן להתחבר כרגע, נסו שוב"); }
  }

  var JOIN_TEXT = {
    invalid: "הקישור לא תקף. אפשר לבקש קישור חדש מהמאמן.",
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
      S.view = nextView(); S.error = ""; paint();
      return;
    }
    // A token that cannot work is dropped; the others keep it for a retry.
    if (status === "invalid" || status === "circle_full" || status === "too_many_circles") joinToken = null;
    S.error = JOIN_TEXT[status] || JOIN_TEXT.error;
    paint();
  }

  async function doJoinForm(form) {
    var raw = formValue(form, "link");
    S.drafts = { link: raw };
    var t = parseToken(raw);
    if (!t) return fail("join", { link: "הדביקו את הקישור כמו שקיבלתם אותו" });
    joinWithToken(t);
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
    try {
      var c = await getClient();
      var r = await c.from("profiles").update({ display_name: name, emoji: emoji }).eq("id", S.user.id);
      if (r.error) return fail("profile", {}, "שמירת הפרופיל נכשלה, נסו שוב");
      S.drafts = {};
      await loadAccount();
      S.busy = false; S.view = nextView(); paint();
    } catch (e) { fail("profile", {}, "שמירת הפרופיל נכשלה, נסו שוב"); }
  }

  async function doSignOut() {
    try { var c = await getClient(); await c.auth.signOut(); } catch (e) {}
    S.user = null; S.profile = null; S.inClub = null; S.drafts = {};
    setChoice("offline");
    S.view = "choice"; paint();
    if (typeof showToast === "function") showToast("התנתקתם. האימונים נשארים בטלפון.");
  }
  // "Delete everything" on the device also forgets the session, so the next person starts clean.
  function forget() {
    try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch (e) {}
    S.user = null; S.profile = null; S.inClub = null; S.choice = null; joinToken = null;
  }

  // ---- Screens -----------------------------------------------------------------------
  function fieldHtml(name, label, type, extra) {
    var err = S.errors[name];
    var val = type === "password" ? "" : (S.drafts[name] || "");
    return '<label for="connect-' + name + '" style="display:block; color:var(--steel); font-size:12px; margin-bottom:6px;">' + esc(label) + "</label>" +
      '<input id="connect-' + name + '" name="' + name + '" class="text-input" type="' + type + '" value="' + esc(val) + '" ' + (extra || "") +
      (err ? ' aria-invalid="true" aria-describedby="connect-' + name + '-err"' : "") + ' style="margin-bottom:' + (err ? "6" : "14") + 'px;" />' +
      (err ? '<div id="connect-' + name + '-err" role="alert" style="color:var(--red-text); font-size:12.5px; margin-bottom:14px;">' + esc(err) + "</div>" : "");
  }
  function errorHtml() { return S.error ? '<div role="alert" class="settings-warn">⚠️<span>' + esc(S.error) + "</span></div>" : ""; }
  function btn(label, attrs, cls) { return '<button type="button" class="' + (cls || "save-btn") + '" ' + attrs + (cls ? "" : ' style="max-width:none; margin-bottom:10px;"') + ">" + esc(label) + "</button>"; }
  function submitBtn(label) { return '<button type="submit" class="save-btn" style="max-width:none; margin-bottom:10px;"' + (S.busy ? " disabled" : "") + ">" + esc(S.busy ? "רגע…" : label) + "</button>"; }
  function linkBtn(label, attrs) { return '<button type="button" class="link-btn link-btn--tap" ' + attrs + ">" + esc(label) + "</button>"; }
  function head(title, sub) {
    return '<div style="text-align:center; margin-bottom:16px;"><div style="font-weight:800; font-size:17px; margin-bottom:4px;">' + esc(title) + "</div>" +
      (sub ? '<div style="color:var(--steel); font-size:13px;">' + esc(sub) + "</div>" : "") + "</div>";
  }

  function viewHtml() {
    var v = S.view || "choice";
    if (v === "choice") {
      return head("להתחבר או להישאר בלי חיבור?", "האימונים שלכם נשמרים רק בטלפון, בשני המצבים. חיבור עם שם משתמש מאפשר להצטרף למועדון.") +
        btn("התחברות עם שם משתמש", 'data-connect="go-signup"') +
        '<div style="text-align:center;">' + linkBtn("כבר יש לי חשבון", 'data-connect="go-login"') + "</div>" +
        '<div style="text-align:center;">' + linkBtn("להישאר בלי חיבור", 'data-connect="offline"') + "</div>";
    }
    if (v === "signup") {
      return head("יצירת חשבון", "שם וסיסמה לכניסה מכל מכשיר. שם הכניסה הוא רק בשבילכם. אין צורך באימייל או בטלפון.") + errorHtml() +
        '<form id="connectForm" data-connect-form="signup" novalidate>' +
        fieldHtml("username", "שם לכניסה", "text", 'autocomplete="username" autocapitalize="none" spellcheck="false" dir="ltr" maxlength="24" placeholder="' + esc(USERNAME_RULE) + '"') +
        fieldHtml("password", "סיסמה", "password", 'autocomplete="new-password" dir="ltr" maxlength="72" placeholder="' + esc(PASSWORD_RULE) + '"') +
        fieldHtml("passwordConfirm", "סיסמה שוב", "password", 'autocomplete="new-password" dir="ltr" maxlength="72"') +
        submitBtn("יצירת חשבון") + "</form>" +
        '<div style="text-align:center;">' + linkBtn("חזרה", 'data-connect="go-choice"') + "</div>";
    }
    if (v === "login") {
      return head("כניסה לחשבון") + errorHtml() +
        '<form id="connectForm" data-connect-form="login" novalidate>' +
        fieldHtml("username", "שם לכניסה", "text", 'autocomplete="username" autocapitalize="none" spellcheck="false" dir="ltr" maxlength="24"') +
        fieldHtml("password", "סיסמה", "password", 'autocomplete="current-password" dir="ltr" maxlength="72"') +
        submitBtn("כניסה") + "</form>" +
        '<div style="text-align:center;">' + linkBtn("חזרה", 'data-connect="go-choice"') + "</div>";
    }
    if (v === "code") {
      if (S.busy) return head("רגע, מכינים קוד שחזור…");
      if (!S.code) return head("קוד שחזור") + errorHtml() + btn("ניסיון חוזר", 'data-connect="retry-code"') + '<div style="text-align:center;">' + linkBtn("להמשיך בלי קוד", 'data-connect="after-code"') + "</div>";
      return head("קוד השחזור שלכם", "שומרים אותו במקום בטוח. הוא מוצג פעם אחת בלבד, ובלעדיו אי אפשר לשחזר סיסמה שאבדה.") +
        '<div dir="ltr" style="text-align:center; font-family:ui-monospace,monospace; font-weight:800; font-size:20px; letter-spacing:1px; padding:14px 8px; border:1px solid var(--border); border-radius:12px; background:var(--surface2); margin-bottom:12px; user-select:all;">' + esc(S.code) + "</div>" +
        '<div style="text-align:center; margin-bottom:12px;">' + btn(S.copied ? "הועתק" : "העתקה", 'data-connect="copy-code"', "chip-btn") + "</div>" +
        '<label class="flex items-center gap-8" style="font-size:13.5px; margin-bottom:14px; min-height:44px;"><input type="checkbox" id="connectSaved" data-connect-saved' + (S.saved ? " checked" : "") + " /> שמרתי את הקוד</label>" +
        '<button type="button" class="save-btn" data-connect="after-code" style="max-width:none;"' + (S.saved ? "" : " disabled") + ">המשך</button>";
    }
    if (v === "join") {
      if (S.busy) return head("מצטרפים למועדון…");
      return head("הצטרפות למועדון", joinToken ? "הקישור מוכן." : "הדביקו את קישור המועדון כמו שקיבלתם אותו מהמאמן.") + errorHtml() +
        (joinToken
          ? btn("הצטרפות", 'data-connect="join-now"')
          : '<form id="connectForm" data-connect-form="join" novalidate>' + fieldHtml("link", "קישור המועדון", "text", 'autocomplete="off" autocapitalize="none" spellcheck="false" dir="ltr"') + submitBtn("הצטרפות") + "</form>") +
        '<div style="text-align:center;">' + linkBtn("אחר כך", 'data-connect="close"') + "</div>";
    }
    if (v === "profile") {
      var dn = S.drafts.displayName != null ? S.drafts.displayName : (typeof userName === "string" ? userName : "");
      var em = S.drafts.emoji != null ? S.drafts.emoji : "💪";
      S.drafts.displayName = dn; S.drafts.emoji = em;
      return head("השם שרואים במועדון", "זה השם והאימוג'י שחברי המועדון יראו. אפשר שם מלא, בעברית או באנגלית.") + errorHtml() +
        '<form id="connectForm" data-connect-form="profile" novalidate>' +
        fieldHtml("displayName", "שם", "text", 'autocomplete="off" dir="auto" maxlength="40"') +
        fieldHtml("emoji", "אימוג'י", "text", 'autocomplete="off" maxlength="16"') +
        submitBtn("שמירה") + "</form>";
    }
    // status
    var name = memberName();
    return head(S.user ? "מחוברים" + (name ? " כ" + name : "") : "לא מחוברים") +
      '<div class="settings-block" style="margin-bottom:12px;"><div style="font-size:13.5px; font-weight:700;">' + (S.inClub ? "חברים במועדון" : "עדיין לא במועדון") + "</div>" +
      '<div style="color:var(--steel); font-size:12px; margin-top:4px;">האימונים והמשקלים שלכם נשארים בטלפון הזה. למועדון נשלחים רק אימונים שבחרתם לשתף.</div></div>' +
      (S.inClub === false ? btn("הצטרפות למועדון", 'data-connect="go-join"') : "") +
      '<div style="text-align:center;">' + linkBtn("התנתקות", 'data-connect="signout"') + "</div>";
  }

  var TITLES = { choice: "חיבור", signup: "יצירת חשבון", login: "כניסה", code: "קוד שחזור", join: "הצטרפות למועדון", profile: "פרופיל במועדון", status: "המועדון" };
  function paint() {
    var body = el("connectBody");
    if (!body) return;
    var hadFocus = document.activeElement && body.contains(document.activeElement) ? document.activeElement.id : "";
    body.innerHTML = viewHtml();
    var t = el("connectTitle");
    if (t) t.textContent = TITLES[S.view || "choice"] || "חיבור";
    var x = el("connectCloseBtn");
    if (x) x.style.display = S.firstRun && (S.view || "choice") === "choice" ? "none" : "";
    var f = hadFocus && el(hadFocus);
    if (!f) f = body.querySelector("input:not([type=checkbox]), button.save-btn:not([disabled])");
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
    else if (a === "offline") { setChoice("offline"); close(); }
    else if (a === "close") { close(); }
    else if (a === "copy-code") {
      var done = function (ok) { S.copied = !!ok; paint(); };
      try { navigator.clipboard.writeText(S.code).then(function () { done(true); }, function () { done(false); }); } catch (err) { done(false); }
    }
    else if (a === "retry-code") { issueCode(); }
    else if (a === "after-code") { S.code = ""; S.saved = false; S.view = nextView(); if (S.view === "join" && joinToken) { joinWithToken(joinToken); } else paint(); }
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
    // A link opened by a member who has not chosen yet: take them straight to the choice.
    if (joinToken && enabled() && !c) { open("choice", false); return; }
    if (c === "connected" && enabled()) {
      await refresh();
      if (joinToken && S.inClub === false) open("join", false);
    }
  }

  window.haimuniaConnect = {
    init: init, open: open, close: close, openFirstRun: openFirstRun, forget: forget,
    isOpen: isOpen, enabled: enabled, parseToken: parseToken,
    statusLabel: function () {
      if (!enabled()) return null;
      if (S.choice !== "connected" || !signedIn()) return { title: "חיבור למועדון", sub: "אפשר להתחבר עם שם משתמש ולהצטרף למועדון" };
      return { title: "המועדון", sub: S.inClub ? "מחוברים וחברים במועדון" : "מחוברים, עדיין לא במועדון" };
    },
    appName: APP_NAME,
  };
})();

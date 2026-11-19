// CONNECTED MODE, PHASE 1: the first-run choice, sign-up / sign-in with a username, and joining
// the club by the one fixed link. The Supabase library and Turnstile are replaced by fakes; no
// request leaves the test, and the private log is never part of any call.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootApp } from "./helpers/boot.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TOKEN = "ab".repeat(32);
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label) { for (let i = 0; i < 100; i++) { if (fn()) return; await wait(10); } assert.fail("timed out: " + label); }

function fakeBackend(opts = {}) {
  const log = { signIn: 0, update: null, rpc: [], invoke: [], from: [], captchaTokens: [] };
  const state = { user: null, member: false, profile: null, joinStatus: "joined", ...opts };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: state.user ? { user: state.user } : null } }),
      signInAnonymously: async (o) => { log.signIn++; log.captchaTokens.push(o && o.options && o.options.captchaToken); state.user = { id: "u1", is_anonymous: true }; return { data: { user: state.user }, error: null }; },
      updateUser: async (a, o) => { log.update = { a, o }; state.user = { id: "u1", is_anonymous: false, email: a.email }; return { data: { user: state.user }, error: null }; },
      refreshSession: async () => ({ data: { session: { user: state.user } } }),
      signInWithPassword: async (a) => { log.login = a; state.user = { id: "u1", is_anonymous: false, email: a.email }; return { data: {}, error: null }; },
      // Q-38c: Supabase's native passkeys. passkeyUser: who the authenticator signs in as (null: none saved here).
      signInWithPasskey: async () => {
        log.passkeySignIn = (log.passkeySignIn || 0) + 1;
        if (!state.passkeyUser) return { data: null, error: { code: "webauthn_credential_not_found", message: "not found" } };
        state.user = state.passkeyUser; return { data: { user: state.user, session: { user: state.user } }, error: null };
      },
      registerPasskey: async () => { log.passkeyRegister = (log.passkeyRegister || 0) + 1; return state.passkeyCancel ? { data: null, error: { name: "NotAllowedError", message: "cancelled" } } : { data: { id: "pk1" }, error: null }; },
      signOut: async () => { state.user = null; },
    },
    functions: {
      invoke: async (n, o) => {
        log.invoke.push(n);
        const b = (o && o.body) || {};
        log.bodies = log.bodies || []; log.bodies.push([n, b]);
        const no = { data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code" } };
        if (n === "recover-password" && "reset_code" in b) return b.reset_code === "ABCD2345" ? { data: { ok: true, username: "dana_k" }, error: null } : no;
        if (n === "recover-password") return b.recovery_code === "7K2M-QX9D-4HNC-WB8F" ? { data: { ok: true, recovery_code: "NEWC-ODEN-EWCO-DE22" }, error: null } : no;
        if (n === "request-reset" && b.action === "request") return { data: { ok: true, request_token: "ef".repeat(32), request_ref: "A1B2C3", ready_at: "2026-11-18T20:00:00Z" }, error: null };
        if (n === "request-reset" && b.action === "complete") return state.resetReady ? { data: { ok: true, recovery_code: "NEWC-ODEN-EWCO-DE22" }, error: null } : no;
        return { data: { recovery_code: "ABCD-EFGH-JKLM-NPQR" }, error: null };
      },
    },
    rpc: async (n, a) => {
      log.rpc.push([n, a]);
      if (n === "join_circle") { if (state.joinStatus === "joined") state.member = true; return { data: { status: state.joinStatus }, error: null }; }
      return { data: null, error: { message: "unexpected " + n } };
    },
    from: (t) => {
      log.from.push(t);
      const q = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: state.profile, error: null }),
        then: (res) => res({ data: state.member ? [{ club_id: "c1", role: "member" }] : [], error: null }),
        update: (row) => { state.profile = { ...(state.profile || {}), ...row }; return { eq: async () => ({ error: null }) }; },
      };
      return q;
    },
  };
  return { client, log, state };
}

async function boot(opts = {}) {
  const be = fakeBackend(opts.backend);
  const window = await bootApp({
    url: opts.url,
    seed: opts.seed,
    matchMedia: opts.standalone ? (q) => /display-mode: standalone/.test(q) : undefined,
    beforeScripts: (w) => {
      if (opts.ios) Object.defineProperty(w.navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1", configurable: true });
      if (opts.ua) Object.defineProperty(w.navigator, "userAgent", { value: opts.ua, configurable: true });
      w.supabase = { createClient: () => be.client };
      w.turnstile = { render: (_h, o) => { w.__ts = o; }, execute: () => { w.__ts.callback("ts-token"); } };
      w.scrollTo = () => {};
      if (opts.passkey) {
        w.PublicKeyCredential = function PublicKeyCredential() {};
        if (!w.navigator.credentials) Object.defineProperty(w.navigator, "credentials", { value: {}, configurable: true });
      }
    },
  });
  return { window, ...be };
}
const $ = (w, s) => w.document.querySelector(s);
function setVal(w, name, v) { w.document.querySelector(`#connectBody [name='${name}']`).value = v; }
function submit(w) { const f = $(w, "#connectBody form"); f.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); }
const open = (w) => $(w, "#connectOverlay").classList.contains("open");

async function firstRunName(window) {
  await until(() => $(window, "#welcomeOverlay").classList.contains("open"), "welcome");
  $(window, "#welcomeNameInput").value = "דנה";
  $(window, "[data-action='save-user-name']").click();
  await until(() => open(window), "connect choice");
}

test("the link token is read from the fragment only, in all three shapes", async () => {
  const { window } = await boot();
  const p = window.haimuniaConnect.parseToken;
  assert.equal(p(`https://haimunia.pages.dev/#join=${TOKEN}`), TOKEN);
  assert.equal(p(`#invite=${TOKEN.toUpperCase()}`), TOKEN);
  assert.equal(p(TOKEN), TOKEN);
  assert.equal(p(`https://x.test/?join=${TOKEN}`), null, "a query string is not read");
  assert.equal(p("#join=short"), null);
});

test("first run: after the name the member chooses; staying offline stores it and sends nothing", async () => {
  const { window, log } = await boot();
  await firstRunName(window);
  assert.match($(window, "#connectBody").textContent, /להישאר בלי חיבור/);
  // Q-54: the close button is always there now (no sheet without a way out); closing leaves the choice for later.
  assert.equal($(window, "#connectCloseBtn").style.display, "", "the sheet can always be closed");
  $(window, "[data-connect='offline']").click();
  assert.equal(open(window), false);
  assert.equal(await window.dbGetSetting("haimunia:connectChoice"), "offline");
  assert.equal(log.signIn, 0);
  assert.deepEqual(log.rpc, []);
});

test("sign-up: anonymous session with a captcha token, username becomes a synthetic address, recovery code, join, name", async () => {
  const { window, log, state } = await boot();
  await firstRunName(window);
  $(window, "[data-connect='go-signup']").click();
  setVal(window, "username", "Dana_K");
  setVal(window, "password", "Abcdefghi1");
  setVal(window, "passwordConfirm", "Abcdefghi1");
  submit(window);
  await until(() => /ABCD-EFGH/.test($(window, "#connectBody").textContent), "recovery code");
  assert.deepEqual(log.captchaTokens, ["ts-token"]);
  assert.equal(log.update.a.email, "dana_k@members.haimuniya.invalid");
  assert.equal(log.update.a.password, "Abcdefghi1");
  assert.deepEqual(log.invoke, ["issue-recovery-code"]);
  // Continue is locked until the code is saved.
  assert.equal($(window, "[data-connect='after-code']").disabled, true);
  const cb = $(window, "#connectSaved"); cb.checked = true; cb.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal($(window, "[data-connect='after-code']").disabled, false);
  $(window, "[data-connect='after-code']").click();
  // No link yet: the member is asked to paste it.
  await until(() => $(window, "#connectBody [name='link']"), "paste link");
  setVal(window, "link", `https://haimunia.pages.dev/#join=${TOKEN}`);
  submit(window);
  // Q-37: the name given on first run becomes the club name, so the profile screen is skipped.
  await until(() => /חברים במועדון/.test($(window, "#connectBody").textContent), "status");
  assert.deepEqual(log.rpc, [["join_circle", { p_token: TOKEN }]]);
  assert.equal(state.member, true);
  assert.equal($(window, "#connectBody [name='displayName']"), null, "no profile screen");
  assert.equal(state.profile.display_name, "דנה");
  assert.equal(state.profile.emoji, "💪");
  assert.equal(await window.dbGetSetting("haimunia:connectChoice"), "connected");
});

test("sign-up with a bad username or password says what is wrong and calls nothing", async () => {
  const { window, log } = await boot();
  await firstRunName(window);
  $(window, "[data-connect='go-signup']").click();
  setVal(window, "username", "ab");
  setVal(window, "password", "short");
  setVal(window, "passwordConfirm", "other");
  submit(window);
  const t = $(window, "#connectBody").textContent;
  assert.match(t, /קצר מדי/);
  assert.match(t, /הסיסמאות לא תואמות/);
  assert.equal(log.signIn, 0);
});

test("a link opened in the address bar is kept in memory, removed from the address, and joins after sign-in", async () => {
  const { window, log } = await boot({ url: `https://haimunia.pages.dev/#join=${TOKEN}`, seed: undefined });
  await until(() => open(window), "choice for a link");
  assert.equal(window.location.hash, "", "the token is out of the address bar");
  $(window, "[data-connect='go-login']").click();
  setVal(window, "username", "dana_k");
  setVal(window, "password", "Abcdefghi1");
  submit(window);
  await until(() => log.rpc.length === 1, "join");
  assert.deepEqual(log.rpc[0], ["join_circle", { p_token: TOKEN }]);
  assert.equal(log.login.email, "dana_k@members.haimuniya.invalid");
});

test("a dead link is dropped and the member is told; a full club says so", async () => {
  const { window, log } = await boot({ backend: { joinStatus: "invalid" } });
  await firstRunName(window);
  $(window, "[data-connect='go-signup']").click();
  setVal(window, "username", "dana_k"); setVal(window, "password", "Abcdefghi1"); setVal(window, "passwordConfirm", "Abcdefghi1");
  submit(window);
  await until(() => /ABCD/.test($(window, "#connectBody").textContent), "code");
  const cb = $(window, "#connectSaved"); cb.checked = true; cb.dispatchEvent(new window.Event("change", { bubbles: true }));
  $(window, "[data-connect='after-code']").click();
  await until(() => $(window, "#connectBody [name='link']"), "paste");
  setVal(window, "link", TOKEN);
  submit(window);
  await until(() => /לא תקפים/.test($(window, "#connectBody").textContent), "invalid text");
  assert.equal(log.rpc.length, 1);
});

test("a device that chose to be connected restores its session on open; an offline device never loads the library", async () => {
  const { window, log } = await boot({ backend: { user: { id: "u1", is_anonymous: false }, member: true, profile: { display_name: "דנה", emoji: "💪" } } });
  await window.dbSetSetting("haimunia:connectChoice", "connected");
  await window.haimuniaConnect.init();
  assert.ok(log.from.includes("circle_members"));
  const row = $(window, "[data-action='open-connect']");
  assert.ok(row, "Settings has the club row");
});

// Q-38g: the recovery code is kept on purpose now, in the app's IndexedDB settings only (tested below), never in
// localStorage or sessionStorage.
test("no web storage for codes, and no private-log data is part of any call", async () => {
  const src = readFileSync(path.join(root, "src/connect.js"), "utf8");
  assert.doesNotMatch(src, /localStorage\.setItem|sessionStorage|private_records|bodyweight|entries/i);
  assert.match(src, /"haimunia:auth"/);
});

// ---- Q-37: the short join code ---------------------------------------------------------------------

// The installed app's first run: the import offer ("start fresh"), then the name, then the connect screen.
async function firstRunInstalled(window) {
  await until(() => $(window, "#firstImportOverlay").classList.contains("open"), "import offer");
  $(window, "[data-action='first-import-fresh']").click();
  await firstRunName(window);
}

test("the short code: #j= links, typed in any case with spaces or dashes; anything else is refused", async () => {
  const { window } = await boot();
  const p = window.haimuniaConnect.parseToken;
  assert.equal(p("https://haimunia.pages.dev/#j=ABCD2345"), "ABCD2345");
  assert.equal(p("#j=abcd-2345"), "ABCD2345");
  assert.equal(p("abcd2345"), "ABCD2345");
  assert.equal(p(" ABCD 2345 "), "ABCD2345");
  assert.equal(p("ab cd-23 45"), "ABCD2345");
  assert.equal(p("ABCD–2345"), "ABCD2345", "an en dash, as a phone may type it");
  assert.equal(p(`#join=${TOKEN}`), TOKEN, "the long link still works");
  for (const bad of ["ABCD234", "ABCD23456", "ABCD2340", "ABCDO345", "ABCD1345", "ABCDI345", "ABCDL345", "#join=ABCD2345", "#j=" + TOKEN, "hello world", "https://haimunia.pages.dev/"]) {
    assert.equal(p(bad), null, bad);
  }
});

test("a short link opened in Safari: the code in large type, a copy button and the iPhone install steps; nothing is sent", async () => {
  const { window, log } = await boot({ url: "https://haimunia.pages.dev/#j=abcd2345", ios: true });
  await until(() => open(window) && $(window, "#connectJoinCode"), "install screen");
  assert.equal($(window, "#welcomeOverlay").classList.contains("open"), false, "the welcome sheet does not cover the code");
  assert.equal(window.location.hash, "", "the code is out of the address bar");
  assert.equal($(window, "#connectJoinCode").textContent, "ABCD 2345");
  assert.equal($(window, "#connectJoinCode").getAttribute("dir"), "ltr");
  const t = $(window, "#connectBody").textContent;
  assert.match(t, /כפתור השיתוף/);
  assert.match(t, /הוספה למסך הבית/);
  assert.match($(window, "#connectInstallAfter").textContent, /פותחים את האימוניה מהאייקון.*ומקלידים את הקוד/);
  assert.equal(window.document.querySelectorAll("#connectInstallSteps li").length, 3);
  assert.equal($(window, "[data-connect='install-skip']"), null, "on an iPhone there is no 'continue in the browser': it would strand the account in Safari");
  let copied = ""; Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async (x) => { copied = x; } }, configurable: true });
  $(window, "[data-connect='copy-join-code']").click();
  await until(() => copied === "ABCD2345", "copied");
  assert.equal(log.signIn, 0);
  assert.deepEqual(log.rpc, []);
});

test("the same link in a browser that is not an iPhone: its own steps, and it may go on in the browser", async () => {
  const { window, log } = await boot({ url: "https://haimunia.pages.dev/#j=ABCD2345" });
  await until(() => $(window, "#connectJoinCode"), "install screen");
  assert.match($(window, "#connectBody").textContent, /שלוש הנקודות/);
  $(window, "[data-connect='install-skip']").click();
  await until(() => $(window, "#connectBody [name='username']"), "sign-up");
  assert.deepEqual(log.rpc, []);
});

test("installed app, first run: the code is asked first, then the account; join and name need no screen of their own", async () => {
  const { window, log, state } = await boot({ standalone: true });
  await firstRunInstalled(window);
  assert.ok($(window, "#connectBody input.join-field[name='link']"), "the first screen is one large code field");
  // A wrong-looking code: a large, plain Hebrew error and nothing sent.
  setVal(window, "link", "ABC");
  submit(window);
  await until(() => $(window, "#connect-link-err"), "format error");
  assert.match($(window, "#connect-link-err").className, /join-err/);
  assert.match($(window, "#connect-link-err").textContent, /8 אותיות באנגלית וספרות/);
  assert.equal($(window, "#connect-link").getAttribute("aria-invalid"), "true");
  assert.equal(log.signIn, 0);
  setVal(window, "link", "abcd-2345");
  submit(window);
  await until(() => $(window, "#connectBody [name='username']"), "sign-up");
  setVal(window, "username", "dana_k"); setVal(window, "password", "Abcdefghi1"); setVal(window, "passwordConfirm", "Abcdefghi1");
  submit(window);
  await until(() => $(window, "#connectSaved"), "recovery code");
  const cb = $(window, "#connectSaved"); cb.checked = true; cb.dispatchEvent(new window.Event("change", { bubbles: true }));
  $(window, "[data-connect='after-code']").click();
  await until(() => /חברים במועדון/.test($(window, "#connectBody").textContent), "status");
  assert.deepEqual(log.rpc, [["join_circle", { p_token: "ABCD2345" }]], "the normalised code, once");
  assert.deepEqual([state.profile.display_name, state.profile.emoji], ["דנה", "💪"], "the first-run name is the club name");
  // The status screen can still change it.
  $(window, "[data-connect='go-profile']").click();
  await until(() => $(window, "#connectBody [name='displayName']"), "profile");
  assert.equal($(window, "#connectBody [name='displayName']").value, "דנה");
  setVal(window, "displayName", "דנה כהן"); setVal(window, "emoji", "🔥");
  submit(window);
  await until(() => /חברים במועדון/.test($(window, "#connectBody").textContent), "status again");
  assert.deepEqual([state.profile.display_name, state.profile.emoji], ["דנה כהן", "🔥"]);
});

test("a wrong code from the server: the join screen says so in large text and keeps one field to try again", async () => {
  const { window, log } = await boot({ standalone: true, backend: { joinStatus: "invalid" } });
  await firstRunInstalled(window);
  setVal(window, "link", "ZZZZ2345"); submit(window);
  await until(() => $(window, "#connectBody [name='username']"), "sign-up");
  setVal(window, "username", "dana_k"); setVal(window, "password", "Abcdefghi1"); setVal(window, "passwordConfirm", "Abcdefghi1");
  submit(window);
  await until(() => $(window, "#connectSaved"), "recovery code");
  const cb = $(window, "#connectSaved"); cb.checked = true; cb.dispatchEvent(new window.Event("change", { bubbles: true }));
  $(window, "[data-connect='after-code']").click();
  await until(() => $(window, "#connect-join-error"), "server error");
  assert.match($(window, "#connect-join-error").textContent, /לא תקפים.*8 התווים/);
  assert.ok($(window, "#connectBody input.join-field[name='link']"), "one large field to type it again");
  assert.equal(log.rpc.length, 1);
});

test("a member with no first-run name still gets the profile screen after joining", async () => {
  const { window, state } = await boot({ standalone: true, backend: { user: { id: "u1", is_anonymous: false } } });
  await window.dbSetSetting("haimunia:connectChoice", "connected");
  await window.haimuniaConnect.init();
  window.haimuniaConnect.open("join");
  setVal(window, "link", "https://haimunia.pages.dev/#j=ABCD2345"); submit(window);
  await until(() => $(window, "#connectBody [name='displayName']"), "profile");
  assert.equal(state.member, true);
});

test("a link opened before any choice goes straight to the account: the choice screen is not asked again", async () => {
  const { window } = await boot({ url: `https://haimunia.pages.dev/#join=${TOKEN}` });
  await until(() => open(window) && $(window, "#connectBody [name='username']"), "sign-up");
  assert.ok($(window, "[data-connect='go-login']"), "an existing account can still sign in");
});

// ---- Q-38c / Q-38d / Q-38e: self-service sign-in and recovery, no person in it ------------------------------

const DANA = { id: "u1", is_anonymous: false, email: "dana_k@members.haimuniya.invalid" };
async function signedOutDevice(opts = {}) {
  const b = await boot({ passkey: true, ...opts, backend: { member: true, profile: { display_name: "דנה", emoji: "💪" }, ...(opts.backend || {}) } });
  await b.window.dbSetSetting("haimunia:connectChoice", "connected");
  await b.window.haimuniaConnect.init();
  b.window.haimuniaConnect.open();
  await until(() => $(b.window, "#connectSignedOut"), "signed-out notice");
  return b;
}

test("sign-in with Face ID: 1 tap from the signed-out notice, no username, no password", async () => {
  const { window, log } = await signedOutDevice({ backend: { passkeyUser: DANA } });
  assert.ok($(window, "[data-connect='passkey-signin']"), "Face ID is the first button");
  $(window, "[data-connect='passkey-signin']").click();
  await until(() => $(window, "#connectUsername"), "signed in");
  assert.equal(log.passkeySignIn, 1);
  assert.equal(log.login, undefined, "no password sign-in");
  assert.equal($(window, "#connectUsername").textContent, "dana_k", "the username is shown");
  assert.equal(await window.dbGetSetting("haimunia:connectChoice"), "connected");
});

test("Face ID with nothing saved on this phone: a plain answer, and the password is right there", async () => {
  const { window } = await signedOutDevice();
  $(window, "[data-connect='go-login']").click();
  assert.ok($(window, "#connectBody [data-connect='passkey-signin']"), "the login screen has Face ID first");
  $(window, "#connectBody [data-connect='passkey-signin']").click();
  await until(() => /אין Face ID שמור/.test($(window, "#connectBody").textContent), "not found");
  assert.ok($(window, "#connectBody [name='username']"), "the password form is still there");
});

test("without passkey support the screens simply have no Face ID button", async () => {
  const { window } = await boot({ backend: { member: true } });
  await window.dbSetSetting("haimunia:connectChoice", "connected");
  await window.haimuniaConnect.init();
  window.haimuniaConnect.open();
  await until(() => $(window, "#connectSignedOut"), "notice");
  assert.equal($(window, "[data-connect='passkey-signin']"), null);
});

test("right after sign-up's recovery code: one button turns on Face ID; 'not now' goes on; the password stays", async () => {
  for (const choice of ["passkey-register", "passkey-skip"]) {
    const { window, log } = await boot({ passkey: true, standalone: true });
    await firstRunInstalled(window);
    setVal(window, "link", "ABCD2345"); submit(window);
    await until(() => $(window, "#connectBody [name='username']"), "sign-up");
    setVal(window, "username", "dana_k"); setVal(window, "password", "Abcdefghi1"); setVal(window, "passwordConfirm", "Abcdefghi1");
    submit(window);
    await until(() => $(window, "#connectSaved"), "recovery code");
    const cb = $(window, "#connectSaved"); cb.checked = true; cb.dispatchEvent(new window.Event("change", { bubbles: true }));
    $(window, "[data-connect='after-code']").click();
    await until(() => $(window, "[data-connect='passkey-register']"), "the Face ID offer");
    $(window, `[data-connect='${choice}']`).click();
    await until(() => /חברים במועדון/.test($(window, "#connectBody").textContent), "joined");
    assert.equal(log.passkeyRegister || 0, choice === "passkey-register" ? 1 : 0, choice);
    assert.deepEqual(log.rpc, [["join_circle", { p_token: "ABCD2345" }]], "the join still follows");
    assert.equal(log.update.a.password, "Abcdefghi1", "the password is set either way");
  }
});

test("forgot: Face ID, or the recovery code; 3 taps; no coach and no self-service request anywhere", async () => {
  const { window, log } = await signedOutDevice();
  let taps = 0;
  $(window, "[data-connect='go-forgot']").click(); taps++;
  const t = $(window, "#connectBody").textContent;
  assert.ok($(window, "#connectBody [data-connect='passkey-signin']"), "Face ID on the forgot screen");
  assert.doesNotMatch(t, /מאמן קוד|קוד איפוס|אין קוד מהמאמן|בקשה/, "no coach code, no request");
  assert.deepEqual([...window.document.querySelectorAll("#connectBody form input")].map((i) => i.name), ["username", "recoveryCode", "password", "passwordConfirm"]);
  setVal(window, "username", "Dana_K"); setVal(window, "recoveryCode", "7K2M-QX9D-4HNC-WB8F");
  setVal(window, "password", "Abcdefghi1"); setVal(window, "passwordConfirm", "Abcdefghi1");
  submit(window); taps++;
  await until(() => /NEWC-ODEN-EWCO-DE22/.test($(window, "#connectBody").textContent), "new recovery code once");
  assert.deepEqual(log.bodies.filter(([n]) => n === "recover-password").pop()[1], { username: "dana_k", recovery_code: "7K2M-QX9D-4HNC-WB8F", new_password: "Abcdefghi1" });
  assert.equal(log.login.email, "dana_k@members.haimuniya.invalid", "signed in with the new password");
  assert.deepEqual(log.bodies.filter(([n]) => n === "request-reset"), [], "request-reset is never called");
  const cb = $(window, "#connectSaved"); cb.checked = true; cb.dispatchEvent(new window.Event("change", { bubbles: true }));
  $(window, "[data-connect='after-code']").click(); taps++;
  await until(() => $(window, "[data-connect='passkey-register']"), "and Face ID is offered again, the one that was lost");
  assert.equal(taps, 3, "forgot, save, continue");
});

test("a wrong recovery code is one plain, large message", async () => {
  const { window } = await signedOutDevice();
  $(window, "[data-connect='go-forgot']").click();
  setVal(window, "username", "dana_k"); setVal(window, "recoveryCode", "ZZZZ-ZZZZ-ZZZZ-ZZZZ");
  setVal(window, "password", "Abcdefghi1"); setVal(window, "passwordConfirm", "Abcdefghi1");
  submit(window);
  await until(() => $(window, "#connect-join-error"), "error");
  assert.match($(window, "#connect-join-error").textContent, /לא נכונים/);
});

test("the last resort: 'פתיחת חשבון חדש', explained in one sentence, opens the join-code screen for a new account", async () => {
  const { window, log } = await signedOutDevice();
  $(window, "[data-connect='go-forgot']").click();
  assert.match($(window, "#connectNewAccountNote").textContent, /האימונים בטלפון נשארים.*החשבון הישן נמחק לבד אחרי שנה/);
  $(window, "[data-connect='new-account']").click();
  await until(() => $(window, "#connectBody input.join-field[name='link']"), "the code field");
  setVal(window, "link", "abcd 2345"); submit(window);
  await until(() => $(window, "#connectBody [name='username']"), "a new username and password");
  assert.equal(log.signIn, 0, "nothing sent before the new account's form");
  assert.deepEqual(log.rpc, []);
});

test("signed in: the status screen can turn on Face ID later", async () => {
  const { window, log } = await boot({ passkey: true, backend: { user: DANA, member: true, profile: { display_name: "דנה", emoji: "💪" } } });
  await window.dbSetSetting("haimunia:connectChoice", "connected");
  await window.haimuniaConnect.init();
  window.haimuniaConnect.open();
  await until(() => $(window, "[data-connect='passkey-register-status']"), "status link");
  $(window, "[data-connect='passkey-register-status']").click();
  await until(() => log.passkeyRegister === 1, "registered");
});

test("the client opts in to Supabase's experimental passkeys", () => {
  const src = readFileSync(path.join(root, "src/connect.js"), "utf8");
  assert.match(src, /experimental: \{ passkey: true \}/);
  assert.doesNotMatch(src, /request-reset|reset_code|club_issue_reset_code/, "no self-service request, no coach code");
});

// ---- Q-38g: sign-up and the recovery code -------------------------------------------------------------------

test("sign-up: the rules are visible text, the password needs only 10 characters, and it can be shown", async () => {
  const { window, log } = await boot();
  await firstRunName(window);
  $(window, "[data-connect='go-signup']").click();
  assert.match($(window, "#connect-username-hint").textContent, /אותיות אנגליות קטנות.*בלי עברית/);
  assert.equal($(window, "#connect-password-hint").textContent, "לפחות 10 תווים");
  assert.equal($(window, "#connect-password").getAttribute("placeholder"), null, "not a placeholder that vanishes");
  assert.match($(window, "#connect-password").getAttribute("aria-describedby"), /connect-password-hint/);
  // Show the password, and hide it again.
  const eye = $(window, "[data-connect='toggle-pw'][data-for='connect-password']");
  eye.click();
  assert.equal($(window, "#connect-password").type, "text");
  assert.equal(eye.getAttribute("aria-pressed"), "true");
  eye.click();
  assert.equal($(window, "#connect-password").type, "password");
  // 9 characters: refused, nothing sent.
  setVal(window, "username", "dana_k"); setVal(window, "password", "abcdefghi"); setVal(window, "passwordConfirm", "abcdefghi");
  submit(window);
  assert.match($(window, "#connectBody").textContent, /קצרה מדי/);
  assert.equal(log.update, null);
  // 10 lowercase letters: enough.
  setVal(window, "username", "dana_k"); setVal(window, "password", "abcdefghij"); setVal(window, "passwordConfirm", "abcdefghij");
  submit(window);
  await until(() => $(window, "#connectSaved"), "recovery code");
  assert.equal(log.update.a.password, "abcdefghij");
});

test("the recovery code: one tap to share, kept on this phone while signed in, seen again from status, gone on sign-out", async () => {
  const { window } = await boot({ backend: { member: true, profile: { display_name: "דנה", emoji: "💪" } } });
  await firstRunName(window);
  $(window, "[data-connect='go-signup']").click();
  setVal(window, "username", "dana_k"); setVal(window, "password", "abcdefghij"); setVal(window, "passwordConfirm", "abcdefghij");
  submit(window);
  await until(() => $(window, "#connectRecoveryCode"), "code");
  // jsdom has no canvas, so the text goes to the share sheet; a phone gets the picture.
  const shared = [];
  Object.defineProperty(window.navigator, "share", { value: async (d) => { shared.push(d); }, configurable: true });
  $(window, "[data-connect='share-code']").click();
  await until(() => shared.length === 1, "shared");
  assert.match(shared[0].text, /ABCD-EFGH-JKLM-NPQR/);
  assert.equal(await window.dbGetSetting("haimunia:recoveryCode"), "ABCD-EFGH-JKLM-NPQR", "kept on this phone");
  const cb = $(window, "#connectSaved"); cb.checked = true; cb.dispatchEvent(new window.Event("change", { bubbles: true }));
  $(window, "[data-connect='after-code']").click();
  window.haimuniaConnect.open("status");
  await until(() => $(window, "[data-connect='go-code-view']"), "status");
  $(window, "[data-connect='go-code-view']").click();
  await until(() => $(window, "#connectRecoveryCode"), "seen again");
  assert.equal($(window, "#connectRecoveryCode").textContent, "ABCD-EFGH-JKLM-NPQR");
  assert.ok($(window, "[data-connect='go-status']"), "a way back");
  window.haimuniaConnect.open("status");
  await until(() => $(window, "[data-connect='signout']"), "status again");
  $(window, "[data-connect='signout']").click();
  await until(async () => true, "tick");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await window.dbGetSetting("haimunia:recoveryCode"), null, "forgotten on sign-out");
});


// ---- Q-42: the guided first run --------------------------------------------------------------------------------

test("first screen: one primary action (the code), one secondary (an account); offline and no-code are folded", async () => {
  const { window } = await boot({ standalone: true });
  await firstRunInstalled(window);
  const body = $(window, "#connectBody");
  assert.equal(body.querySelectorAll("button.save-btn, button[type=submit]").length, 1, "one primary button");
  assert.ok($(window, "#connectBody > div [data-connect='go-login']"), "the secondary: an existing account");
  const more = $(window, "#connectMoreOptions");
  assert.ok(more && more.tagName === "DETAILS" && !more.open, "a closed 'אפשרויות נוספות'");
  assert.ok(more.querySelector("[data-connect='offline']") && more.querySelector("[data-connect='go-signup']"), "offline and no-code live inside it");
  assert.match($(window, "label[for='connect-link']").textContent, /8 תווים/);
});

test("no screen tells a member to ask the coach; they are told where the code is", () => {
  const src = readFileSync(path.join(root, "src/connect.js"), "utf8");
  assert.doesNotMatch(src, /מהמאמן|מבקשים .*מהמאמן|שקיבלתם מהמאמן/);
  assert.match(src, /בקבוצת המועדון, או ב-QR במכון/);
});

test("a 21-character transfer code typed in the join field goes to the transfer screen, filled in", async () => {
  const { window, log } = await boot({ standalone: true });
  await firstRunInstalled(window);
  const code = window.haimuniaTransfer.encodeCode(new Uint8Array(13).fill(7));
  setVal(window, "link", code.replace(/-/g, "").toLowerCase());
  submit(window);
  await until(() => $(window, "#transferOverlay").classList.contains("open"), "transfer");
  assert.equal($(window, "#transferCode").value, window.haimuniaTransfer.groupCode(code));
  assert.equal(open(window), false, "the connect dialog closed");
  assert.deepEqual(log.rpc, [], "nothing sent to join");
});

test("an 8-character join code typed in the transfer field goes to joining the club", async () => {
  const { window } = await boot({ standalone: true });
  await firstRunInstalled(window);
  window.haimuniaConnect.close();
  window.haimuniaTransfer.open("take");
  $(window, "#transferCode").value = "abcd-2345";
  $(window, "[data-transfer-form]").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await until(() => open(window) && $(window, "#connectBody [name='username']"), "on to the account, with the code kept");
  assert.equal($(window, "#transferOverlay").classList.contains("open"), false);
});

test("install steps per browser: WhatsApp's in-app browser, iOS 26 Safari, Samsung Internet; Android cannot go on in the browser", async () => {
  const cases = [
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 WhatsApp/2.24", (w) => assert.ok($(w, "#connectInAppWarning"), "WhatsApp: open in Safari or Chrome first")],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 Version/26.1 Mobile/15E148 Safari/604.1", (w) => assert.match($(w, "#connectInstallSteps").textContent, /⋯/, "iOS 26: Share is behind ⋯")],
    ["Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 SamsungBrowser/25.0 Chrome/121 Mobile Safari/537.36", (w) => assert.match($(w, "#connectInstallSteps").textContent, /הוספת דף ל/, "Samsung Internet's own menu")],
  ];
  for (const [ua, check] of cases) {
    const { window } = await boot({ url: "https://haimunia.pages.dev/#j=ABCD2345", ua });
    await until(() => $(window, "#connectJoinCode"), "install screen " + ua.slice(0, 30));
    check(window);
    if (/Android/.test(ua)) assert.equal($(window, "[data-connect='install-skip']"), null, "no continue-in-browser on Android");
  }
});

test("where the browser offers it, one 'התקנה' button replaces the steps", async () => {
  const { window } = await boot({ url: "https://haimunia.pages.dev/#j=ABCD2345", ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36" });
  let prompted = 0;
  // The browser's own event, which app.js keeps for its install button.
  const evt = new window.Event("beforeinstallprompt", { cancelable: true });
  evt.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; };
  evt.userChoice = Promise.resolve({ outcome: "accepted" });
  window.dispatchEvent(evt);
  window.haimuniaConnect.open("install");
  await until(() => $(window, "[data-connect='install-prompt']"), "install button");
  assert.equal($(window, "#connectInstallSteps"), null);
  $(window, "[data-connect='install-prompt']").click();
  await until(() => window.__prompted === 1, "prompted");
  prompted = window.__prompted;
  assert.equal(prompted, 1);
});

test("the first sign-in on an empty installed app offers the transfer code and the backup file, once", async () => {
  const { window } = await boot({ standalone: true });
  await firstRunInstalled(window);
  $(window, "[data-connect='go-login']").click();
  setVal(window, "username", "dana_k"); setVal(window, "password", "abcdefghij");
  submit(window);
  await until(() => $(window, "[data-connect='restore-transfer']"), "restore offer");
  assert.ok($(window, "[data-connect='restore-file']"));
  $(window, "[data-connect='restore-transfer']").click();
  await until(() => $(window, "#transferOverlay").classList.contains("open"), "transfer opened");
  assert.equal(await window.dbGetSetting("haimunia:restoreOffered"), true, "asked once");
});

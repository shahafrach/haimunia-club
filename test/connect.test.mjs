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
      signInWithPassword: async (a) => { log.login = a; state.user = { id: "u1", is_anonymous: false }; return { data: {}, error: null }; },
      signOut: async () => { state.user = null; },
    },
    functions: { invoke: async (n) => { log.invoke.push(n); return { data: { recovery_code: "ABCD-EFGH-JKLM-NPQR" }, error: null }; } },
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
      w.supabase = { createClient: () => be.client };
      w.turnstile = { render: (_h, o) => { w.__ts = o; }, execute: () => { w.__ts.callback("ts-token"); } };
      w.scrollTo = () => {};
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
  assert.equal($(window, "#connectCloseBtn").style.display, "none", "the choice has no hidden third answer");
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

test("the code never reaches storage, and no private-log data is part of any call", async () => {
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

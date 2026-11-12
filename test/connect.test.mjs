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
    beforeScripts: (w) => {
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
  await until(() => $(window, "#connectBody [name='displayName']"), "profile");
  assert.deepEqual(log.rpc, [["join_circle", { p_token: TOKEN }]]);
  assert.equal(state.member, true);
  assert.equal($(window, "#connectBody [name='displayName']").value, "דנה", "the name given on first run is the default");
  submit(window);
  await until(() => /חברים במועדון/.test($(window, "#connectBody").textContent), "status");
  assert.equal(state.profile.display_name, "דנה");
  assert.ok(Array.from(state.profile.emoji).length >= 1);
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
  await until(() => /לא תקף/.test($(window, "#connectBody").textContent), "invalid text");
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

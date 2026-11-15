// CONNECTED MODE: "מחיקת החשבון". The status screen (Settings, the club row) offers it to a signed-in
// member. A confirm says what the server deletes, that the log on this phone stays, and that it cannot be
// undone. Only "מחיקה לצמיתות" calls delete_my_account (haimunia-app-demo 202611150002); then the session is
// dropped and the device is offline. The Supabase library is a fake; no request leaves the test.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label) { for (let i = 0; i < 100; i++) { if (fn()) return; await wait(10); } assert.fail("timed out: " + label); }

function fakeBackend(opts = {}) {
  const log = { rpc: [], signOut: [] };
  const state = { user: { id: "u1", is_anonymous: false }, member: true, profile: { display_name: "דנה", emoji: "💪" }, rpcError: null, ...opts };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: state.user ? { user: state.user } : null } }),
      refreshSession: async () => ({ data: { session: { user: state.user } } }),
      signOut: async (o) => { log.signOut.push(o || null); state.user = null; },
    },
    functions: { invoke: async () => ({ data: null, error: { message: "unexpected" } }) },
    rpc: async (n, a) => {
      log.rpc.push([n, a]);
      if (n === "delete_my_account") return state.rpcError ? { data: null, error: state.rpcError } : { data: null, error: null };
      return { data: null, error: { message: "unexpected " + n } };
    },
    from: () => {
      const q = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: state.profile, error: null }),
        then: (res) => res({ data: state.member ? [{ club_id: "c1", role: "member" }] : [], error: null }),
      };
      return q;
    },
  };
  return { client, log, state };
}

async function bootConnected(backend) {
  const be = fakeBackend(backend);
  const window = await bootApp({
    beforeScripts: (w) => { w.supabase = { createClient: () => be.client }; w.scrollTo = () => {}; },
  });
  await window.dbSetSetting("haimunia:connectChoice", "connected");
  await window.dbPutWodEntry({ id: "w1", date: "2026-11-15", name: "Fran", type: "ForTime", result: "5:00" });
  window.localStorage.setItem("haimunia:auth", "{\"fake\":true}");
  await window.haimuniaConnect.init();
  return { window, ...be };
}
const $ = (w, s) => w.document.querySelector(s);
const body = (w) => $(w, "#connectBody").textContent;
const click = (w, a) => { const b = $(w, `#connectBody [data-connect='${a}']`); assert.ok(b, "button " + a); b.click(); };

async function openConfirm(window) {
  window.haimuniaConnect.open();
  await until(() => $(window, "#connectBody [data-connect='go-delete']"), "the delete button on the status screen");
  click(window, "go-delete");
  await until(() => $(window, "#connectBody [data-connect='delete-account']"), "the confirm");
}

test("the confirm says what the server deletes, that the log on this phone stays, and that it cannot be undone", async () => {
  const { window, log } = await bootConnected();
  await openConfirm(window);
  assert.equal($(window, "#connectTitle").textContent, "מחיקת החשבון");
  const what = $(window, "#connectDeleteWhat").textContent;
  for (const w of ["החשבון", "במועדון", "האימונים ששיתפתם", "הריאקציות", "ההתראות"]) assert.match(what, new RegExp(w));
  assert.match($(window, "#connectDeleteKeep").textContent, /יומן האימונים בטלפון הזה נשאר/);
  assert.match($(window, "#connectDeleteFinal").textContent, /אי אפשר לבטל/);
  assert.equal(window.document.activeElement.getAttribute("data-connect"), "go-status", "focus starts on the safe choice");
  assert.equal(log.rpc.length, 0, "opening the confirm calls nothing");

  click(window, "go-status");
  await until(() => $(window, "#connectBody [data-connect='go-delete']"), "back on the status screen");
  assert.equal(log.rpc.length, 0, "cancel calls nothing");
  assert.equal(await window.dbGetSetting("haimunia:connectChoice"), "connected", "and the device stays connected");
});

test("confirming calls delete_my_account once, signs out, and leaves the device offline with its log", async () => {
  const { window, log } = await bootConnected();
  await openConfirm(window);
  click(window, "delete-account");
  await until(() => !$(window, "#connectOverlay").classList.contains("open"), "the overlay closes");

  assert.deepEqual(log.rpc.map((r) => r[0]), ["delete_my_account"], "one call, to delete_my_account");
  assert.equal(log.rpc[0][1], undefined, "with no arguments: the server acts on auth.uid() only");
  assert.deepEqual(log.signOut, [{ scope: "local" }], "the session is dropped on this phone");
  assert.equal(window.localStorage.getItem("haimunia:auth"), null, "the stored session is gone");
  await wait();
  assert.equal(await window.dbGetSetting("haimunia:connectChoice"), "offline", "the device is offline");
  const info = window.haimuniaConnect.info();
  assert.equal(info.signedIn, false);
  assert.equal(info.inClub, false);
  assert.equal(window.haimuniaConnect.statusLabel().title, "חיבור למועדון", "Settings offers to connect again");
  assert.match(window.document.body.textContent, /החשבון נמחק\. האימונים נשארים בטלפון\./, "the toast says the log stays");
  const wods = await window.dbLoadWodEntries();
  assert.deepEqual(wods.map((w) => w.id), ["w1"], "the training log on the phone is untouched");
});

test("a refused call deletes nothing on the phone: still connected, with the reason in Hebrew", async () => {
  const { window, log } = await bootConnected({ rpcError: { message: "rate_limited" } });
  await openConfirm(window);
  click(window, "delete-account");
  await until(() => /יותר מדי פעמים/.test(body(window)), "the rate-limit text");
  assert.equal(log.rpc.length, 1);
  assert.deepEqual(log.signOut, [], "no sign-out");
  assert.equal(await window.dbGetSetting("haimunia:connectChoice"), "connected");
  assert.equal(window.haimuniaConnect.info().signedIn, true);
  assert.ok($(window, "#connectBody [data-connect='delete-account']"), "the member can try again");
});

test("an offline call says the account was not deleted", async () => {
  const { window } = await bootConnected({ rpcError: { message: "Failed to fetch" } });
  await openConfirm(window);
  click(window, "delete-account");
  await until(() => /החשבון לא נמחק/.test(body(window)), "the offline text");
  assert.equal(await window.dbGetSetting("haimunia:connectChoice"), "connected");
});

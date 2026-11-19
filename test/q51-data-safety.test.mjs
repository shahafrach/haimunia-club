// Q-51 (before pilot): data safety. CQ-01 backups from a fresh IndexedDB read; CQ-02 other tabs reload on a
// write; CQ-03 the seen-medals list is a union with disk; CQ-04 a failed delete keeps the set and says so;
// CQ-06 past midnight the shown date follows the clock; CQ-07 one Sunday-start week; CQ-08 "delete everything"
// clears the club and feedback keys; CQ-10 a failed feedback-queue save keeps the text.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const set = (id, date, weight) => ({ id, exerciseId: "back-squat", date, type: "reps", weight, reps: 5, sets: 1, durationSeconds: 0, ts: Date.now(), isPR: false, groupId: null, blockLabel: null, est1RM: weight * 1.17 });
const today = () => new Date().toISOString().slice(0, 10);

test("CQ-01: a backup includes what is on disk even when this tab's copy is behind", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  await window.dbPut(set("other-tab", today(), 70)); // written by another tab: on disk, not in this tab's memory
  assert.equal(window.totalLoggedEntries(), 0, "this tab has not seen it");
  const b = await window.buildBackupPayload();
  assert.deepEqual(b.entries.map((e) => e.id), ["other-tab"]);
});

test("CQ-02: a write in another tab reloads this one; an edit of a set the other tab deleted ends", async () => {
  const channels = [];
  const window = await bootApp({ beforeScripts: (w) => {
    w.BroadcastChannel = class { constructor(n) { this.n = n; this.l = []; this.posted = []; channels.push(this); } postMessage(m) { this.posted.push(m); } addEventListener(t, f) { this.l.push(f); } close() {} };
  } });
  window.saveWelcomeForm("רונית");
  const ch = channels.find((c) => c.n === "box-log-db");
  assert.ok(ch, "db.js opens the channel");
  await window.dbPut(set("s-from-b", today(), 80));
  assert.ok(ch.posted.some((m) => m.type === "db-write" && m.fn === "dbPut"), "a write is announced");
  assert.equal(window.totalLoggedEntries(), 0);
  for (const f of ch.l) f({ data: { type: "db-write", fn: "dbPut" } });
  await wait(400);
  assert.equal(window.totalLoggedEntries(), 1, "the other tab's write is in this tab now");
});

test("CQ-03: saving the seen medals keeps what another tab already recorded", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  await window.dbSetSetting("haimunia:seenAchievements", ["from-other-tab"]);
  await window.persistSeenAchievements();
  const v = await window.dbGetSetting("haimunia:seenAchievements");
  assert.ok(v.includes("from-other-tab"));
});

test("CQ-04: a delete that fails on disk keeps the set on screen and in the club, and says so", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  window.choosePickedMovement("back-squat");
  window.applyFieldValue("step", "weight", 60);
  await window.saveSet();
  if (window.document.getElementById("celebrationOverlay").classList.contains("open")) window.closeCelebration();
  const id = (await window.buildBackupPayload()).entries[0].id;
  let unshared = 0;
  window.haimuniaClub = { available: () => true, removePr: () => { unshared++; }, postDay: () => { unshared++; }, setShared() {}, isShared: () => true, restorePr() {} };
  window.dbDelete = async () => { throw new Error("QuotaExceededError"); };
  await window.deleteEntry(id);
  assert.equal(window.totalLoggedEntries(), 1, "the set stays");
  assert.equal(unshared, 0, "the club post is not touched");
  assert.match(window.document.getElementById("appToastDock").textContent, /המחיקה לא נשמרה במכשיר/);
});

test("CQ-06: past midnight a date the member did not choose follows the clock; a chosen one stays", async () => {
  // The app's top-level lets are not reachable from window.eval, so this goes through the screen: a date picked
  // on the chip is a chosen one and stays; the way back to today makes it unchosen again, and every render and
  // every return to the foreground (refreshDateLabel) then keeps it on today's date.
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const d = window.document;
  window.choosePickedMovement("back-squat");
  window.render();
  const input = d.getElementById("logDateInput");
  input.value = "2026-01-05";
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(window.refreshDateLabel(), false, "a chosen date is left alone");
  assert.equal(d.getElementById("logDateInput").value, "2026-01-05");
  d.querySelector("[data-action='reset-log-date']").click();
  assert.equal(window.refreshDateLabel(), false, "back on today: nothing to move");
  const src = (await import("node:fs")).readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(src, /function render\(\) \{\n  followTodayIfUnchosen\(\);/, "every render follows the clock for an unchosen date");
  assert.match(src, /if \(!logDateExplicitlyChosen && logDate !== today\) \{ logDate = today; moved = true; \}/);
});

test("CQ-07: one week, Sunday to Saturday, for the streak, the medals and 'this week'", async () => {
  const window = await bootApp();
  const wb = window.weekBucket;
  assert.equal(wb("2026-11-15"), wb("2026-11-21"), "Sunday 15 and Saturday 21 are one week");
  assert.equal(wb("2026-11-22"), wb("2026-11-21") + 1, "Sunday 22 starts the next");
  assert.equal(wb("2026-11-19"), wb("2026-11-20"), "Thursday no longer splits the week");
});

test("CQ-08: 'delete everything' clears which workouts were shared, shared PR names and queued feedback", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const keys = ["haimunia:clubShareChoice", "haimunia:clubDayRev", "haimunia:clubPrShared", "haimunia:clubShareDefault", "haimunia:feedbackQueue", "haimunia:errorReportsPending"];
  for (const k of keys) window.localStorage.setItem(k, "{\"x\":1}");
  await window.clearAllData();
  for (const k of keys) assert.equal(window.localStorage.getItem(k), null, k);
});

test("CQ-10: when the feedback queue cannot be saved, the text stays and the sheet says so", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  window.HaimuniaFeedback.open("add");
  window.document.getElementById("feedbackText").value = "הכפתור קטן מדי";
  // On the prototype: assigning setItem on a Storage object only stores an item named "setItem".
  const proto = window.Storage.prototype, real = proto.setItem;
  proto.setItem = function (k, v) { if (k === "haimunia:feedbackQueue") throw new Error("QuotaExceededError"); return real.call(this, k, v); };
  window.document.querySelector("[data-feedback='send']").click();
  await wait(300);
  assert.equal(window.document.getElementById("feedbackText").value, "הכפתור קטן מדי", "the text is still there");
  assert.match(window.document.getElementById("feedbackNote").textContent, /לא הצלחנו לשמור/);
});

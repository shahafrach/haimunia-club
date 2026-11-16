// 3.16.0: THE PERSONAL WEEKLY STREAK on the progress screen.
//
// Consecutive weeks, Sunday to Saturday in Asia/Jerusalem, with at least one lift or WOD. The current week
// counts once it has one. Computed at render time from the stored dates; nothing stored, nothing sent.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

let n = 0;
const set = (date) => ({ id: `s-${++n}`, ts: Date.parse(date + "T08:00:00Z"), exerciseId: "back-squat", type: "reps", weight: 100, reps: 5, sets: 1, date, isPR: false, est1RM: 116.7, durationSeconds: 0, groupId: null, blockLabel: null });
const wod = (date) => ({ id: `w-${++n}`, ts: Date.parse(date + "T09:00:00Z"), date, wodId: "fran", scoreType: "time", rx: true, timeSeconds: 300, notes: null, isPR: false });
async function withLog({ sets = [], wods = [] } = {}) {
  const window = await bootApp();
  if (sets.length || wods.length) {
    assert.equal(await window.importBackupData({ app: "box-log", version: 1, entries: sets.map(set), wodEntries: wods.map(wod) }), true);
  }
  return window;
}
// Instants, so the Jerusalem date is what the test means: Israel is UTC+2 in winter, UTC+3 in summer.
const at = (iso) => new Date(iso);

test("an empty log has no streak, and the screen says so in its own words", async () => {
  const window = await withLog();
  assert.deepEqual({ ...window.weeklyStreak(at("2026-11-16T10:00:00Z")) }, { weeks: 0, thisWeek: false });
  window.document.getElementById("tabHistoryBtn").click();
  const card = window.document.getElementById("weeklyStreak");
  assert.ok(card, "the card is on the progress screen");
  assert.match(card.textContent, /אין עדיין רצף/);
  assert.match(card.textContent, /אימון אחד השבוע מתחיל רצף\./);
});

test("Saturday night and Sunday morning are different weeks, by the date in Jerusalem", async () => {
  // Sat 2026-11-14 and Sun 2026-11-15 sit in consecutive weeks.
  const window = await withLog({ sets: ["2026-11-14"] });
  // 23:30 Saturday in Jerusalem (21:30Z): still the week of the 14th, which has a workout.
  assert.deepEqual({ ...window.weeklyStreak(at("2026-11-14T21:30:00Z")) }, { weeks: 1, thisWeek: true });
  // 00:30 Sunday in Jerusalem (22:30Z, still Saturday in UTC): a new, empty week; last week keeps it alive.
  assert.deepEqual({ ...window.weeklyStreak(at("2026-11-14T22:30:00Z")) }, { weeks: 1, thisWeek: false });
  // A WOD on Sunday morning makes it two.
  const both = await withLog({ sets: ["2026-11-14"], wods: ["2026-11-15"] });
  assert.deepEqual({ ...both.weeklyStreak(at("2026-11-15T06:00:00Z")) }, { weeks: 2, thisWeek: true });
  // Sunday the 15th alone, seen from Saturday the 14th's night: not this week's yet.
  const sundayOnly = await withLog({ sets: ["2026-11-15"] });
  assert.deepEqual({ ...sundayOnly.weeklyStreak(at("2026-11-14T21:30:00Z")) }, { weeks: 0, thisWeek: false });
});

test("a gap week ends the streak; a week with no workout yet does not", async () => {
  // Weeks starting 10/25, 11/1, (gap 11/8), 11/15.
  const window = await withLog({ sets: ["2026-10-27", "2026-11-03"], wods: ["2026-11-16"] });
  assert.deepEqual({ ...window.weeklyStreak(at("2026-11-16T12:00:00Z")) }, { weeks: 1, thisWeek: true }, "the gap week of 11/8 cuts it to this week");
  const alive = await withLog({ sets: ["2026-10-27", "2026-11-03", "2026-11-10"] });
  assert.deepEqual({ ...alive.weeklyStreak(at("2026-11-16T12:00:00Z")) }, { weeks: 3, thisWeek: false }, "this week is still open");
  assert.deepEqual({ ...alive.weeklyStreak(at("2026-11-23T12:00:00Z")) }, { weeks: 0, thisWeek: false }, "a whole week missed: gone");
  // Several workouts in one week count once.
  const many = await withLog({ sets: ["2026-11-15", "2026-11-16", "2026-11-17"], wods: ["2026-11-18"] });
  assert.equal(many.weeklyStreak(at("2026-11-18T12:00:00Z")).weeks, 1);
});

test("DST weeks neither split nor merge: across Israel's March and October clock changes", async () => {
  // 2026: clocks go forward Fri 27 March, back Sun 25 October. One workout each Sunday-to-Saturday week around both.
  const spring = await withLog({ sets: ["2026-03-17", "2026-03-24", "2026-03-27", "2026-03-31"] });
  // Weeks of 3/15, 3/22 (with the change on Friday 3/27, two workouts), 3/29.
  assert.deepEqual({ ...spring.weeklyStreak(at("2026-03-31T09:00:00Z")) }, { weeks: 3, thisWeek: true });
  const autumn = await withLog({ sets: ["2026-10-20", "2026-10-25", "2026-10-31", "2026-11-02"] });
  // Weeks of 10/18, 10/25 (the change is that Sunday; 10/25 and 10/31 are one week), 11/1.
  assert.deepEqual({ ...autumn.weeklyStreak(at("2026-11-02T09:00:00Z")) }, { weeks: 3, thisWeek: true });
  // Saturday night 23:30 in summer time is 20:30Z: still Saturday in Jerusalem.
  const summer = await withLog({ sets: ["2026-07-11"] });
  assert.equal(summer.weeklyStreak(at("2026-07-11T20:30:00Z")).thisWeek, true);
  assert.equal(summer.weeklyStreak(at("2026-07-11T21:30:00Z")).thisWeek, false, "00:30 Sunday in summer time");
});

test("changing a past date recalculates it; nothing about the streak is stored or sent", async () => {
  const window = await withLog({ sets: ["2026-11-03", "2026-11-10", "2026-11-16"] });
  assert.equal(window.weeklyStreak(at("2026-11-16T12:00:00Z")).weeks, 3);
  // Move the 11/10 set to 10/20 the way an edit does: the stored entry changes, then the app reloads it.
  const moved = window.entriesFor("back-squat").find((e) => e.date === "2026-11-10");
  await window.dbPut({ ...moved, date: "2026-10-20" });
  await window.reloadFromDb();
  assert.equal(window.weeklyStreak(at("2026-11-16T12:00:00Z")).weeks, 1, "the week of 11/8 is now a gap");
  const settings = await window.dbGetAllSettings();
  assert.ok(!settings.some((r) => /streak/i.test(r.key)), "no stored streak");
  assert.ok(!Object.keys(window.localStorage).some((k) => /streak/i.test(k)));
  const payload = await window.buildBackupPayload();
  assert.ok(!/streak/i.test(JSON.stringify(payload)), "not in the backup either");
});

test("the card is on the progress screen only, and not in the share prompt or the club code", async () => {
  const { readFileSync } = await import("node:fs");
  const club = readFileSync(new URL("../src/club.js", import.meta.url), "utf8");
  const connect = readFileSync(new URL("../src/connect.js", import.meta.url), "utf8");
  assert.ok(!/weeklyStreak|רצף שבועי/.test(club + connect), "the club and connect code never read it");
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const calls = [...app.matchAll(/renderWeeklyStreak\(\)/g)].length;
  assert.equal(calls, 2, "defined once, rendered once (in renderHistoryTab)");
  const window = await withLog({ sets: ["2026-11-16"] });
  window.document.getElementById("tabHistoryBtn").click();
  assert.match(window.document.getElementById("weeklyStreak").textContent, /שבוע אחד ברצף|אין עדיין רצף/);
});

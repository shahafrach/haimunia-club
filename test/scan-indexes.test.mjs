// The History and Calendar date/exercise indexes.
//
// WHAT THIS FILE IS DEFENDING. Both screens used to answer per-item questions
// with full array scans:
//
//   renderHistoryListArea  called bestLiftedSetFor / bestEst1RM /
//     bestDurationFor once per movement, and each of those calls entriesFor(),
//     which is a full scan of `entries`. Sixty movements is 180 scans, redone
//     on every keystroke of the tab's own search box.
//   renderCalendarGrid     called entries.filter(), wodEntries.filter() AND
//     hasAnyEntryOn() (two more scans) once per day cell - ~124 passes to draw
//     one month.
//   computeCurrentStreak   walked backward a day at a time calling
//     hasAnyEntryOn(), so a 100-day streak cost 200 scans for one header
//     number.
//
// Each now builds one Map per render and throws it away - no cache, so there
// is no invalidation to get wrong.
//
// THE RISK IS NOT SPEED, IT IS ANSWERS. A faster screen that reports a
// different personal record is worse than a slow one. So these tests are
// equivalence tests: the indexed path and the original scan must agree on
// every movement and every day, against real data imported through the real
// import path. The one deliberate asymmetry - excludeId falling through to
// the real scan rather than the index - is asserted too, because an index
// that quietly ignored it would let an entry count itself while being edited.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

const MOVES = ["back-squat", "deadlift", "snatch", "strict-press", "overhead-squat", "push-press"];

const FIXTURE_DATES = new Set();
function backup() {
  const entries = [];
  const base = Date.UTC(2026, 7, 1);
  for (let i = 0; i < 240; i++) {
    const day = new Date(base + (i % 90) * 86400000);
    const type = i % 11 === 0 ? "duration" : "reps";
    entries.push({
      id: "set-" + i,
      exerciseId: MOVES[i % MOVES.length],
      date: day.toISOString().slice(0, 10),
      type,
      weight: type === "duration" ? 0 : 40 + (i % 55),
      reps: type === "duration" ? 0 : 1 + (i % 6),
      sets: 1 + (i % 3),
      durationSeconds: type === "duration" ? 20 + (i % 40) : 0,
      ts: base + i * 60000,
      isPR: i % 7 === 0,
      groupId: null,
      blockLabel: null,
      est1RM: type === "duration" ? 0 : 40 + (i % 55),
    });
    FIXTURE_DATES.add(day.toISOString().slice(0, 10));
  }
  // DELIBERATELY ON DAYS NO STRENGTH ENTRY TOUCHES. The strength loop above
  // covers days 0-89; these sit at 200-219, so the calendar has days whose
  // only data is a WOD. Without that separation an index that dropped
  // wodEntries entirely still passed every assertion here - confirmed by
  // breaking it on purpose - because `ent` alone happened to cover every date
  // the fixture used. A fixture that cannot distinguish the two halves is not
  // testing either.
  const wodEntries = [];
  for (let i = 0; i < 20; i++) {
    const day = new Date(base + (200 + i) * 86400000);
    wodEntries.push({
      id: "wod-" + i, wodId: "fran", date: day.toISOString().slice(0, 10),
      scoreType: "time", timeSeconds: 200 + i, rounds: 0, reps: 0, weight: 0,
      ts: base + i * 120000, isPR: i % 5 === 0, rx: true, notes: null,
    });
    FIXTURE_DATES.add(day.toISOString().slice(0, 10));
  }
  return JSON.stringify({
    app: "box-log", version: 1, exportedAt: new Date().toISOString(),
    entries, customMovements: [], wodEntries, customWods: [],
    bodyweightEntries: [], measureTypes: [], measureEntries: [],
  });
}

async function seeded() {
  const window = await bootApp();
  const raw = backup();
  const file = new window.File([raw], "box-log-backup.json", { type: "application/json" });
  await window.importDataFromFile(file);
  await new Promise((r) => setTimeout(r, 400));
  await window.reloadFromDb();
  return window;
}

test("the fixture actually landed - otherwise every equivalence below is vacuously true", async () => {
  const window = await seeded();
  assert.ok(window.entriesFor(MOVES[0]).length > 10,
    "the imported entries are readable through the unindexed path");
});

test("entriesByExercise agrees with entriesFor for every movement, element for element", async () => {
  const window = await seeded();
  const index = window.entriesByExercise();
  for (const id of MOVES) {
    const scanned = window.entriesFor(id);
    const indexed = index.get(id) || [];
    assert.deepEqual(
      indexed.map((e) => e.id), scanned.map((e) => e.id),
      `${id}: the index must hold the same entries in the same order - bestLiftedSetFor's tie-break reads ts in list order`);
  }
});

test("the three best-* helpers return identical answers indexed and unindexed", async () => {
  const window = await seeded();
  const index = window.entriesByExercise();
  let checked = 0;
  for (const id of MOVES) {
    const plainSet = window.bestLiftedSetFor(id);
    const idxSet = window.bestLiftedSetFor(id, undefined, index);
    assert.equal(idxSet ? idxSet.id : null, plainSet ? plainSet.id : null, `${id}: heaviest set`);
    assert.equal(window.bestEst1RM(id, undefined, index), window.bestEst1RM(id), `${id}: estimated 1RM`);
    assert.equal(window.bestDurationFor(id, undefined, index), window.bestDurationFor(id), `${id}: longest hold`);
    if (plainSet) checked += 1;
  }
  assert.ok(checked >= MOVES.length - 1, "these movements really do have lifted sets to compare");
});

test("excludeId is NOT served from the index - an entry being edited must not count itself", async () => {
  const window = await seeded();
  const index = window.entriesByExercise();
  const id = MOVES[0];
  const all = window.entriesFor(id);
  const top = window.bestLiftedSetFor(id);
  assert.ok(top, "there is a heaviest set to exclude");

  // With the record itself excluded the answer must CHANGE, and must match
  // the unindexed scan - passing an index alongside an excludeId must not
  // silently hand back the full list.
  const withoutIt = window.bestLiftedSetFor(id, top.id, index);
  const withoutItPlain = window.bestLiftedSetFor(id, top.id);
  assert.equal(withoutIt ? withoutIt.id : null, withoutItPlain ? withoutItPlain.id : null,
    "index + excludeId falls through to the real scan");
  assert.notEqual(withoutIt.id, top.id, "and the excluded entry is genuinely gone from the answer");
  assert.equal(all.length, window.entriesFor(id).length, "the scan itself was not mutated");
});

test("buildDayIndex agrees with hasAnyEntryOn on every day the fixture touches, and on days it does not", async () => {
  const window = await seeded();
  const index = window.buildDayIndex();
  // The dates come from the fixture, not from the app: `entries` and
  // `wodEntries` are top-level `let` bindings inside an indirect eval, so
  // they reach neither window nor a further eval's scope. Function
  // declarations do attach, which is why hasAnyEntryOn() below is callable
  // while the arrays it reads are not. Same constraint calendar.test.mjs
  // works around by clicking rather than reading calYear.
  const seen = new Set(FIXTURE_DATES);
  assert.ok(seen.size > 30, "the fixture spans a real range of dates");

  for (const iso of seen) {
    assert.equal(window.hasAnyEntryOn(iso, index), true, `${iso} has data both ways`);
    assert.equal(window.hasAnyEntryOn(iso, index), window.hasAnyEntryOn(iso), `${iso} agrees`);
  }
  // Days with nothing on them are the half that a broken index would get
  // wrong in the dangerous direction: a dot on an empty day.
  for (const iso of ["2025-01-01", "2030-12-31", "2026-06-15"]) {
    if (seen.has(iso)) continue;
    assert.equal(window.hasAnyEntryOn(iso, index), false, `${iso} is empty`);
    assert.equal(window.hasAnyEntryOn(iso, index), window.hasAnyEntryOn(iso), `${iso} agrees`);
  }
});

test("the calendar grid still draws a dot on exactly the days that have data", async () => {
  const window = await seeded();
  window.document.getElementById("tabCalendarBtn").click();
  const grid = window.document.getElementById("calGrid");
  assert.ok(grid, "the calendar rendered");

  const cells = Array.from(grid.querySelectorAll("[data-action='cal-select-day']"));
  assert.ok(cells.length >= 28, "a month of day cells");
  let withDots = 0;
  for (const cell of cells) {
    const iso = cell.getAttribute("data-date");
    const hasDot = !!cell.querySelector(".cal-dot");
    assert.equal(hasDot, window.hasAnyEntryOn(iso),
      `${iso}: the dot and the data must agree - this is the assertion an index bug would break`);
    if (hasDot) withDots += 1;
  }
  assert.ok(withDots > 0, "the rendered month actually contains logged days, so the check above had something to check");
});

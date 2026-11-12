// Live bug hunt, round 3 (2026-09-11): three fresh agents driving the real
// app in Chromium against the mocked backend found 9 confirmed bugs across
// achievements/streaks, the WOD/benchmark catalogue, and search & discovery
// (see CHANGES.md for the full report). This file covers the 8 findings that
// live in app.js (the offline training log); the 9th (Community's member
// directory search) has its own regression test appended to
// test/community-members-directory.test.mjs, right next to the sibling bug
// it mirrors.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp, waitFor, answerWodRx } from "./helpers/boot.mjs";

async function saveSquatEntry(window, movementId, kg) {
  window.choosePickedMovement(movementId);
  window.applyFieldValue("step", "weight", kg);
  await window.saveSet();
  window.closeCelebration();
}

// ---------------------------------------------------------------------------
// Achievements & streaks
// ---------------------------------------------------------------------------

test("a set saved after the real day changes, with the date field never touched, is dated today - not the stale day the app happened to load on", async () => {
  const window = await bootApp();
  await window.addMovement("Test Midnight Movement", "Squat");
  const movement = window.allMovements().find((m) => m.name === "Test Midnight Movement");
  window.choosePickedMovement(movement.id);
  window.applyFieldValue("step", "weight", 40);
  window.applyFieldValue("step", "reps", 5);

  // logDate is captured once, at page load (let logDate = todayISO()), and
  // read again whenever a set is actually saved - the ordinary flow never
  // touches the date field at all. Simulate the real-world clock crossing
  // midnight while the app stayed open: todayISO() should report the NEXT
  // day from here on, same as a phone's real clock would.
  const RealDate = window.Date;
  const tomorrowMs = RealDate.now() + 24 * 60 * 60 * 1000;
  class FixedDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(tomorrowMs); else super(...args); }
    static now() { return tomorrowMs; }
  }
  window.Date = FixedDate;
  try {
    await window.saveSet();
  } finally {
    window.Date = RealDate;
  }

  const dbEntries = await window.dbLoadAll();
  const saved = dbEntries.find((e) => e.exerciseId === movement.id);
  assert.ok(saved, "the set should be persisted");
  assert.equal(saved.date, window.localISODate(new RealDate(tomorrowMs)),
    "a normal save (date field never touched) must read today's date fresh at save time, not a value captured at page load");
});

test("editing an unrelated older entry does not silently re-lock an already-earned, already-celebrated PR-tier badge", async () => {
  const window = await bootApp();
  await window.addMovement("Test Bronze Squat", "Squat");
  const movement = window.allMovements().find((m) => m.name === "Test Bronze Squat");

  const ids = [];
  for (const kg of [40, 45, 50, 55, 60, 65]) {
    await saveSquatEntry(window, movement.id, kg);
    const dbEntries = await window.dbLoadAll();
    ids.push(dbEntries.filter((e) => e.exerciseId === movement.id).sort((a, b) => b.ts - a.ts)[0].id);
  }
  // MIN_ENTRIES_BEFORE_PR (3): only the 4th/5th/6th saves (indices 3-5, the
  // 55/60/65kg entries) are real, celebratable PRs.
  assert.equal(window.categoryPRCounts().Squat, 3, "three genuine PRs expected from this sequence");

  window.openAchievements();
  const bronzeBefore = [...window.document.querySelectorAll(".medal-badge")]
    .find((el) => el.querySelector(".medal-name")?.textContent === "Squat — ברונזה");
  assert.ok(bronzeBefore, "the bronze Squat badge should be rendered");
  assert.ok(bronzeBefore.classList.contains("earned"), "bronze should be earned after 3 real PRs");
  window.closeAchievements();

  // An ordinary correction to the 5th save (60kg -> 52kg) - not the badge-
  // earning moment itself, and nowhere near the medal screen. This alone
  // drops the raw categoryPRCounts() back to 2 (see achievements-depth live
  // report), which used to re-lock the badge on the very next render.
  await window.startEditEntry(ids[4]);
  window.applyFieldValue("step", "weight", 52);
  await window.saveSet();
  window.closeCelebration();
  assert.equal(window.categoryPRCounts().Squat, 2, "the live count itself does drop - that's expected and correct");

  window.openAchievements();
  const bronzeAfter = [...window.document.querySelectorAll(".medal-badge")]
    .find((el) => el.querySelector(".medal-name")?.textContent === "Squat — ברונזה");
  assert.ok(bronzeAfter && bronzeAfter.classList.contains("earned"),
    "a medal already earned and celebrated must stay earned even after an unrelated edit changes the underlying live count - seenAchievementIds is the permanent record, not a.earned() alone");
  window.closeAchievements();
});

test("a celebration deferred behind an open dialog is flushed by Escape, not stranded until an unrelated later click", async () => {
  const window = await bootApp();
  await window.addMovement("Test Escape Flush", "Squat");
  const movement = window.allMovements().find((m) => m.name === "Test Escape Flush");
  // Baseline past MIN_ENTRIES_BEFORE_PR so the next save is a genuine,
  // celebratable PR.
  for (const kg of [40, 45, 50]) await saveSquatEntry(window, movement.id, kg);

  window.openAchievements();
  assert.equal(window.document.getElementById("achievementsOverlay").classList.contains("open"), true);

  // A save that lands while Achievements (a registered blocking dialog) is
  // open - showCelebration() must defer instead of dropping it.
  window.choosePickedMovement(movement.id);
  window.applyFieldValue("step", "weight", 55);
  await window.saveSet();
  assert.equal(window.document.getElementById("celebrationOverlay").classList.contains("open"), false,
    "the celebration must stay deferred while a blocking dialog is open");

  // Close Achievements via Escape - not a click. flushDeferredCelebration()
  // used to be wired only into closeOnboarding() and the generic click
  // handler's tail, so this used to leave the celebration stuck.
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(window.document.getElementById("achievementsOverlay").classList.contains("open"), false, "Escape should close Achievements");
  assert.equal(window.document.getElementById("celebrationOverlay").classList.contains("open"), true,
    "the deferred celebration must flush the instant its blocking dialog closes via Escape, not wait for some later unrelated click");
});

test("the flame/record marker is gated the same way categoryPRCounts() already is, and clears retroactively when a later edit changes the real running max", async () => {
  const window = await bootApp();
  await window.addMovement("Test Flame Gate", "Squat");
  const movement = window.allMovements().find((m) => m.name === "Test Flame Gate");

  const ids = [];
  for (const kg of [40, 45, 50, 55, 60, 65]) {
    await saveSquatEntry(window, movement.id, kg);
    const dbEntries = await window.dbLoadAll();
    ids.push(dbEntries.filter((e) => e.exerciseId === movement.id).sort((a, b) => b.ts - a.ts)[0].id);
  }

  let celebratable = window.celebratablePrEntryIds();
  assert.equal(celebratable.has(ids[0]), false, "the trivial first-ever entry has nothing to beat and must not show a record flame");
  assert.deepStrictEqual([...celebratable].sort(), [ids[3], ids[4], ids[5]].sort(),
    "only the 4th/5th/6th saves (past MIN_ENTRIES_BEFORE_PR) are real records");

  // Edit the 4th save (55kg) up past the 5th (60kg) - an ordinary correction
  // to an entry that is NOT the one currently carrying the flame.
  await window.startEditEntry(ids[3]);
  window.applyFieldValue("step", "weight", 62);
  await window.saveSet();
  window.closeCelebration();

  const dbAfter = await window.dbLoadAll();
  const supersededEntry = dbAfter.find((e) => e.id === ids[4]);
  assert.equal(supersededEntry.isPR, true, "the raw stored flag on the un-edited 60kg entry is never revisited by saveSet() - it stays stale, by design (see its own comment)");

  celebratable = window.celebratablePrEntryIds();
  assert.equal(celebratable.has(ids[4]), false, "the gated view recomputes fresh and correctly drops the entry the edit leapfrogged past");
  assert.equal(window.isFlameworthyEntry(supersededEntry, celebratable), false,
    "isFlameworthyEntry() - what the day list, calendar dot and ימי שיא stat now actually read - agrees with the recomputed set, not the stale raw flag");
});

// ---------------------------------------------------------------------------
// WOD / benchmark catalogue
// ---------------------------------------------------------------------------

test("building a custom WOD with a name that already exists tells the member instead of silently discarding their work", async () => {
  const window = await bootApp();
  await window.addCustomWod("Test Existing WOD", "amrap", "");
  const existing = window.allWods().find((w) => w.name === "Test Existing WOD");
  assert.ok(existing);

  await window.addCustomWod("Test Existing WOD", "time", "a completely different format the builder just spent time on");

  await waitFor(() => !!window.document.getElementById("appToastBar"), 3000);
  assert.match(window.document.getElementById("appToastBar").textContent, /כבר קיים אימון בשם/,
    "the collision used to be completely silent - the member had no idea their build was discarded");
  assert.equal(window.allWods().filter((w) => w.name.toLowerCase() === "test existing wod").length, 1,
    "still exactly one WOD of that name - the redirect-to-existing behavior itself is unchanged, only the silence is fixed");
});

test("undoing a deleted WOD attempt after its WOD definition was ALSO deleted in the meantime refuses, instead of resurrecting a permanently orphaned entry", async () => {
  const window = await bootApp();
  await window.addCustomWod("Test Orphan WOD", "load", "");
  const wod = window.allWods().find((w) => w.name === "Test Orphan WOD");

  window.document.getElementById("tabWodBtn").click();
  window.applyFieldValue("wod-step", "wodWeight", 60);
  answerWodRx(window);
  await window.saveWod();
  const savedBefore = (await window.dbLoadWodEntries()).find((e) => e.wodId === wod.id);
  assert.ok(savedBefore);

  // Delete the attempt (offers undo) - deleteCustomWod()'s own history guard
  // only sees wodEntries as they are AFTER this filter, so the WOD itself
  // now looks history-free and deletable too.
  await window.deleteWodEntry(savedBefore.id);
  assert.equal((await window.dbLoadWodEntries()).find((e) => e.id === savedBefore.id), undefined);
  await window.deleteCustomWod(wod.id);
  assert.equal(window.allWods().find((w) => w.id === wod.id), undefined, "the WOD definition itself is now gone");

  // Press undo on the still-pending toast for the entry.
  await window.restoreWodEntry(savedBefore);

  const afterUndo = await window.dbLoadWodEntries();
  assert.equal(afterUndo.find((e) => e.id === savedBefore.id), undefined,
    "restoreWodEntry() must refuse when the entry's own WOD no longer exists - resurrecting it used to create a permanently orphaned entry (invisible in History, a \"?\" row in the calendar forever, a silent no-op edit pencil)");
  await waitFor(() => !!window.document.getElementById("appToastBar"), 3000);
  assert.match(window.document.getElementById("appToastBar").textContent, /נמחק בינתיים/);
});

test("Rx and Scaled attempts are compared as separate personal-best tracks, not one pool - a faster Scaled time can't stand in for a real Rx PR, and a genuine Rx improvement isn't hidden behind an unrelated Scaled attempt", async () => {
  const window = await bootApp();
  await window.addCustomWod("Test Rx Scaled WOD", "time", "");
  const wod = window.allWods().find((w) => w.name === "Test Rx Scaled WOD");

  async function logTime(minutes, seconds, rx) {
    window.document.getElementById("tabWodBtn").click();
    window.applyFieldValue("wod-step", "wodMinutes", minutes);
    window.applyFieldValue("wod-step", "wodSeconds", seconds);
    answerWodRx(window, rx);
    await window.saveWod();
    window.closeCelebration();
    const entries = await window.dbLoadWodEntries();
    return entries.filter((e) => e.wodId === wod.id).sort((a, b) => b.ts - a.ts)[0];
  }

  // UPDATED 2026-09-16. These two used to assert that a first-ever attempt in
  // each track IS a record. Round 8 of the fresh hunt found that rule wrong -
  // `prevBest === null ||` made every member's first attempt at every WOD an
  // unearned personal record, celebration and all, for a result with nothing
  // to compare against. The strength side had always said "nothing is a
  // personal record until there is something to beat"; the WOD side had the
  // sign inverted.
  //
  // The property THIS test exists for is untouched by that: Rx and Scaled are
  // separate tracks. Both assertions are simply restated for the corrected
  // rule - a first attempt establishes a track's baseline rather than
  // scoring against nothing.
  const rx1 = await logTime(9, 0, true); // 540s, first Rx attempt
  assert.equal(rx1.isPR, false, "a first-ever Rx attempt has nothing to beat, so it is not a record");

  const scaled1 = await logTime(8, 0, false); // 480s - numerically "faster" than Rx, but a different category
  assert.equal(scaled1.isPR, false, "and neither is a first-ever Scaled attempt, in its own separate track");

  // Live report's core finding: before the fix, "the" record ignored Rx/
  // Scaled entirely, so the faster Scaled time silently overwrote the
  // displayed Rx record.
  assert.equal(window.formatWodBest(wod.id), "9:00",
    "the displayed record must prefer the Rx best (the standard/prescribed version) over a faster but Scaled attempt");

  // A genuine Rx improvement (8:30, beats the prior Rx best of 9:00) that
  // happens to still be numerically slower than the unrelated Scaled 8:00
  // sitting in between them.
  const rx2 = await logTime(8, 30, true); // 510s
  assert.equal(rx2.isPR, true,
    "before the fix, this was wrongly denied \"PR\" status because the unfiltered comparison measured it against the faster Scaled attempt (510 > 480), not against the Rx history it actually belongs to (510 < 540)");
  assert.equal(window.formatWodBest(wod.id), "8:30", "the Rx record should now reflect the genuine Rx improvement");
});

test("the WOD history chart's PR dots use a strict comparison, matching the real stored flag - an exact tie is not a second PR", async () => {
  const window = await bootApp();
  await window.addCustomWod("Test Chart Tie WOD", "time", "");
  const wod = window.allWods().find((w) => w.name === "Test Chart Tie WOD");

  async function logTime(minutes, seconds) {
    window.document.getElementById("tabWodBtn").click();
    window.applyFieldValue("wod-step", "wodMinutes", minutes);
    window.applyFieldValue("wod-step", "wodSeconds", seconds);
    answerWodRx(window, true);
    await window.saveWod();
  }

  await logTime(10, 0); // 600s - first attempt, a PR by construction
  await logTime(9, 0);  // 540s - a genuine improvement, a real PR
  await logTime(9, 0);  // 540s again - an EXACT TIE with the current best

  const cardHtml = window.renderWodDetailCard(wod);
  const prDotCount = (cardHtml.match(/r="5"/g) || []).length;
  assert.equal(prDotCount, 2,
    "an inclusive (<=) comparison used to count the tied third attempt as a second PR dot, disagreeing with the attempt list right below it (which reads the real, strictly-compared entry.isPR flag)");
});

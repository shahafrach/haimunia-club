// Drives the real app (not a reimplementation) through its own exposed
// functions — addMovement/applyFieldValue/saveSet/reloadFromDb — the same
// functions its click handlers call. This is the regression net for the
// "add a movement, log a set, restart the app" path: IndexedDB writes
// actually landing, and reloadFromDb() correctly re-sanitizing and
// repopulating in-memory state from what's on disk.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

test("add a movement, log a set, and see it survive a simulated reload", async () => {
  const window = await bootApp();

  const before = window.allMovements().length;
  await window.addMovement("Test Overhead Press", "Press");
  const movements = window.allMovements();
  assert.equal(movements.length, before + 1);
  const movement = movements.find((m) => m.name === "Test Overhead Press");
  assert.ok(movement, "new movement should be findable by name");
  assert.equal(movement.category, "Press");

  // addMovement() already selects the new movement (selectedId), so the
  // stepper fields below apply to it.
  window.applyFieldValue("step", "weight", 62.5);
  window.applyFieldValue("step", "reps", 5);
  window.applyFieldValue("step", "sets", 3);
  await window.saveSet();

  const dbEntries = await window.dbLoadAll();
  const saved = dbEntries.find((e) => e.exerciseId === movement.id);
  assert.ok(saved, "the set should be persisted to IndexedDB");
  assert.equal(saved.weight, 62.5);
  assert.equal(saved.reps, 5);
  assert.equal(saved.sets, 3);

  // Simulate an app restart: wipe in-memory state's only path back to truth
  // is IndexedDB, so reloadFromDb() re-sanitizing correctly is what "your
  // data survives closing the app" actually depends on.
  await window.reloadFromDb();
  const afterReload = window.entriesFor(movement.id);
  assert.equal(afterReload.length, 1);
  assert.equal(afterReload[0].weight, 62.5);
  assert.equal(afterReload[0].reps, 5);
  assert.equal(afterReload[0].sets, 3);

  const movementsAfterReload = window.allMovements();
  assert.ok(movementsAfterReload.some((m) => m.name === "Test Overhead Press"), "custom movement should survive reload too");
});

test("editing an existing entry overwrites it in place rather than duplicating it", async () => {
  const window = await bootApp();
  await window.addMovement("Test Deadlift", "Deadlift");
  const movement = window.allMovements().find((m) => m.name === "Test Deadlift");

  window.applyFieldValue("step", "weight", 100);
  window.applyFieldValue("step", "reps", 5);
  window.applyFieldValue("step", "sets", 1);
  await window.saveSet();

  const [entry] = window.entriesFor(movement.id);
  await window.startEditEntry(entry.id);
  window.applyFieldValue("step", "weight", 110);
  await window.saveSet();

  const dbEntries = await window.dbLoadAll();
  const forMovement = dbEntries.filter((e) => e.exerciseId === movement.id);
  assert.equal(forMovement.length, 1, "editing should overwrite, not add a second row");
  assert.equal(forMovement[0].weight, 110);
});

test("a ladder (different weight+reps each round) groups under one groupId and survives reload", async () => {
  const window = await bootApp();
  await window.addMovement("Test Press Ladder", "Press");
  const movement = window.allMovements().find((m) => m.name === "Test Press Ladder");

  window.toggleLadderMode(); // ladder on
  const rungs = [[60, 6], [70, 5], [80, 4], [85, 3], [90, 3]];
  for (const [w, r] of rungs) {
    window.applyFieldValue("step", "weight", w);
    window.applyFieldValue("step", "reps", r);
    window.applyFieldValue("step", "sets", 1);
    await window.saveSet();
  }

  const rounds = window.currentLadderRounds();
  assert.equal(rounds.length, 5, "all 5 rungs should be tagged into the running ladder");
  assert.deepEqual(rounds.map((r) => [r.weight, r.reps]), rungs, "rounds should stay in the order they were logged");
  const groupId = rounds[0].groupId;
  assert.ok(groupId, "rounds should carry a real groupId");
  assert.ok(rounds.every((r) => r.groupId === groupId), "every rung should share the same groupId");

  // The day view's own grouping should fold these 5 rows into one group.
  const dayEntries = window.entriesFor(movement.id);
  const groups = window.groupDayEntries(dayEntries);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 5);

  window.toggleLadderMode(); // finish the ladder

  // Restart: reloadFromDb() must re-sanitize groupId correctly too.
  await window.reloadFromDb();
  const afterReload = window.entriesFor(movement.id);
  assert.equal(afterReload.length, 5);
  assert.ok(afterReload.every((e) => e.groupId === groupId), "groupId should survive a reload");

  // A fresh ladder for a different exercise gets its own, different groupId.
  await window.addMovement("Test Press Ladder 2", "Press");
  window.toggleLadderMode();
  window.applyFieldValue("step", "weight", 40);
  window.applyFieldValue("step", "reps", 8);
  await window.saveSet();
  const newRounds = window.currentLadderRounds();
  assert.equal(newRounds.length, 1);
  assert.notEqual(newRounds[0].groupId, groupId, "a new ladder session should not reuse the previous groupId");
});

test("the PR celebration popup is suppressed mid-ladder but fires normally otherwise", async () => {
  const window = await bootApp();
  const isCelebrationOpen = () => window.document.getElementById("celebrationOverlay").classList.contains("open");

  await window.addMovement("Test Celebration Press", "Press");
  window.toggleLadderMode();
  window.applyFieldValue("step", "weight", 60);
  window.applyFieldValue("step", "reps", 6);
  await window.saveSet();
  assert.equal(isCelebrationOpen(), false, "first rung of a fresh movement is a PR but the popup should stay closed mid-ladder");

  window.applyFieldValue("step", "weight", 70);
  window.applyFieldValue("step", "reps", 5);
  await window.saveSet();
  assert.equal(isCelebrationOpen(), false, "still suppressed for later rungs");

  window.toggleLadderMode(); // finish the ladder

  await window.addMovement("Test Celebration Deadlift", "Deadlift");
  window.applyFieldValue("step", "reps", 3);
  // UX-audit recalibration (design spec 5.3.1, MIN_ENTRIES_BEFORE_PR): a
  // celebration needs 3 prior entries for the exercise to beat, so this used
  // to pass on the movement's FIRST set - the "with no history every set is
  // a record" behaviour the audit flagged. The point under test here is the
  // ladder suppression above and that a normal save still celebrates, both
  // unchanged; only the baseline this save is measured against is new.
  for (const kg of [100, 105, 110]) {
    window.applyFieldValue("step", "weight", kg);
    await window.saveSet();
    window.closeCelebration();
  }
  window.applyFieldValue("step", "weight", 120);
  await window.saveSet();
  assert.equal(isCelebrationOpen(), true, "a normal (non-ladder) PR save should still celebrate");
});

test("switching exercise mid-ladder ends it, so the next save doesn't silently join it", async () => {
  const window = await bootApp();
  await window.addMovement("Test Ladder Squat", "Squat");
  const squat = window.allMovements().find((m) => m.name === "Test Ladder Squat");
  window.toggleLadderMode();
  window.applyFieldValue("step", "weight", 100);
  window.applyFieldValue("step", "reps", 5);
  await window.saveSet();
  const groupId = window.currentLadderRounds()[0].groupId;

  await window.addMovement("Test Ladder Bench", "Press"); // switches selectedId -> should end the ladder
  window.applyFieldValue("step", "weight", 60);
  window.applyFieldValue("step", "reps", 8);
  await window.saveSet();

  const benchEntry = window.allMovements().find((m) => m.name === "Test Ladder Bench");
  const benchSets = window.entriesFor(benchEntry.id);
  assert.equal(benchSets.length, 1);
  assert.equal(benchSets[0].groupId, null, "a set logged after switching exercise should not join the old ladder");

  const squatSets = window.entriesFor(squat.id);
  assert.equal(squatSets[0].groupId, groupId, "the squat set already saved keeps its original groupId");
});

test("editing an unrelated entry mid-ladder ends it; editing the ladder's own round does not", async () => {
  const window = await bootApp();

  // A pre-existing, unrelated set — logged before any ladder starts, so
  // later editing it isn't itself the thing that would end the ladder
  // (addMovement()/pick-movement already end it; this test isolates what
  // startEditEntry() alone does).
  await window.addMovement("Test Unrelated Deadlift", "Deadlift");
  window.applyFieldValue("step", "weight", 120);
  window.applyFieldValue("step", "reps", 3);
  await window.saveSet();
  const [unrelatedEntry] = window.entriesFor(window.allMovements().find((m) => m.name === "Test Unrelated Deadlift").id);

  await window.addMovement("Test Ladder Bench Press", "Press");
  const bench = window.allMovements().find((m) => m.name === "Test Ladder Bench Press");
  window.toggleLadderMode();
  window.applyFieldValue("step", "weight", 60);
  window.applyFieldValue("step", "reps", 8);
  await window.saveSet();
  const [ladderRound] = window.currentLadderRounds();
  assert.equal(window.currentLadderRounds().length, 1);

  const isOn = () => window.document.querySelector("[data-action='toggle-ladder-mode']").textContent.includes("סולם פעיל");

  // Fixing a typo in the ladder's own round (same session) must NOT end it —
  // otherwise a quick correction would strand anyone about to log set 2+.
  await window.startEditEntry(ladderRound.id);
  assert.equal(isOn(), true, "editing the active ladder's own round should not end it");
  window.applyFieldValue("step", "weight", 62.5);
  await window.saveSet();
  assert.equal(window.currentLadderRounds().length, 1, "still one round, corrected weight, same session");
  assert.equal(window.currentLadderRounds()[0].weight, 62.5);

  // Editing a genuinely unrelated entry, by contrast, should end it.
  await window.startEditEntry(unrelatedEntry.id);
  assert.equal(isOn(), false, "editing an unrelated entry should end the ladder, same as switching exercise does");
  window.applyFieldValue("step", "weight", 125);
  await window.saveSet();
  const editedEntries = window.entriesFor(unrelatedEntry.exerciseId);
  assert.equal(editedEntries.length, 1, "editing should still overwrite in place");
  assert.equal(editedEntries[0].groupId, null, "the edited row must keep its own (null) groupId, not join the ladder it interrupted");

  const benchSets = window.entriesFor(bench.id);
  assert.equal(benchSets.length, 1, "the ladder's own round is untouched by editing the unrelated entry");
  assert.equal(benchSets[0].weight, 62.5);
});

test("prefillFromLast() copies the exercise's last weight/reps/sets into the steppers", async () => {
  const window = await bootApp();
  await window.addMovement("Test Prefill Row", "Pull");
  const movement = window.allMovements().find((m) => m.name === "Test Prefill Row");

  window.applyFieldValue("step", "weight", 45);
  window.applyFieldValue("step", "reps", 12);
  window.applyFieldValue("step", "sets", 3);
  await window.saveSet();

  // Switch to a different exercise first, so the steppers hold unrelated
  // values — prefill must pull from Test Prefill Row's own history, not
  // whatever happened to be left over from the previous save.
  await window.addMovement("Test Prefill Other", "Press");
  window.applyFieldValue("step", "weight", 999);
  window.applyFieldValue("step", "reps", 1);
  window.applyFieldValue("step", "sets", 1);

  await window.addMovement("Test Prefill Row", "Pull"); // re-selects the existing movement (exact-name match branch)

  window.prefillFromLast();

  const weightVal = window.document.querySelector("[data-field='weight'].stepper-val").value;
  const repsVal = window.document.querySelector("[data-field='reps'].stepper-val").value;
  const setsVal = window.document.querySelector("[data-field='sets'].stepper-val").value;
  assert.equal(weightVal, "45");
  assert.equal(repsVal, "12");
  assert.equal(setsVal, "3");

  // And it actually saves a matching entry, not just visually-updated inputs.
  await window.saveSet();
  const rows = window.entriesFor(movement.id);
  assert.equal(rows.length, 2, "should have the original set plus this new prefilled one");
  assert.equal(rows[0].weight, 45);
  assert.equal(rows[0].reps, 12);
  assert.equal(rows[0].sets, 3);
});

test("prefillFromLast() is a no-op for an exercise with no history yet", async () => {
  const window = await bootApp();
  await window.addMovement("Test Prefill Fresh", "Squat");
  window.applyFieldValue("step", "weight", 40);
  window.prefillFromLast(); // no prior entry for this movement
  const weightVal = window.document.querySelector("[data-field='weight'].stepper-val").value;
  assert.equal(weightVal, "40", "stepper value should be untouched when there's nothing to prefill from");
});

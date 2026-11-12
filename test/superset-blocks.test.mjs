// Sub-task B: multi-part A/B/C session blocks with supersets. A superset is
// implemented as an extension of the existing ladder mechanism (see
// ladder.mjs / app-flow.test.mjs's ladder tests): the same groupId, but
// rounds spanning two exerciseIds instead of one, alternated by
// switchLadderExercise() instead of the normal picker (which always ends
// the ladder). blockLabel is a separate, optional per-group tag. None of
// this touches saveSet()'s validation for the plain single-exercise case —
// see "a plain single-exercise save is completely unaffected" below.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

test("a plain single-exercise save is completely unaffected by the superset/block-label additions", async () => {
  const window = await bootApp();
  await window.addMovement("Test Plain Bench", "Press");
  window.applyFieldValue("step", "weight", 60);
  window.applyFieldValue("step", "reps", 5);
  window.applyFieldValue("step", "sets", 3);
  await window.saveSet();

  const dbEntries = await window.dbLoadAll();
  const saved = dbEntries.find((e) => e.exerciseId === window.allMovements().find((m) => m.name === "Test Plain Bench").id);
  assert.ok(saved);
  assert.equal(saved.weight, 60);
  assert.equal(saved.reps, 5);
  assert.equal(saved.sets, 3);
  assert.equal(saved.groupId, null);
  assert.equal(saved.blockLabel, null, "a plain set outside any ladder must never pick up a block label");
});

test("setLadderPartner turns an active ladder into a superset spanning two exercises under one groupId", async () => {
  const window = await bootApp();
  await window.addMovement("Test Superset Squat", "Squat");
  const squat = window.allMovements().find((m) => m.name === "Test Superset Squat");
  await window.addMovement("Test Superset Row", "Pull");
  const row = window.allMovements().find((m) => m.name === "Test Superset Row");

  // Re-select the squat as the primary exercise before starting the ladder.
  await window.addMovement("Test Superset Squat", "Squat");
  window.toggleLadderMode();
  window.setLadderPartner(row.id);

  window.applyFieldValue("step", "weight", 80);
  window.applyFieldValue("step", "reps", 5);
  await window.saveSet(); // round 1, squat

  window.switchLadderExercise(row.id);
  window.applyFieldValue("step", "weight", 40);
  window.applyFieldValue("step", "reps", 10);
  await window.saveSet(); // round 1, row

  window.switchLadderExercise(squat.id);
  window.applyFieldValue("step", "weight", 85);
  await window.saveSet(); // round 2, squat

  const rounds = window.currentLadderRounds();
  assert.equal(rounds.length, 3);
  const groupId = rounds[0].groupId;
  assert.ok(rounds.every((r) => r.groupId === groupId), "all three rounds share one groupId regardless of which exercise");
  assert.deepEqual(rounds.map((r) => r.exerciseId), [squat.id, row.id, squat.id], "rounds stay in the order they were actually saved");

  window.toggleLadderMode(); // finish
});

test("switching between the superset's two exercises via switchLadderExercise never ends the ladder", async () => {
  const window = await bootApp();
  await window.addMovement("Test Alt Press", "Press");
  const press = window.allMovements().find((m) => m.name === "Test Alt Press");
  await window.addMovement("Test Alt Curl", "Other");
  const curl = window.allMovements().find((m) => m.name === "Test Alt Curl");

  await window.addMovement("Test Alt Press", "Press");
  window.toggleLadderMode();
  window.setLadderPartner(curl.id);

  const isOn = () => window.document.querySelector("[data-action='toggle-ladder-mode']").textContent.includes("פעיל");
  assert.equal(isOn(), true);
  window.switchLadderExercise(curl.id);
  assert.equal(isOn(), true, "switching to the partner exercise must not end the superset");
  window.switchLadderExercise(press.id);
  assert.equal(isOn(), true, "switching back to the primary must not end it either");
});

test("switchLadderExercise ignores an id that isn't one of the superset's two exercises", async () => {
  const window = await bootApp();
  await window.addMovement("Test Guard Press", "Press");
  const press = window.allMovements().find((m) => m.name === "Test Guard Press");
  await window.addMovement("Test Guard Curl", "Other");
  const curl = window.allMovements().find((m) => m.name === "Test Guard Curl");
  await window.addMovement("Test Guard Third", "Squat");
  const third = window.allMovements().find((m) => m.name === "Test Guard Third");

  await window.addMovement("Test Guard Press", "Press");
  window.toggleLadderMode();
  window.setLadderPartner(curl.id);

  window.switchLadderExercise(third.id); // not one of the two — must be a no-op
  const exerciseName = window.document.querySelector(".exercise-select span").textContent.trim();
  assert.equal(exerciseName, "Test Guard Press", "an unrelated exercise id should not change the current selection");
});

test("setLadderPartner refuses to pair an exercise with itself", async () => {
  const window = await bootApp();
  await window.addMovement("Test Self Pair", "Squat");
  const movement = window.allMovements().find((m) => m.name === "Test Self Pair");
  window.toggleLadderMode();
  window.setLadderPartner(movement.id);
  window.applyFieldValue("step", "weight", 50);
  await window.saveSet();
  const [entry] = window.currentLadderRounds();
  assert.equal(entry.groupId, window.currentLadderRounds()[0].groupId);
  // No partner should have been set, so this stays a plain (single-exercise) ladder.
  const partnerButtonExists = !!window.document.querySelector('[data-action="ladder-switch-exercise"]');
  assert.equal(partnerButtonExists, false, "pairing an exercise with itself should be rejected, not create a degenerate superset");
});

test("ending a superset via toggleLadderMode resets the partner so the next ladder starts clean", async () => {
  const window = await bootApp();
  await window.addMovement("Test Reset Squat", "Squat");
  const squat = window.allMovements().find((m) => m.name === "Test Reset Squat");
  await window.addMovement("Test Reset Bench", "Press");
  const bench = window.allMovements().find((m) => m.name === "Test Reset Bench");

  await window.addMovement("Test Reset Squat", "Squat");
  window.toggleLadderMode();
  window.setLadderPartner(bench.id);
  window.applyFieldValue("step", "weight", 60);
  await window.saveSet();
  window.toggleLadderMode(); // finish

  // Starting a fresh ladder afterward must not still think a partner is set.
  window.toggleLadderMode();
  const partnerButtonExists = !!window.document.querySelector('[data-action="ladder-switch-exercise"]');
  assert.equal(partnerButtonExists, false, "a brand-new ladder should start as a plain single-exercise one");
});

test("blockLabel: set once per group via setLadderBlockLabel, carried by every round, preserved through reload", async () => {
  const window = await bootApp();
  await window.addMovement("Test Block A Squat", "Squat");
  const movement = window.allMovements().find((m) => m.name === "Test Block A Squat");
  window.toggleLadderMode();
  window.setLadderBlockLabel("A");
  window.applyFieldValue("step", "weight", 100);
  window.applyFieldValue("step", "reps", 5);
  await window.saveSet();
  window.applyFieldValue("step", "weight", 105);
  await window.saveSet();
  window.toggleLadderMode();

  const rounds = window.entriesFor(movement.id);
  assert.equal(rounds.length, 2);
  assert.ok(rounds.every((r) => r.blockLabel === "A"), "both rounds should carry the block label set for the group");

  await window.reloadFromDb();
  const afterReload = window.entriesFor(movement.id);
  assert.ok(afterReload.every((r) => r.blockLabel === "A"), "blockLabel should survive sanitizeEntry on reload");
});

test("setLadderBlockLabel(\"\") clears the label; an invalid label is ignored (stays null)", async () => {
  const window = await bootApp();
  await window.addMovement("Test Block Clear", "Squat");
  window.toggleLadderMode();
  window.setLadderBlockLabel("A");
  window.setLadderBlockLabel(""); // clear
  window.applyFieldValue("step", "weight", 50);
  await window.saveSet();
  assert.equal(window.currentLadderRounds()[0].blockLabel, null);

  window.setLadderBlockLabel("not-a-real-label");
  window.applyFieldValue("step", "weight", 55);
  await window.saveSet();
  assert.equal(window.currentLadderRounds()[1].blockLabel, null, "an out-of-whitelist label should be ignored, not stored raw");
});

test("editing one round of an active superset does not end it (mirrors the existing ladder-edit exception)", async () => {
  const window = await bootApp();
  await window.addMovement("Test Edit Superset Squat", "Squat");
  const squat = window.allMovements().find((m) => m.name === "Test Edit Superset Squat");
  await window.addMovement("Test Edit Superset Row", "Pull");
  const row = window.allMovements().find((m) => m.name === "Test Edit Superset Row");

  await window.addMovement("Test Edit Superset Squat", "Squat");
  window.toggleLadderMode();
  window.setLadderPartner(row.id);
  window.applyFieldValue("step", "weight", 80);
  window.applyFieldValue("step", "reps", 5);
  await window.saveSet();
  const [round1] = window.currentLadderRounds();

  await window.startEditEntry(round1.id);
  const isOn = () => window.document.querySelector("[data-action='toggle-ladder-mode']").textContent.includes("פעיל");
  assert.equal(isOn(), true, "editing the superset's own round should not end it");
  window.applyFieldValue("step", "weight", 82.5);
  await window.saveSet();
  assert.equal(window.currentLadderRounds().length, 1, "still one round, corrected in place");
  assert.equal(window.currentLadderRounds()[0].weight, 82.5);
});

test("the calendar day view groups a superset's rounds into one card spanning both exercise names", async () => {
  const window = await bootApp();
  await window.addMovement("Test Cal Superset Squat", "Squat");
  const squat = window.allMovements().find((m) => m.name === "Test Cal Superset Squat");
  await window.addMovement("Test Cal Superset Row", "Pull");
  const row = window.allMovements().find((m) => m.name === "Test Cal Superset Row");

  await window.addMovement("Test Cal Superset Squat", "Squat");
  window.toggleLadderMode();
  window.setLadderPartner(row.id);
  window.applyFieldValue("step", "weight", 80);
  window.applyFieldValue("step", "reps", 5);
  await window.saveSet();
  window.switchLadderExercise(row.id);
  window.applyFieldValue("step", "weight", 40);
  window.applyFieldValue("step", "reps", 10);
  await window.saveSet();
  window.toggleLadderMode();

  const dayEntries = [...window.entriesFor(squat.id), ...window.entriesFor(row.id)].sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const groups = window.groupDayEntries(dayEntries);
  assert.equal(groups.length, 1, "both exercises' rounds should fold into one group by shared groupId");
  assert.equal(groups[0].length, 2);
});

// Sub-task A: timed-hold entries (planks, dead hangs, farmer carries) in the
// strength Log tab. Duration entries share the same `entries` store as
// weight×reps sets, distinguished by a `type` field — see sanitizeEntry and
// saveSet() in app.js. Every test here drives the app through its own
// exposed functions, same as app-flow.test.mjs.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

test("sanitizeEntry: a well-formed duration entry round-trips with reps/est1RM zeroed out", async () => {
  const window = await bootApp();
  const out = window.sanitizeEntry({
    id: "e1", exerciseId: "m1", date: "2024-01-01",
    type: "duration", durationSeconds: 45, sets: 3, weight: 0,
  });
  assert.equal(out.type, "duration");
  assert.equal(out.durationSeconds, 45);
  assert.equal(out.sets, 3);
  assert.equal(out.reps, 0);
  assert.equal(out.est1RM, 0);
});

test("sanitizeEntry: a duration entry rejects a non-numeric durationSeconds and clamps out-of-range ones instead of rejecting them", async () => {
  const window = await bootApp();
  // Same rule as every other numeric field here (weight/reps/sets): only a
  // genuinely non-numeric value is rejected outright; an in-range-adjacent
  // number gets clamped, not dropped — 0 seconds clamps up to the 1-second
  // floor rather than losing the whole entry over a rounding-adjacent value.
  assert.equal(window.sanitizeEntry({ id: "e1", exerciseId: "m1", date: "2024-01-01", type: "duration", durationSeconds: "nope", sets: 1 }), null);
  const floored = window.sanitizeEntry({ id: "e1", exerciseId: "m1", date: "2024-01-01", type: "duration", durationSeconds: 0, sets: 1 });
  assert.equal(floored.durationSeconds, 1);
  const clamped = window.sanitizeEntry({ id: "e1", exerciseId: "m1", date: "2024-01-01", type: "duration", durationSeconds: 999999, sets: 1 });
  assert.ok(clamped.durationSeconds <= 3600, "should clamp to LIMITS.duration, not reject");
});

test("sanitizeEntry: a weighted hold (farmer carry) keeps its weight; an unweighted hold defaults to 0", async () => {
  const window = await bootApp();
  const weighted = window.sanitizeEntry({ id: "e1", exerciseId: "m1", date: "2024-01-01", type: "duration", durationSeconds: 30, sets: 2, weight: 24 });
  assert.equal(weighted.weight, 24);
  const bodyweight = window.sanitizeEntry({ id: "e2", exerciseId: "m1", date: "2024-01-01", type: "duration", durationSeconds: 30, sets: 2 });
  assert.equal(bodyweight.weight, 0);
});

test("sanitizeEntry: a record with no type field (pre-existing data) still sanitizes as a plain reps entry", async () => {
  const window = await bootApp();
  const out = window.sanitizeEntry({ id: "e1", exerciseId: "m1", date: "2024-01-01", weight: 60, reps: 5, sets: 3 });
  assert.equal(out.type, "reps");
  assert.equal(out.durationSeconds, 0);
});

test("saveSet() in duration mode persists a hold entry and est1RM/PR logic ignores it for the 1RM card", async () => {
  const window = await bootApp();
  await window.addMovement("Test Plank", "Other");
  const movement = window.allMovements().find((m) => m.name === "Test Plank");

  window.setLogEntryType("duration");
  window.applyFieldValue("step", "durationSeconds", 40);
  window.applyFieldValue("step", "sets", 3);
  await window.saveSet();

  const dbEntries = await window.dbLoadAll();
  const saved = dbEntries.find((e) => e.exerciseId === movement.id);
  assert.ok(saved, "the hold should be persisted");
  assert.equal(saved.type, "duration");
  assert.equal(saved.durationSeconds, 40);
  assert.equal(saved.sets, 3);
  assert.equal(saved.reps, 0);

  // A movement logged only as holds should report no 1RM (null, not 0) —
  // it never contributed a real weight/rep set.
  assert.equal(window.bestEst1RM(movement.id), null);
  assert.equal(window.bestDurationFor(movement.id), 40);
});

test("saveSet() in duration mode: a longer hold is a PR, a shorter one is not", async () => {
  const window = await bootApp();
  await window.addMovement("Test Dead Hang", "Pull");
  const movement = window.allMovements().find((m) => m.name === "Test Dead Hang");

  window.setLogEntryType("duration");
  window.applyFieldValue("step", "durationSeconds", 30);
  window.applyFieldValue("step", "sets", 1);
  await window.saveSet();
  let [entry] = window.entriesFor(movement.id);
  assert.equal(entry.isPR, true, "first hold ever logged is a PR");

  window.applyFieldValue("step", "durationSeconds", 25);
  await window.saveSet();
  const rows = window.entriesFor(movement.id);
  assert.equal(rows[0].durationSeconds, 25);
  assert.equal(rows[0].isPR, false, "a shorter hold than the existing best is not a PR");
  assert.equal(window.bestDurationFor(movement.id), 30, "the earlier, longer hold should remain the best");
});

test("selecting an exercise last logged as a hold defaults the toggle back to duration mode", async () => {
  const window = await bootApp();
  await window.addMovement("Test Hollow Hold", "Other");
  const hollow = window.allMovements().find((m) => m.name === "Test Hollow Hold");
  window.setLogEntryType("duration");
  window.applyFieldValue("step", "durationSeconds", 20);
  await window.saveSet();

  await window.addMovement("Test Switch Away Squat", "Squat"); // reps-mode movement

  // Re-select the hold movement by exact-name match (same branch addMovement
  // uses for an existing movement) and confirm the toggle followed its history.
  await window.addMovement("Test Hollow Hold", "Other");
  const durationBtn = window.document.querySelector('[data-action="set-log-entry-type"][data-type="duration"]');
  assert.equal(durationBtn.getAttribute("aria-checked"), "true", "duration toggle should be active for a hold-only exercise");

  await window.saveSet(); // sets/durationSeconds already reflect the prior hold's own value
  const rows = window.entriesFor(hollow.id);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, "duration");
});

test("switching entry type mid-ladder ends the ladder", async () => {
  const window = await bootApp();
  await window.addMovement("Test Ladder Type Switch", "Press");
  window.toggleLadderMode();
  window.applyFieldValue("step", "weight", 40);
  window.applyFieldValue("step", "reps", 8);
  await window.saveSet();
  assert.equal(window.currentLadderRounds().length, 1);

  window.setLogEntryType("duration");
  const isOn = () => window.document.querySelector("[data-action='toggle-ladder-mode']").textContent.includes("סולם פעיל");
  assert.equal(isOn(), false, "switching reps<->duration should end an active ladder, same as switching exercise does");
});

test("prefillFromLast() in duration mode pulls the last hold's duration, not reps", async () => {
  const window = await bootApp();
  await window.addMovement("Test Prefill Hold", "Other");
  const movement = window.allMovements().find((m) => m.name === "Test Prefill Hold");
  window.setLogEntryType("duration");
  window.applyFieldValue("step", "durationSeconds", 35);
  window.applyFieldValue("step", "sets", 2);
  await window.saveSet();

  window.applyFieldValue("step", "durationSeconds", 5); // simulate a fresh, unrelated stepper value
  window.prefillFromLast();
  const durVal = window.document.querySelector("[data-field='durationSeconds'].stepper-val").value;
  assert.equal(durVal, "35");

  const rows = window.entriesFor(movement.id);
  assert.equal(rows.length, 1, "prefill alone (before saving again) should not create a new row");
});

test("startEditEntry() on a duration entry restores duration mode and its value", async () => {
  const window = await bootApp();
  await window.addMovement("Test Edit Hold", "Other");
  const movement = window.allMovements().find((m) => m.name === "Test Edit Hold");
  window.setLogEntryType("duration");
  window.applyFieldValue("step", "durationSeconds", 50);
  await window.saveSet();
  const [entry] = window.entriesFor(movement.id);

  window.setLogEntryType("reps"); // simulate the toggle having moved on elsewhere
  await window.startEditEntry(entry.id);

  const durationBtn = window.document.querySelector('[data-action="set-log-entry-type"][data-type="duration"]');
  assert.equal(durationBtn.getAttribute("aria-checked"), "true", "editing a duration entry should restore duration mode");
  const durVal = window.document.querySelector("[data-field='durationSeconds'].stepper-val").value;
  assert.equal(durVal, "50");

  window.applyFieldValue("step", "durationSeconds", 55);
  await window.saveSet();
  const rows = window.entriesFor(movement.id);
  assert.equal(rows.length, 1, "editing should overwrite in place");
  assert.equal(rows[0].durationSeconds, 55);
});

// --- WOD builder: a movement's reps/weight fields never become structured
// data on the WOD (saveWod() only knows scoreType + generic score fields) —
// they're baked into a free-text desc. builderMovementsToDesc() is the pure
// function that does that baking; toggling a movement to duration mode
// should route it through formatDuration() instead of "N reps".
test("toggleBuilderMovement adds a movement with reps-mode defaults, and removes it on a second toggle", async () => {
  const window = await bootApp();
  window.openWodBuilder();
  window.toggleBuilderMovement("Plank Hold");
  assert.equal(window.builderMovementsToDesc({ "Plank Hold": { reps: 10, weight: 0, type: "reps", durationSeconds: 20 } }), "10 Plank Hold");

  window.toggleBuilderMovement("Plank Hold"); // remove
  window.toggleBuilderMovement("Wall Ball"); // add a fresh one
  assert.equal(window.builderMovementsToDesc({ "Wall Ball": { reps: 10, weight: 0, type: "reps", durationSeconds: 20 } }), "10 Wall Ball");
});

test("builderMovementsToDesc: a duration-mode movement renders as formatted time, not a rep count", async () => {
  const window = await bootApp();
  const desc = window.builderMovementsToDesc({
    "Plank Hold": { reps: 10, weight: 0, type: "duration", durationSeconds: 45 },
  });
  assert.equal(desc, '45" Plank Hold');
});

test("builderMovementsToDesc: a weighted duration movement (farmer carry) includes its weight", async () => {
  const window = await bootApp();
  const desc = window.builderMovementsToDesc({
    "Farmer Carry": { reps: 10, weight: 24, type: "duration", durationSeconds: 40 },
  });
  assert.equal(desc, '40" Farmer Carry @ 24kg');
});

test("builderMovementsToDesc: mixes reps-mode and duration-mode movements in one WOD", async () => {
  const window = await bootApp();
  const desc = window.builderMovementsToDesc({
    "Wall Ball": { reps: 15, weight: 9, type: "reps", durationSeconds: 20 },
    "Plank Hold": { reps: 10, weight: 0, type: "duration", durationSeconds: 60 },
  });
  assert.equal(desc, '15 Wall Ball @ 9kg, 1:00 Plank Hold');
});

test("setBuilderMovementType flips a checked movement's mode; applyFieldValue writes its durationSeconds", async () => {
  const window = await bootApp();
  window.openWodBuilder();
  window.toggleBuilderMovement("Hollow Rocks");
  window.setBuilderMovementType("Hollow Rocks", "duration");
  window.applyFieldValue("builder-movement-duration", "Hollow Rocks", 30);
  assert.equal(window.getFieldValue("builder-movement-duration", "Hollow Rocks"), 30);

  window.setBuilderMovementType("Hollow Rocks", "reps"); // flip back
  assert.equal(window.getFieldValue("builder-movement-reps", "Hollow Rocks"), 10, "reps value from before the switch should still be there");
});

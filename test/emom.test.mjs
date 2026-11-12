// Sub-task D: EMOM WODs with a rotating movement lineup, built through the
// WOD builder like any other named/reusable WOD (Fran, Grace, ...) rather
// than a one-off freeform entry. Unlike every other scoreType, an EMOM's
// movement rotation is structured data on the WOD record itself (see
// sanitizeCustomWod) because the log form needs it to render one reps field
// per movement — everything else in the builder only ever bakes into free
// text. Confirmed scope: no cross-attempt scoring yet (see bestWodScore).
import { test } from "node:test";
import assert from "node:assert";
import { bootApp, answerWodRx } from "./helpers/boot.mjs";

test("createWodFromBuilder (EMOM): movement rotation order follows selection order, targets carried from the builder steppers", async () => {
  const window = await bootApp();
  window.openWodBuilder();
  window.document.getElementById("wodBuilderName").value = "Test EMOM Rotation";
  // No separately exposed setter for builderFormat — drive it the same way
  // a real tap does, through the click dispatcher.
  window.document.querySelector("[data-action='builder-set-format'][data-format='emom']").click();
  window.toggleBuilderMovement("Wall Balls");
  window.toggleBuilderMovement("Burpees");
  window.applyFieldValue("builder-movement-reps", "Wall Balls", 12);
  window.applyFieldValue("builder-movement-reps", "Burpees", 8);
  window.applyFieldValue("builder-emom-minutes", "emomMinutes", 14);
  window.createWodFromBuilder();

  const wod = window.allWods().find((w) => w.name === "Test EMOM Rotation");
  assert.ok(wod, "the EMOM WOD should have been created");
  assert.equal(wod.scoreType, "emom");
  assert.equal(wod.emomMinutes, 14);
  assert.deepEqual(wod.emomMovements, ["Wall Balls", "Burpees"], "rotation order should match selection order");
  assert.deepEqual(wod.emomTargetReps, [12, 8]);
  assert.ok(wod.desc.includes("Wall Balls") && wod.desc.includes("Burpees"), "generated desc should mention both movements");
});

test("createWodFromBuilder (EMOM): refuses to create one with zero movements selected", async () => {
  const window = await bootApp();
  window.openWodBuilder();
  window.document.getElementById("wodBuilderName").value = "Test EMOM Empty";
  window.document.querySelector("[data-action='builder-set-format'][data-format='emom']")?.click();
  window.createWodFromBuilder();
  const wod = window.allWods().find((w) => w.name === "Test EMOM Empty");
  assert.equal(wod, undefined, "an EMOM with no movements in the rotation should not be created");
});

test("sanitizeCustomWod: rejects an EMOM WOD whose movement list sanitizes down to empty", async () => {
  const window = await bootApp();
  const out = window.sanitizeCustomWod({ id: "w1", name: "Bad EMOM", scoreType: "emom", emomMovements: ["", "   "], emomTargetReps: [5, 5], emomMinutes: 10 });
  assert.equal(out, null);
});

test("sanitizeCustomWod: a well-formed EMOM round-trips its structure, clamped and length-matched", async () => {
  const window = await bootApp();
  const out = window.sanitizeCustomWod({
    id: "w1", name: "Good EMOM", scoreType: "emom",
    emomMovements: ["Wall Balls", "Burpees"], emomTargetReps: [12], emomMinutes: 999999,
  });
  assert.deepEqual(out.emomMovements, ["Wall Balls", "Burpees"]);
  assert.deepEqual(out.emomTargetReps, [12, 0], "a shorter targets array should pad to match the movement count, not misalign");
  assert.ok(out.emomMinutes <= 999, "should clamp to LIMITS.minutes, not reject the whole WOD");
});

test("saveWod (EMOM): persists one rep count per movement, isPR always false, formatWodEntry shows per-movement reps", async () => {
  const window = await bootApp();
  await window.addCustomWod("Test EMOM Log", "emom", "EMOM 10: 12 Wall Balls / 8 Burpees", {
    emomMinutes: 10, emomMovements: ["Wall Balls", "Burpees"], emomTargetReps: [12, 8],
  });
  const wod = window.allWods().find((w) => w.name === "Test EMOM Log");
  // addCustomWod already selects the WOD it just created (selectedWodId),
  // same as addMovement does for a new movement — no separate step needed.

  window.applyFieldValue("wod-emom-step", "0", 12);
  window.applyFieldValue("wod-emom-step", "1", 6); // scaled down on burpees
  answerWodRx(window);
  await window.saveWod();

  const dbEntries = await window.dbLoadWodEntries();
  const saved = dbEntries.find((e) => e.wodId === wod.id);
  assert.ok(saved);
  assert.equal(saved.scoreType, "emom");
  assert.deepEqual(saved.emomReps, [12, 6]);
  assert.equal(saved.isPR, false, "EMOM has no cross-attempt scoring — never a PR");
  assert.equal(window.formatWodEntry(saved), "12 · 6");
});

test("bestWodScore/formatWodBest: an EMOM WOD reports no best (—), never a fabricated PR", async () => {
  const window = await bootApp();
  await window.addCustomWod("Test EMOM NoBest", "emom", "", { emomMinutes: 8, emomMovements: ["Wall Balls"], emomTargetReps: [15] });
  const wod = window.allWods().find((w) => w.name === "Test EMOM NoBest");
  window.applyFieldValue("wod-emom-step", "0", 15);
  answerWodRx(window);
  await window.saveWod();
  window.applyFieldValue("wod-emom-step", "0", 20); // "better" by any naive numeric read, still not a PR
  answerWodRx(window);
  await window.saveWod();

  assert.equal(window.bestWodScore(wod.id), null);
  assert.equal(window.formatWodBest(wod.id), "—");
  const entries = window.wodEntriesFor(wod.id);
  assert.ok(entries.every((e) => e.isPR === false), "neither attempt should be flagged as a PR");
});

test("startEditWodEntry (EMOM): restores the per-movement rep counts for editing", async () => {
  const window = await bootApp();
  await window.addCustomWod("Test EMOM Edit", "emom", "", { emomMinutes: 12, emomMovements: ["Wall Balls", "Burpees"], emomTargetReps: [12, 8] });
  const wod = window.allWods().find((w) => w.name === "Test EMOM Edit");
  window.applyFieldValue("wod-emom-step", "0", 10);
  window.applyFieldValue("wod-emom-step", "1", 7);
  answerWodRx(window);
  await window.saveWod();
  const [entry] = window.wodEntriesFor(wod.id);

  window.applyFieldValue("wod-emom-step", "0", 99); // dirty the state first
  await window.startEditWodEntry(entry.id);
  const val0 = window.document.querySelector("[data-field='0'][data-action='wod-emom-step'].stepper-val").value;
  const val1 = window.document.querySelector("[data-field='1'][data-action='wod-emom-step'].stepper-val").value;
  assert.equal(val0, "10");
  assert.equal(val1, "7");

  window.applyFieldValue("wod-emom-step", "0", 11);
  answerWodRx(window);
  await window.saveWod();
  const rows = window.wodEntriesFor(wod.id);
  assert.equal(rows.length, 1, "editing should overwrite in place");
  assert.deepEqual(rows[0].emomReps, [11, 7]);
});

test("renderWodLogSection resyncs wodEmomReps when switching to a differently-shaped EMOM WOD", async () => {
  const window = await bootApp();
  await window.addCustomWod("Test EMOM Shape A", "emom", "", { emomMinutes: 10, emomMovements: ["Wall Balls"], emomTargetReps: [15] });
  // addCustomWod already selects the WOD it just created — switching to the
  // WOD tab (a real click, same as a user tapping it) renders it.
  window.document.getElementById("tabWodBtn").click();
  const oneStepper = window.document.querySelectorAll("[data-action='wod-emom-step'].stepper-val").length;
  assert.equal(oneStepper, 1);

  // Creating (and thereby selecting) a second, differently-shaped EMOM WOD
  // re-renders through addCustomWod's own render() call — tab is already
  // "wod" from the click above, so this reflects the new selection.
  await window.addCustomWod("Test EMOM Shape B", "emom", "", { emomMinutes: 12, emomMovements: ["Burpees", "Box Jumps", "Wall Balls"], emomTargetReps: [10, 12, 15] });
  const threeSteppers = window.document.querySelectorAll("[data-action='wod-emom-step'].stepper-val").length;
  assert.equal(threeSteppers, 3, "switching to a 3-movement EMOM should resize the stepper set, not keep the old 1");
  const vals = [...window.document.querySelectorAll("[data-action='wod-emom-step'].stepper-val")].map((el) => el.value);
  assert.deepEqual(vals, ["10", "12", "15"], "should prefill from the new WOD's own target reps");
});

// Found by an independent UX review, not a user report: the weight
// stepper's floor in "reps" mode was hard-tied to barWeight (8/15/20kg)
// for every movement in the picker, including non-barbell ones sharing
// this same screen (weighted pull-ups/chin-ups/dips, dumbbell presses/
// rows, lat pulldown, leg press, ...). Typing a real light added weight
// for one of those got silently clamped up to the barbell floor with no
// error - the wrong number then landed in PR history, achievements, and
// charts. Fixed by adding an explicit barbell:false flag on MOVEMENTS
// entries that aren't loaded on a barbell, and gating the floor (and the
// barbell plates visual) on it.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

function pickMovement(window, id) {
  window.openPicker();
  window.document.querySelector(`[data-action="pick-movement"][data-id="${id}"]`).click();
}

function weightStepperMin(window) {
  return window.document.querySelector('.stepper-val[data-action="step"][data-field="weight"]').dataset.min;
}

test("a non-barbell movement's weight floor is 0, not tied to barWeight, and shows no barbell visual", async () => {
  const window = await bootApp();
  pickMovement(window, "weighted-dip");
  assert.equal(weightStepperMin(window), "0", "weighted dip is not a barbell lift - the floor must not be barWeight");
  assert.equal(window.document.getElementById("barbellVisual"), null, "no barbell plates should render for a non-barbell movement");
  assert.equal(window.document.getElementById("barWeightRow"), null, "no bar-weight selector should render for a non-barbell movement");
});

test("a real barbell movement keeps the barWeight floor and the plates visual", async () => {
  const window = await bootApp();
  pickMovement(window, "back-squat");
  assert.equal(weightStepperMin(window), "20", "back squat is a barbell lift - default bar weight is 20kg");
  assert.ok(window.document.getElementById("barbellVisual"), "the barbell plates visual should render for a barbell movement");
  assert.ok(window.document.getElementById("barWeightRow"), "the bar-weight selector should render for a barbell movement");
});

test("switching from a barbell movement to a non-barbell one live-updates the floor via updateLogQuickUI, not just on full render", async () => {
  const window = await bootApp();
  pickMovement(window, "back-squat");
  assert.equal(weightStepperMin(window), "20");
  pickMovement(window, "lat-pulldown");
  assert.equal(weightStepperMin(window), "0");
  // Nudging the (now-irrelevant) bar-weight setting must not resurrect the
  // barbell floor for a movement that was never loaded on a bar.
  const plusBtn = window.document.querySelector('.stepper-btn[data-action="step"][data-field="weight"][data-dir="1"]');
  plusBtn.click();
  assert.equal(weightStepperMin(window), "0");
});

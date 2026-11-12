// Bug fix, reported with two screenshots: tapping directly on a stepper's
// number (not the +/- buttons) reset it to 0 and stole focus before a
// keystroke could land, making it look like you couldn't type a number in
// at all. Root cause: the stepper's own <input> carries the same
// data-action as its +/- buttons (so the generic getFieldValue/setFieldState
// plumbing works for both), and the click dispatcher's "step" branch didn't
// distinguish between them — a click on the input itself fell into the same
// dir*step arithmetic as a real +/- tap, with el.dataset.dir undefined
// (NaN), which clampField() floored to the field's min. This affects the
// shared stepper mechanism, so it's not app-tab-specific — this test drives
// it through the EMOM builder screen from the report, but the fix
// (app.js: only el.classList.contains("stepper-btn") reaches the step
// arithmetic) is in the one shared click dispatcher branch every stepper
// in the app goes through.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

test("clicking a stepper's own input does not zero it or block typing (only the +/- buttons should step)", async () => {
  const window = await bootApp();
  await window.addMovement("Test Tap Type Squat", "Squat");

  const input = window.document.querySelector("[data-field='weight'].stepper-val");
  assert.equal(input.value, "20", "starts at the default weight");

  // Simulate a real tap: a click event on the input itself, same as the
  // click dispatcher receives from a real screen tap.
  input.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.notEqual(window.getFieldValue("step", "weight"), 0, "a tap on the number itself must never zero the underlying state");

  // The +/- buttons must still work exactly as before.
  const plusBtn = window.document.querySelector("[data-field='weight'][data-dir='1']");
  const before = window.getFieldValue("step", "weight");
  plusBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(window.getFieldValue("step", "weight"), before + 2.5, "the + button should still step by its configured amount");
});

test("the same fix applies to the EMOM builder's per-movement reps stepper (the screen from the report)", async () => {
  const window = await bootApp();
  window.openWodBuilder();
  window.document.querySelector("[data-action='builder-set-format'][data-format='emom']").click();
  window.toggleBuilderMovement("Wall Balls");

  const sel = "[data-action='builder-movement-reps'][data-field='Wall Balls'].stepper-val";
  const input = window.document.querySelector(sel);
  assert.equal(input.value, "10", "EMOM movements default to 10 reps per round");

  input.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const afterTap = window.getFieldValue("builder-movement-reps", "Wall Balls");
  assert.equal(afterTap, 10, "tapping the reps field itself must not reset the target reps to 0");
});

// Audit finding (accessibility): a separate, real bug from the two above —
// the document-level "focusin" handler used to set stepper-val.value = ""
// on every focus, visually wiping the field the instant you tabbed or
// tapped into it (before any click/step logic even ran). Fast retyping
// still works via select() (typing replaces the selection), but the value
// itself — and what a screen reader announces — is never destructively
// cleared just from focusing.
test("focusing a stepper input selects its value instead of clearing it", async () => {
  const window = await bootApp();
  await window.addMovement("Test Focus Select Squat", "Squat");

  const input = window.document.querySelector("[data-field='weight'].stepper-val");
  assert.equal(input.value, "20");

  input.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true }));
  assert.equal(input.value, "20", "focusing must never clear the visible value");
  assert.equal(input.selectionStart, 0, "the existing value should be selected...");
  assert.equal(input.selectionEnd, input.value.length, "...end to end, so typing still replaces it in one keystroke");
});

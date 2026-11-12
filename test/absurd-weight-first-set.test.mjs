// The absurd-weight guard's blind spot: a movement's FIRST set.
//
// saveSet() asks "are you sure?" when a set is >= 3x the athlete's own
// heaviest set of that exercise. That reference comes from
// heaviestLoggedWeightFor(), which returns 0 when the exercise has no
// history - and `reference > 0` then made the whole condition false. So the
// first set of every movement saved unquestioned, whatever it said.
//
// That is the set most worth questioning. It founds the record: every later
// PR, tier and celebration for that movement is measured against it, the
// first-log celebration fires on it, and the only way back is to find the
// entry and edit it. A slipped decimal on set one is permanent in a way the
// same typo on set fifty is not.
//
// The fix is a per-category ceiling used ONLY when there is no history to be
// proportional to, set far above anything anyone in this gym lifts rather
// than at what a member "should" - so it can never tell a real athlete their
// real number looks wrong. These tests hold both halves of that: it fires on
// the typo, and it stays quiet on every honest set, including a heavy one.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { bootApp, answerWodRx, waitFor } from "./helpers/boot.mjs";

function logSet(window, weight, reps = 1, sets = 1) {
  window.applyFieldValue("step", "weight", weight);
  window.applyFieldValue("step", "reps", reps);
  window.applyFieldValue("step", "sets", sets);
  return window.saveSet();
}

// The overlay element only exists in the DOM while a dialog is up - render()
// does not leave a closed one behind - so "no dialog" is a missing node, not
// a node without .open.
function confirmOverlay(window) {
  return window.document.getElementById("appConfirmOverlay");
}
function confirmIsOpen(window) {
  const el = confirmOverlay(window);
  return !!el && el.classList.contains("open");
}
function confirmText(window) {
  const el = confirmOverlay(window);
  return el ? el.textContent : "";
}

test("a movement's FIRST set at an absurd weight asks before saving - the case the multiple could not reach", async () => {
  const window = await bootApp();
  await window.addMovement("Test First Squat", "Squat");
  const mov = window.allMovements().find((m) => m.name === "Test First Squat");

  // 400 kg where 40 was meant. Nothing on file for this movement at all, so
  // before the ceiling existed this saved silently and celebrated.
  await logSet(window, 400, 3);

  assert.equal(confirmIsOpen(window), true, "the first set of a movement is questioned, not saved unseen");
  const overlay = confirmOverlay(window);
  assert.match(overlay.textContent, /400/, "the dialog names the number being questioned");
  assert.match(overlay.textContent, /הסט הראשון שלך/, "and says why it cannot compare - there is no previous set");
  assert.doesNotMatch(overlay.textContent, /הסט הכי כבד שלך/,
    "and never the comparison message, which here would claim a previous best of 0 ק״ג - a lie in the one place the app is asking to be trusted");
  assert.doesNotMatch(overlay.textContent, /(?<![0-9])0 ק״ג/, "no zero-kilo previous best anywhere in it");
  assert.equal(window.entriesFor(mov.id).length, 0, "and nothing is written while the question is open");

  // It is a confirmation, never a rejection: the number saves as typed.
  window.document.querySelector('[data-action="app-confirm-yes"]').click();
  // runAppConfirm() re-enters saveSet(), which awaits the real IndexedDB
  // write before the entry exists - one macrotask tick is not reliably
  // enough to see it.
  await waitFor(() => window.entriesFor(mov.id).length === 1, 3000);
  const entries = window.entriesFor(mov.id);
  assert.equal(entries.length, 1, "confirming saves the set");
  assert.equal(entries[0].weight, 400, "as typed, unrounded and unrejected - a real 400 kg lift is still a real 400 kg lift");
});

test("an honest heavy first set saves with no question at all", async () => {
  const window = await bootApp();
  await window.addMovement("Test Honest Squat", "Squat");
  const mov = window.allMovements().find((m) => m.name === "Test Honest Squat");

  // 180 kg is a real squat for a real member of this gym, and it is their
  // first logged set. The ceiling sits far above it on purpose: a guard that
  // interrupts an honest PR is worse than the typo it was built to catch.
  await logSet(window, 180, 3);

  assert.equal(confirmIsOpen(window), false, "no dialog for a believable first set");
  assert.equal(window.entriesFor(mov.id).length, 1, "it just saves");
  assert.equal(window.entriesFor(mov.id)[0].weight, 180);
});

test("the ceiling is per category: the same number is absurd for a press and ordinary for a deadlift", async () => {
  const window = await bootApp();

  await window.addMovement("Test Category Press", "Press");
  const press = window.allMovements().find((m) => m.name === "Test Category Press");
  await logSet(window, 220, 1);
  assert.equal(confirmIsOpen(window), true, "220 kg overhead, on a first set, is a question");
  assert.equal(window.entriesFor(press.id).length, 0);
  window.document.querySelector('[data-action="app-confirm-no"]').click();

  await window.addMovement("Test Category Deadlift", "Deadlift");
  const deadlift = window.allMovements().find((m) => m.name === "Test Category Deadlift");
  await logSet(window, 220, 1);
  assert.equal(confirmIsOpen(window), false, "the identical 220 kg off the floor is not");
  assert.equal(window.entriesFor(deadlift.id).length, 1, "and saves straight through");
});

test("once the athlete has one set on file, their own history takes over again - the ceiling stops applying", async () => {
  const window = await bootApp();
  await window.addMovement("Test History Squat", "Squat");
  const mov = window.allMovements().find((m) => m.name === "Test History Squat");

  await logSet(window, 200, 1);
  assert.equal(window.entriesFor(mov.id).length, 1, "a 200 kg first squat is below the ceiling and saves");

  // 400 is OVER the category ceiling and UNDER 3x this athlete's own best.
  // The proportional rule wins, exactly as designed: the absolute number is
  // a fallback for having no reference, never a second opinion about an
  // athlete who has one.
  await logSet(window, 400, 1);
  assert.equal(confirmIsOpen(window), false,
    "no dialog - 400 is less than 3x their own 200, and their own history is the better question");
  assert.equal(window.entriesFor(mov.id).length, 2);

  // And the proportional half still fires where it always did.
  await logSet(window, 1200, 1);
  assert.equal(confirmIsOpen(window), true, "3x their own best still asks");
  assert.match(confirmText(window), /הסט הכי כבד שלך/, "and with the comparison it can actually make");
});

test("a load WOD's first attempt gets the same guard, including the first Rx attempt at a WOD scaled many times", async () => {
  const window = await bootApp();
  await window.addCustomWod("Test Max Clean", "load", "");
  const wod = window.allWods().find((w) => w.name === "Test Max Clean");

  window.applyFieldValue("wod-step", "wodWeight", 400);
  answerWodRx(window, false);
  await window.saveWod();
  assert.equal(confirmIsOpen(window), true, "a first load-WOD attempt is questioned too");
  assert.match(confirmText(window), /התוצאה הראשונה שלך/, "naming the reason, not a previous best it does not have");
  assert.equal(window.wodEntriesFor(wod.id).length, 0, "nothing written while the question is open");
  window.document.querySelector('[data-action="app-confirm-yes"]').click();
  await waitFor(() => window.wodEntriesFor(wod.id).length === 1, 3000);
  assert.equal(window.wodEntriesFor(wod.id).length, 1, "confirming saves it as typed");

  // bestWodScore() is rx-scoped, so this member's FIRST Rx attempt has no
  // previous best either, however many scaled attempts sit behind it - the
  // half of this that is easy to miss.
  window.applyFieldValue("wod-step", "wodWeight", 500);
  answerWodRx(window, true);
  await window.saveWod();
  assert.equal(confirmIsOpen(window), true,
    "the first Rx attempt has no Rx best to be proportional to, so the ceiling is what stands between it and a typo");
  assert.match(confirmText(window), /התוצאה הראשונה שלך/);
  assert.equal(window.wodEntriesFor(wod.id).length, 1, "still just the scaled one");
});

// The table itself is a top-level `const`, which never attaches to the
// global object, so it is read out of the source and then checked against
// the live function - which also pins the two to each other.
function ceilingTable() {
  const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const m = src.match(/const FIRST_SET_WEIGHT_CEILING = \{([^}]+)\}/);
  assert.ok(m, "app.js must still declare FIRST_SET_WEIGHT_CEILING as one literal table");
  const table = {};
  for (const [, cat, kg] of m[1].matchAll(/(\w+):\s*(\d+)/g)) table[cat] = Number(kg);
  assert.ok(Object.keys(table).length >= 5, "and the table must still have a row per movement category");
  return table;
}

test("the ceiling table is prototype-safe and its unknown-category fallback is the most forgiving number in it", () => {
  return bootApp().then((window) => {
    const table = ceilingTable();
    const ceilings = Object.values(table);
    const max = Math.max(...ceilings);
    for (const [cat, kg] of Object.entries(table)) {
      assert.equal(window.firstSetWeightCeiling(cat), kg, `${cat} resolves to its own row, not the fallback`);
    }
    assert.equal(window.firstSetWeightCeiling(null), max,
      "no category means the lift could be any of them, so it gets the most forgiving ceiling - and that number is computed from the table, not restated beside it");
    assert.equal(window.firstSetWeightCeiling(undefined), max);
    assert.equal(window.firstSetWeightCeiling("Not A Category"), max);
    // catColor()'s own reasoning: a record whose category arrived through an
    // imported backup must never resolve to something off Object.prototype.
    assert.equal(window.firstSetWeightCeiling("__proto__"), max, "and a poisoned category is a number, not an object");
    assert.equal(window.firstSetWeightCeiling("toString"), max);
    assert.ok(ceilings.every((c) => typeof c === "number" && c >= 150),
      "every ceiling sits far above what anyone in this gym lifts - this guard may never interrupt an honest set");
  });
});

test("the predicate both save paths share: reference when there is one, ceiling when there is not", () => {
  return bootApp().then((window) => {
    const check = window.weightNeedsSanityCheck;
    assert.equal(check(400, 0, 300), true, "no reference: the ceiling decides");
    assert.equal(check(299, 0, 300), false, "and just under it is an ordinary set");
    assert.equal(check(400, 200, 300), false, "with a reference the ceiling is ignored - 400 is under 3x200");
    assert.equal(check(600, 200, 300), true, "and the multiple is what fires");
    // bestWodScore() returns null rather than 0 for a WOD with no scored
    // attempts, which is the value saveWod() hands in.
    assert.equal(check(400, null, 300), true, "a null reference is 'no history', not 'reference of zero'");
    assert.equal(check(0, 0, 300), false, "a zero-weight set (bodyweight work) is never absurd");
    assert.equal(check(NaN, 0, 300), false, "and a non-number is left to the form's own validation");
  });
});

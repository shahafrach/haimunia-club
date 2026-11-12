// The percentage chips on the log screen, behind club_features.strength_percentages.
//
// WHAT THIS IS. The app already showed percentages of a movement's estimated
// 1RM, in a collapsed table you read and then dialled in by hand. The chips
// are the same numbers as buttons that fill the weight stepper, carried down
// to 50%, rounded to a jump the member's own gym can actually load.
//
// THE THREE THINGS THIS FILE IS FOR, all of them ways the feature could ship
// broken in a way nobody would notice until a member complained:
//
//  1. ROUNDING. A percentage of an Epley estimate is a number like
//     110.86499999999999. Printed raw it is useless; rounded to the wrong
//     step it is a bar nobody can load. Every chip, at every increment, has
//     to be a real multiple - and a member who chose 1 kg must not be handed
//     2.5s.
//  2. NO 1RM. A movement with no logged sets has no estimate, and a
//     percentage of nothing is not 0 kg - it is nothing. The surface must be
//     absent, not empty, and not present with zeros in it.
//  3. THE KEY OFF. The row for this key is being added on another branch. So
//     the default with no row at all is the state nearly every member is in
//     right now, and it has to be "exactly what shipped before" - not a
//     half-rendered new surface, and not both surfaces at once.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

const FEATURE_KEY = "strength_percentages";
const CACHE_KEY = "haimunia:clubFeatures";

// A movement with real history, so bestEst1RM() has something to answer with.
async function movementWithHistory(window, name, weight = 100, reps = 5) {
  await window.addMovement(name, "Squat");
  const movement = window.allMovements().find((m) => m.name === name);
  window.applyFieldValue("step", "weight", weight);
  window.applyFieldValue("step", "reps", reps);
  window.applyFieldValue("step", "sets", 1);
  await window.saveSet();
  window.render();
  return movement;
}
const content = (window) => window.document.getElementById("content");
const chips = (window) => [...content(window).querySelectorAll('[data-action="set-weight-from-pct"]')];
const tableToggle = (window) => content(window).querySelector('[data-action="toggle-pct-table"]');
const incrementChips = (window) => [...content(window).querySelectorAll('[data-action="set-pct-increment"]')];

function turnKeyOn(window) {
  // The shape cloud.js's loadClubFeatures() actually hands over: the
  // { enabled, config } row club_features selects, not a bare boolean.
  // Always on in the training-log edition: there is no club switch to flip.
  window.render();
}

test("every chip, at every increment the member can choose, is a weight that can actually be loaded", async () => {
  const window = await bootApp();
  // 117.5 x 3 -> an estimate with a long decimal tail, which is the input
  // that catches naive rounding. 95% of it is 111.62499999999999.
  await movementWithHistory(window, "Test Pct Squat", 117.5, 3);
  turnKeyOn(window);

  for (const increment of [2.5, 2, 1]) {
    incrementChips(window).find((b) => b.dataset.inc === String(increment)).click();
    const rendered = chips(window);
    assert.equal(rendered.length, 10, "50 to 95 in steps of 5 is ten chips");
    assert.deepEqual(rendered.map((b) => Number(b.dataset.pct)), [95, 90, 85, 80, 75, 70, 65, 60, 55, 50],
      "descending, for the reason PCT_STEPS is descending - the heaviest is the one being planned around");

    for (const chip of rendered) {
      const loadKg = Number(chip.dataset.kg);
      assert.ok(loadKg > 0, `${chip.dataset.pct}% rendered ${chip.dataset.kg}, which is not a weight`);
      // The real assertion: an exact multiple of the chosen increment, with
      // no float dust. Scaled to integers because 0.1 + 0.2 is not 0.3.
      assert.equal(Math.round(loadKg * 100) % Math.round(increment * 100), 0,
        `at a ${increment} kg increment, ${chip.dataset.pct}% gave ${loadKg} - not a multiple of ${increment}`);
      // And it is the NEAREST one, not merely some multiple: a chip that
      // rounds 111.6 down to 100 is a multiple and still wrong.
      const est = window.bestEst1RM(window.allMovements().find((m) => m.name === "Test Pct Squat").id);
      const exact = est * Number(chip.dataset.pct) / 100;
      assert.ok(Math.abs(loadKg - exact) <= increment / 2 + 1e-9,
        `${chip.dataset.pct}% of ${est} is ${exact}; ${loadKg} is further than half an increment from it`);
    }
    // The chip's visible text has to carry the same number its tap applies -
    // a label and a data attribute drifting apart is a lie the member acts on.
    const first = rendered[0];
    assert.match(first.textContent, new RegExp(String(Number(first.dataset.kg)).replace(".", "\\.")),
      "the chip shows the load it fills in");
  }
});

test("tapping a chip fills the weight stepper with exactly that load", async () => {
  const window = await bootApp();
  await movementWithHistory(window, "Test Pct Press", 100, 5);
  turnKeyOn(window);

  const chip = chips(window).find((b) => b.dataset.pct === "70");
  const expected = Number(chip.dataset.kg);
  chip.click();

  assert.equal(window.getFieldValue("step", "weight"), expected,
    "reading a number off a list and dialling it in by hand is the ~22 stepper taps this feature exists to remove");
  const stepperInput = window.document.querySelector('.stepper-val[data-action="step"][data-field="weight"]');
  assert.equal(Number(stepperInput.value), expected, "and the field on screen agrees with the state");
});

test("the chosen increment is remembered on the device, not just in this render", async () => {
  const window = await bootApp();
  await movementWithHistory(window, "Test Pct Dead", 140, 3);
  turnKeyOn(window);

  incrementChips(window).find((b) => b.dataset.inc === "1").click();
  assert.equal(await window.dbGetSetting("haimunia:pctIncrement"), 1,
    "a member with microplates should not have to say so again tomorrow");
  const selected = incrementChips(window).filter((b) => b.getAttribute("aria-checked") === "true");
  assert.equal(selected.length, 1, "exactly one increment is selected");
  assert.equal(selected[0].dataset.inc, "1");
});

test("a movement with no 1RM shows NOTHING - not a surface full of zeros", async () => {
  const window = await bootApp();
  turnKeyOn(window);
  // A brand-new movement, selected by addMovement, with no sets logged.
  await window.addMovement("Test Pct Virgin", "Squat");
  const movement = window.allMovements().find((m) => m.name === "Test Pct Virgin");
  window.render();

  assert.equal(window.bestEst1RM(movement.id), null, "no logged sets means no estimate at all, not 0");
  assert.equal(chips(window).length, 0, "a percentage of nothing is nothing, not 0 kg");
  assert.equal(incrementChips(window).length, 0, "and no rounding control for numbers that do not exist");
  assert.equal(content(window).textContent.includes("משקלי עבודה"), false,
    "not even the heading - the surface is absent, not empty");
});

test("a hold has no 1RM to take a percentage of, so it gets no chips either", async () => {
  const window = await bootApp();
  await movementWithHistory(window, "Test Pct Hold Mov", 60, 5);
  turnKeyOn(window);
  assert.ok(chips(window).length > 0, "reps mode on a movement with history does show them");

  // Duration entries carry est1RM: 0 by construction (sanitizeEntry).
  window.setLogEntryType("duration");
  window.render();
  assert.equal(chips(window).length, 0, "a 90-second plank at 75% is not a thing");
});

test("the chips say what they are computed from, in the words the table uses", async () => {
  const window = await bootApp();
  const movement = await movementWithHistory(window, "Test Pct Honest", 100, 5);
  turnKeyOn(window);

  const text = content(window).textContent;
  const est = window.bestEst1RM(movement.id);
  assert.match(text, /הערכה מהסטים שרשמתם, לא מקס שנבדק/,
    "a member has to be able to tell an Epley estimate from a tested single before loading a bar to it");
  assert.ok(text.includes(String(est)), "and the estimate itself is named, not just referred to");
});

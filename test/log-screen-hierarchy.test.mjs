// The log screen's visual hierarchy.
//
// WHAT WAS WRONG. The first screen a member ever sees rendered as a striped
// accent bar, two flat cards that read as identical list items, two unstyled
// sentences floating in space, and then roughly 60% empty screen above the
// nav. Nothing on it looked like the primary action - and the primary action
// of the entire app is on it: `מה עשינו היום? / בחירת תרגיל`, without which
// no other control on the screen even renders.
//
// WHAT THIS FILE PINS, and deliberately not more. The visual craft itself
// (the tint, the striped spine, the dashed frame) is judged by eye against
// screenshots in both themes; a test that asserted a hex value would just be
// a second copy of the stylesheet. What is worth mechanically pinning is the
// three RULES that make the screen work, each of which is a one-line edit
// away from silently regressing:
//
//   1. Exactly one primary at a time. The picker is styled as the primary
//      only while nothing is chosen; once an exercise IS chosen the orange
//      save button at the bottom is the primary, and two energy-coloured
//      blocks competing for "press me" is worse than none.
//   2. The empty state is the app's four-slot pattern (d540a34), not a
//      sentence. Same shape as cloud.js's emptyStateHtml() so the member's
//      log screen and the coach dashboard read as one product.
//   3. The tour offer stays reachable, stays a 64px target and stays below
//      the picker - what changed is only how loud it is.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { bootApp } from "./helpers/boot.mjs";

const indexHtml = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

const pickAMovement = (window) => {
  window.document.querySelector('[data-action="open-picker"]').click();
  window.document.querySelector('[data-action="pick-movement"]').click();
};

// ---- 1. one primary at a time ---------------------------------------------

test("the exercise picker is styled as the screen's primary action while nothing is chosen", async () => {
  const window = await bootApp();
  window.document.getElementById("tabAddBtn").click();
  const picker = window.document.querySelector('[data-action="open-picker"]');
  assert.ok(picker.classList.contains("pick-hero"),
    "the app's primary action must not render as another flat row in a list of flat rows");
  // The class has to mean something, or it is decoration on a decoration.
  assert.match(indexHtml, /\.exercise-select\.pick-hero\{[^}]*--energy/,
    ".pick-hero must actually carry the energy accent");
  assert.match(indexHtml, /\.pick-hero::before\{[^}]*var\(--stripe\)/,
    "the hazard stripe is the app's own motif and is what makes this card recognisably this app's");
});

test("...and stops being the primary the moment one is, because the save button now is", async () => {
  const window = await bootApp();
  window.document.getElementById("tabAddBtn").click();
  pickAMovement(window);
  const picker = window.document.querySelector('[data-action="open-picker"]');
  assert.equal(picker.classList.contains("pick-hero"), false,
    "two energy-coloured blocks competing for the same tap is worse than none");
  assert.equal(window.document.getElementById("bottomBar").style.display, "flex",
    "sanity check: the save button - the real primary once an exercise is chosen - is showing");
});

test("the chosen row's first span is still the exercise name", async () => {
  // Not styling, but the constraint every restyle of this button has to
  // respect: several browser checks and unit tests read the chosen movement
  // off `.exercise-select span`, i.e. the FIRST span inside the button. An
  // eyebrow label or an icon span inserted ahead of it would break them all
  // at once, and would do it by returning a plausible wrong string rather
  // than by throwing.
  const window = await bootApp();
  window.document.getElementById("tabAddBtn").click();
  window.document.querySelector('[data-action="open-picker"]').click();
  const choice = window.document.querySelector('[data-action="pick-movement"]');
  const chosenName = window.movementById(choice.dataset.id).name;
  choice.click();

  const spans = [...window.document.querySelectorAll(".exercise-select span")];
  assert.equal(spans[0].textContent.trim(), chosenName,
    "the FIRST span in the picker button must still be the exercise name");
  assert.match(spans[1].textContent, /שינוי/, "and the change affordance must still follow it");
});

// ---- 2. the four-slot empty state ------------------------------------------

// Q-48 (owner, 2026-11-19): the four-slot empty card and the tour offer left this screen. The day's own list is
// the empty state now, and the tour lives in Settings > עזרה. See test/q48-log-screen.test.mjs.

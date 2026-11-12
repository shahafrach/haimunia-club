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

test("the log screen's empty state renders all four slots, the same way the coach dashboard's do", async () => {
  const window = await bootApp();
  window.document.getElementById("tabAddBtn").click();
  const el = window.document.querySelector('[data-empty-state="log-choose-exercise"]');
  assert.ok(el, "the pick-an-exercise prompt must be a real empty state, not a bare sentence in a void");

  // Slot 1: an icon, decorative, at the pattern's 28px.
  const icon = el.querySelector("svg");
  assert.ok(icon, "slot 1, an icon");
  assert.equal(icon.getAttribute("width"), "28", "the pattern's 28px");
  assert.equal(icon.closest("[aria-hidden]").getAttribute("aria-hidden"), "true",
    "the icon carries nothing the words do not - it must not be announced");

  // Slots 2 and 3: a headline and one line of explanation.
  const head = el.querySelector(".log-empty-head");
  const body = el.querySelector(".log-empty-body");
  assert.ok(head && head.textContent.trim().length > 0, "slot 2, a headline");
  assert.ok(body && body.textContent.trim().length > 0, "slot 3, an explanation");

  // Slot 4: this state has nothing to offer a button for - the action it
  // wants is the card directly above it - so it takes the when-line, and the
  // when-line is the whole point. An empty screen that says what is about to
  // appear on it reads as ready; one that says only "choose an exercise"
  // reads as broken, which is precisely what 60% of blank screen looked like.
  const when = el.querySelector(".log-empty-when");
  assert.ok(when && when.textContent.trim().length > 0, "slot 4, a when-line");
  assert.match(when.textContent, /יופיעו כאן/, "the when-line must name what will fill the space");
});

test("the empty-state headline names what will be here rather than what is missing", async () => {
  // Tone rule 1, the same one every empty state in cloud.js is held to:
  // אין / עדיין לא / מעולם לא may not OPEN a headline.
  const window = await bootApp();
  window.document.getElementById("tabAddBtn").click();
  const head = window.document.querySelector(".log-empty-head").textContent.trim();
  assert.ok(!/^(אין|עדיין לא|מעולם לא)\b/.test(head), `headline opens with a banned word: ${head}`);
});

test("the empty-state text block is width-bounded, so it does not lie adrift in the desktop column", () => {
  // The other half of the same finding cloud.js's emptyStateHtml() records:
  // centred text with no width bound is fine in a 390px phone column and
  // reads as a pane that failed to load in a 900px one.
  assert.match(indexHtml, /\.log-empty-text\{[^}]*max-width:34ch/);
  assert.match(indexHtml, /\.log-empty-when\{[^}]*max-width:34ch/);
});

test("the day's own empty log is quieter than the pick-an-exercise state, because on a first run both render at once", async () => {
  const window = await bootApp();
  window.document.getElementById("tabAddBtn").click();
  const content = window.document.getElementById("content");
  assert.ok(content.querySelector('[data-empty-state="log-choose-exercise"]'));
  const day = content.querySelector(".day-empty");
  assert.ok(day, "the day's log still says it is empty");
  assert.match(day.textContent, /עדיין לא נרשמו סטים היום/, "and says it in the same words as before");
  // They answer two different questions ("what goes in the card above" and
  // "what has been logged today"). Two identical blocks would read as the
  // screen having failed twice.
  assert.equal(day.querySelector(".log-empty-medal"), null, "the day strip does not repeat the big medallion");
});

// ---- 3. the tour offer, demoted but not hidden ------------------------------

test("the tour offer keeps its place, its copy and its 64px target, and loses only its three accents", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const logTab = window.renderLogTab();
  assert.match(logTab, /סיור קצר במסכים/, "it must stay reachable from the screen it was approved for");
  assert.ok(logTab.indexOf('data-action="open-picker"') < logTab.indexOf('data-action="open-onboarding"'),
    "still below the picker");
  assert.match(logTab, /class="exercise-row tour-offer"[^>]*min-height:64px/,
    "scripts/browser-check/first-run-sequence.mjs measures this target in a real browser");
  assert.doesNotMatch(logTab, /open-onboarding"[^>]*border-color:var\(--brass\)/,
    "a one-minute optional explainer does not get the brass accent on the same screen as the primary action");
  assert.match(indexHtml, /\.exercise-row\.tour-offer\{[^}]*box-shadow:none/);
});

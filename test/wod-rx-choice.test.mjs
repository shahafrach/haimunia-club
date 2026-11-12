// Design spec §3.6 — "Rx is the default and that is a data-integrity bug,
// not a copy bug."
//
// THE DEFECT. `let wodRx = true` meant every WOD form opened with Rx already
// selected. Rx means "as prescribed, at the full prescribed weights". A
// beginner is almost always scaled. So the app silently filed her session as
// harder than it was, into a history she cannot audit — because neither word
// appears anywhere in the product with a definition attached. It also fed
// every "Rx — <benchmark>" badge off the same false premise.
//
// THE FIX has three parts and all three are load-bearing: no default at all
// (a real third state, not a flipped guess), an explicit Hebrew-first glossed
// choice, and then remembering THAT MEMBER's answer for next time rather than
// substituting one global default for another.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

// Lands on אימונים › רישום with a real benchmark selected, which is where
// this toggle lives. Goes the long way round, through the benchmarks
// sub-tab, the way a member picking a named workout does.
async function openWodLogForm(window) {
  const d = window.document;
  d.getElementById("tabWodBtn").click();
  d.querySelector('[data-action="switch-wod-subtab"][data-subtab="benchmarks"]').click();
  d.querySelector('[data-action="select-benchmark"]').click();
  return d;
}
const toggle = (d) => d.querySelector(".rx-toggle");
const rxBtn = (d) => d.querySelector('[data-action="set-rx"][data-rx="1"]');
const scaledBtn = (d) => d.querySelector('[data-action="set-rx"][data-rx="0"]');
const saveBtn = (d) => d.getElementById("bottomBarBtn");

test("a first WOD opens with NEITHER option chosen — the app no longer guesses", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const d = await openWodLogForm(window);

  assert.ok(toggle(d), "the log form should be showing");
  assert.equal(rxBtn(d).getAttribute("aria-checked"), "false",
    "Rx pre-selected is what silently recorded a beginner's session as harder than it was");
  assert.equal(scaledBtn(d).getAttribute("aria-checked"), "false",
    "and pre-selecting Scaled instead would be the same bug pointing the other way");
  assert.ok(toggle(d).classList.contains("unset"),
    "the unmade choice must LOOK unmade — .rx-toggle.unset is the dashed frame index.html already ships for it");
});

test("both options are Hebrew-first, keep the English, and carry a permanent gloss", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const d = await openWodLogForm(window);

  // Hebrew first so the choice is readable; the English kept in parentheses
  // so Rx and Scaled stay learnable — the member meets both on the whiteboard
  // at the box, and an app that hides them leaves her unable to read it.
  assert.match(rxBtn(d).textContent, /מלא/);
  assert.match(rxBtn(d).textContent, /Rx/);
  assert.match(scaledBtn(d).textContent, /מותאם/);
  assert.match(scaledBtn(d).textContent, /Scaled/);

  // Tier-1 permanent inline gloss: the answer to "which one was I?" is on
  // screen, not behind a tap.
  assert.equal(rxBtn(d).querySelector(".term-sub").textContent.trim(), "בדיוק כפי שנכתב");
  assert.equal(scaledBtn(d).querySelector(".term-sub").textContent.trim(), "במשקלים שמתאימים לי");
  assert.match(d.getElementById("wodContent").textContent, /איך ביצעתם את האימון\?/,
    "two bare nouns are not a question; the heading asks it in words");
});

test("the save CTA is disabled, and says why, until the choice is made", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const d = await openWodLogForm(window);

  assert.equal(saveBtn(d).disabled, true);
  assert.equal(saveBtn(d).getAttribute("aria-disabled"), "true");
  assert.match(d.getElementById("wodContent").textContent, /בחרו איך ביצעתם את האימון/,
    "a disabled control with no stated reason is the anti-pattern this spec section is about");

  scaledBtn(d).click();
  assert.equal(saveBtn(d).disabled, false, "answering enables it");
  assert.equal(toggle(window.document).classList.contains("unset"), false, "and the dashed frame goes");
});

test("an unanswered WOD cannot be filed at all, even past the disabled button", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  await openWodLogForm(window);

  await window.saveWod();
  const stored = await window.dbLoadWodEntries();
  assert.equal(stored.length, 0,
    "saveWod() must refuse an unanswered form outright - the disabled CTA is the signpost, this is the gate");
  assert.equal(window.document.getElementById("celebrationOverlay").classList.contains("open"), false,
    "and nothing may be celebrated for a save that did not happen");
});

test("the member's own answer is remembered as their default for the next WOD", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  let d = await openWodLogForm(window);

  scaledBtn(d).click();
  assert.equal(scaledBtn(window.document).getAttribute("aria-checked"), "true");
  await window.saveWod();

  // The persisted half: this is THIS member's default now, not a global one.
  assert.equal(await window.dbGetSetting("haimunia:wodRxDefault"), false);

  // ...and it is what a fresh boot of the same profile starts from, so the
  // beginner is not re-asked forever and the competitor is not made to
  // re-pick Rx every session.
  await window.loadWodRxDefault();
  window.render();
  d = window.document;
  d.getElementById("tabWodBtn").click();
  d.querySelector('[data-action="switch-wod-subtab"][data-subtab="benchmarks"]').click();
  d.querySelector('[data-action="select-benchmark"]').click();
  assert.equal(scaledBtn(d).getAttribute("aria-checked"), "true",
    "remembered, and remembered as SCALED — not reset to the old global Rx");
  assert.equal(toggle(d).classList.contains("unset"), false);
});

test("what actually gets stored is the member's answer, and scaled inputs only appear once scaled is chosen", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const d = await openWodLogForm(window);

  // null is "unanswered", not "scaled": the scaled-weight inputs must not be
  // on screen before the question has been answered.
  assert.equal(d.getElementById("wodNotesInput"), null,
    "the scaled-only inputs must not render for an unanswered form");

  scaledBtn(d).click();
  assert.ok(window.document.getElementById("wodNotesInput"),
    "choosing scaled opens the 'what did you change' inputs");

  await window.saveWod();
  const stored = await window.dbLoadWodEntries();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].rx, false, "filed as the member said, not as the app assumed");
});

test("history never prints a bare Rx or Scaled at a member", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const d = await openWodLogForm(window);
  scaledBtn(d).click();
  await window.saveWod();
  window.closeCelebration(); // §1.2 S4's arrival card, this being the first entry

  // The words survive, glossed, on the control where the choice is made.
  // Everywhere the app REPORTS the choice back, Hebrew leads — a history row
  // reading a bare "Scaled" is the audit's complaint in miniature: the app
  // telling a member something about her own training in a word it never
  // defined for her.
  const wodTabText = window.document.getElementById("content").textContent;
  assert.match(wodTabText, /מותאם/, "the history surfaces name it in Hebrew");

  window.document.getElementById("tabCalendarBtn").click();
  const calText = window.document.getElementById("content").textContent;
  assert.match(calText, /מותאם \(Scaled\)/, "the calendar day view names it too");
  // THE RULE, stated as a rule rather than as a word-ban: the English may
  // appear, but never on its own - always immediately after the Hebrew that
  // explains it. A bare "Scaled" in a history row is the audit's complaint in
  // miniature, the app telling a member something about her own training in a
  // word it never defined for her. (Lookbehind, so this keeps holding if the
  // surrounding copy changes around the label.)
  assert.doesNotMatch(calText, /(?<!מותאם \()Scaled/,
    "every 'Scaled' must be led by its Hebrew; none may stand alone");
  assert.doesNotMatch(calText, /(?<!מלא \()Rx/,
    "and the same for 'Rx'");
});

test("the score-type card explains how the workout is measured, in Hebrew", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const d = await openWodLogForm(window);
  const text = d.getElementById("wodContent").textContent;

  // §3.6's last bullet. "סוג ניקוד: For Time" told a member the category of a
  // thing she had no definition for, in a language she may not read. The
  // heading now asks the question she actually has, the Hebrew answers it,
  // and the English stays in parentheses so it is still learnable.
  assert.match(text, /איך מודדים/);
  assert.match(text, /זמן \(For Time\)/);
  assert.doesNotMatch(text, /סוג ניקוד/);

  // And the gloss is the same sentence the WOD builder's format chips use,
  // so a member meets one explanation of a term, not two.
  assert.match(text, /כמה מהר סיימתם/);
});

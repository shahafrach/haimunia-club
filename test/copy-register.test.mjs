// Two copy findings left open by the five-persona UX audit, plus the
// same-class strings found next to them. All of these are one failure mode:
// a member-facing string that names an INTERNAL concept - how a developer
// thinks about the thing - instead of naming what the member is looking at.
//
// Finding 1 (design spec §4.4). The settings block above "delete all data"
// was headed `אזור מסוכן`, a literal calque of "danger zone", printed in
// var(--red-text). The beginner persona (49, comfortable with WhatsApp and
// online banking) read it as the app warning her that something was wrong
// with her PHONE. That is the exact inversion of the heading's purpose: it
// exists to slow her down before a destructive control, and instead it made
// a cautious member think the app was reporting a fault she had to deal
// with. A red warning printed before she has touched anything is
// indistinguishable from an error message.
//
// Finding 2 (design spec Appendix A.9). `בואו נתחיל להתאמן` in the desktop
// sidebar / nav card was the THIRD instance of `בואו נתחיל` in the app -
// and the odd one out, because the other two are primary BUTTONS
// (index.html's welcome sheet and onboarding explainer) while this one is
// the `.who-sub` status line directly under the member's name. A member
// with no current streak had their state reported to them as an imperative.
//
// These tests pin the replacements. No pre-existing test asserted on either
// old string, so nothing here supersedes an earlier assertion - the two
// source-level guards below exist so a revert cannot pass silently.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { bootApp } from "./helpers/boot.mjs";

const appJs = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const indexHtml = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

// Strip block comments before scanning for shipped strings: every fix below
// carries a comment that quotes the OLD copy as the reason it changed, and a
// naive grep over the raw file would match the explanation and call it a
// regression.
const appCode = appJs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/<!--[\s\S]*?-->/g, "");

// ===== FINDING 1 - the "danger zone" heading ==============================

test("the delete-data settings block is headed by what it does, not by the developer idiom 'danger zone'", async () => {
  const window = await bootApp();
  window.openSettings();
  const askBtn = window.document.querySelector('[data-action="ask-clear"]');
  assert.ok(askBtn, "Settings should render the delete-all-data trigger");

  const block = askBtn.closest(".settings-block");
  const title = block.querySelector(".settings-block-title");
  assert.equal(title.textContent.trim(), "מחיקת נתונים",
    "design spec §4.4: the heading must name what the section does");
  assert.ok(!block.textContent.includes("אזור מסוכן"),
    "'אזור מסוכן' is a calque of 'danger zone' and reads to a member as the app reporting a fault");
});

test("the red moves off the heading and stays on the destructive control itself", async () => {
  // The colour has to warn about an ACTION, not about the app. A red
  // section heading fires before the member has done anything, which is
  // what made the beginner persona read it as a fault report; the button
  // keeps .danger (pinned independently by test/audit-ux-fixes.test.mjs),
  // so nothing is lost from the actual warning.
  const window = await bootApp();
  window.openSettings();
  const block = window.document.querySelector('[data-action="ask-clear"]').closest(".settings-block");
  const title = block.querySelector(".settings-block-title");
  assert.ok(!/red/.test(title.getAttribute("style") || ""),
    "the section heading must not be printed in the error colour");
  assert.ok(block.querySelector('[data-action="ask-clear"]').classList.contains("danger"),
    "the destructive button keeps its own red weight");
});

test("the delete block says what gets deleted and that a backup downloads first", async () => {
  // Renaming the heading to a plain `מחיקת נתונים` removes the (wrong)
  // warning, so the block now has to carry the real information in the
  // register of the spec's four exemplars - it says what the thing is built
  // from. clearAllData() has auto-downloaded a backup since the audit and
  // never told anyone; that is the single most reassuring fact on this
  // screen for the persona who read this section as a threat.
  const window = await bootApp();
  window.openSettings();
  const text = window.document.querySelector('[data-action="ask-clear"]').closest(".settings-block").textContent;
  assert.ok(text.includes("יומן האימונים"), "must name the training log among what is deleted");
  assert.ok(text.includes("המכשיר הזה"), "must scope the deletion to this device");
  assert.ok(text.includes("קובץ גיבוי"), "must say a backup file downloads before the wipe");
});

test("the armed confirm names its subject instead of asking a bare 'delete everything?'", async () => {
  // app.js's own askAppConfirm comment sets this rule for every other
  // destructive action in the file: "no confirmation in the app names its
  // subject" was itself an audit finding. This one had not been brought in
  // line with it.
  const window = await bootApp();
  window.openSettings();
  window.document.querySelector('[data-action="ask-clear"]').click();
  const row = window.document.querySelector('[data-action="do-clear"]').closest("div");
  assert.ok(!row.textContent.includes("למחוק הכל?"),
    "the bare 'למחוק הכל?' names nothing");
  assert.ok(/למחוק את הכל מהמכשיר הזה\?/.test(row.textContent),
    "the confirm must say what is being deleted and from where");
});

// ===== FINDING 2 - the sidebar status line ================================

test("a member with no current streak has their STATE reported, not an instruction issued", async () => {
  const window = await bootApp();
  // A fresh boot has no entries, so computeCurrentStreak() is 0 - the
  // branch under test. The sidebar renders at every width (render() fills
  // #desktopSidebar unconditionally); CSS alone decides whether it is
  // visible, so the string is assertable here and was verified in Chromium
  // at 1280px, which is where a member actually meets it.
  const sub = window.document.querySelector("#desktopSidebar .who-sub");
  assert.ok(sub, "the desktop sidebar must render the .who card's status line");
  assert.equal(sub.textContent.trim(), "הרצף מתחיל באימון הבא",
    "the zero-streak sub-line must read as a fact about the member, not as a call to action");
});

test("the streak status line keeps the same shape in both of its branches", async () => {
  // The line it alternates with (`N ימים ברצף`) states what the streak IS.
  // The replacement states where it starts, so the two are the same kind of
  // sentence rather than one fact and one imperative - and it is true both
  // for someone who has never trained and for someone whose streak lapsed,
  // which "בואו נתחיל להתאמן" was not.
  const window = await bootApp();
  window.document.getElementById("tabAddBtn").click();
  window.document.querySelector('[data-action="open-picker"]').click();
  window.document.querySelector('[data-action="pick-movement"]').click();
  await window.saveSet();
  const sub = window.document.querySelector("#desktopSidebar .who-sub");
  assert.match(sub.textContent, /ברצף/, "with a live streak the line reports the streak itself");
  assert.ok(!sub.textContent.includes("נתחיל"), "and never falls back to the imperative");
});

test("'בואו נתחיל' is left to the two buttons that actually ask for a tap", () => {
  // Appendix A.9's point was collision, not wording: the same three words
  // meant three different things in three places. The two survivors are
  // both primary buttons in index.html (welcome sheet, onboarding
  // explainer) - genuine calls to action, and out of this task's scope.
  // app.js's only remaining use is the welcome sheet's own button label,
  // set from renderWelcome's save-label swap, i.e. the same button as
  // index.html:1548 rather than a fourth meaning.
  assert.ok(!appCode.includes("בואו נתחיל להתאמן"),
    "the status-line instance must be gone");
  const buttonInstances = (indexHtml.match(/בואו נתחיל/g) || []).length;
  assert.equal(buttonInstances, 2,
    "index.html keeps exactly the two button labels; a third would re-open the collision");
  assert.ok(!indexHtml.includes("הרצף מתחיל באימון הבא"),
    "and the replacement stays unique to app.js's status line - it must not become a button label too");
});

// ===== SAME CLASS, SAME SCREEN - the import counts ========================

test("the backup import counts the member's entries in the app's own word, not the database's", async () => {
  // `רשומות` is the Hebrew computing word for a database ROW. The member
  // never wrote a רשומה; they wrote a רישום - which is what this app calls
  // it everywhere else, including the name of the tab itself. Reached from
  // the same settings card ("ייבוא גיבוי") as finding 1, so it is the same
  // screen and the same class of failure.
  assert.ok(!appCode.includes("רשומות"),
    "no member-facing count may be measured in database rows");
  // Live bug hunt (2026-09-11): incoming/ok are now routed through
  // incomingLabel/an inline singular branch (count===1 reads "רישום אחד",
  // not "1 רישומים") - updated to match that shape, same underlying intent
  // (never "רשומות", always the member's own word).
  for (const expected of ["רישומים תקינים", "incomingLabel} לנתונים הקיימים", "incomingLabel}?", "רישום אחד"]) {
    assert.ok(appCode.includes(expected), `import copy should read "${expected}"`);
  }
});

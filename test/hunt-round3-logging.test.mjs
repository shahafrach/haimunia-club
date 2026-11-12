// Live bug hunt, fresh round 3 (2026-09-15) — the daily logging job.
//
// The thing members do several times a week, after training, on a phone. One
// of these silently corrupted a benchmark result; one re-fired a celebration
// for a typo correction; two were more counts of one.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const appJs = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("editing a WOD result never re-fires the personal-record celebration", () => {
  // HIGH. bestWodScore() excludes the row being edited from its own
  // comparison pool - correctly, for deciding whether the NEW value is a
  // record - so correcting a typo (59:00 down to a real 5:30) looked like a
  // brand-new PR and reopened the full-screen celebration.
  //
  // saveSet() has carried this exact guard, and a comment describing this
  // exact bug, since the strength side hit it first. The WOD side was never
  // given the same gate.
  const at = appJs.indexOf("async function saveWod");
  assert.ok(at > -1, "saveWod exists");
  const body = appJs.slice(at, at + 9000);
  assert.match(body, /const celebratePR = isPR && !existing;/,
    "an edit of an existing entry must not count as a new record");
  assert.match(body, /if \(celebratePR\) flashWodPR\(entry\.rx\);/, "the flash is gated");
  assert.match(body, /celebrateAfterSave\(celebratePR \?/, "and so is the full celebration");
  assert.ok(!/if \(isPR\) flashWodPR\(entry\.rx\);/.test(appJs),
    "the ungated flash must be gone");
  // The strength side's own guard must still be there - they are siblings and
  // should not drift apart again.
  assert.match(appJs, /const celebratePR = isPR && !existing && priorForExercise >= MIN_ENTRIES_BEFORE_PR;/,
    "saveSet keeps its own, stricter gate");
});

test("typing 75 seconds records 6:15, not 5:59", () => {
  // Silent data corruption. clampField() pinned seconds to 59 in STATE on
  // every keystroke while nothing wrote that back into the input until blur,
  // so the field showed "75" right up to save and the entry stored 5:59 - no
  // warning, no rejection, a benchmark time permanently wrong by up to
  // sixteen seconds. Writing "75 seconds" is a normal way to think for anyone
  // who counts intervals.
  const at = appJs.indexOf('if (field === "wodSeconds" && val >= 60)');
  assert.ok(at > -1, "seconds overflow is handled");
  const body = appJs.slice(at, at + 700);
  assert.match(body, /const carry = Math\.floor\(val \/ 60\);/, "whole minutes are carried");
  assert.match(body, /const secs = val % 60;/, "and the remainder kept");
  assert.match(body, /setFieldState\(action, "wodMinutes"/, "minutes are increased");
  assert.match(body, /cfg\.sync\("wodMinutes", wodMinutes\); cfg\.sync\("wodSeconds", wodSeconds\);/,
    "and BOTH inputs are written back, so what is shown is what will be saved");
  // Carried, not clamped: clamping visibly mid-keystroke would turn "7" then
  // "5" into "59" under the caret, which is its own defect.
  assert.ok(body.indexOf("return;") > -1, "the generic clamp is skipped for this case");
});

test("a ladder with one set does not say '1 סטים'", () => {
  // aria-live="polite", so a screen reader announced the wrong grammar too.
  // The sibling "ladder finished" toast already had the singular branch.
  assert.match(appJs, /rounds\.length === 1 \? "סט אחד נרשם" : `\$\{rounds\.length\} סטים נרשמו`/,
    "the live status line agrees with its own number");
  assert.ok(!/— \$\{rounds\.length\} סטים נרשמו/.test(appJs), "the raw plural must be gone");
});

test("a WOD done once does not say 'you did this 1 times'", () => {
  assert.match(appJs, /history\.length === 1 \? "פעם אחת" : `\$\{history\.length\} פעמים`/,
    "the repeat banner agrees with its own number");
  assert.ok(!/עשית את זה \$\{history\.length\} פעמים/.test(appJs), "the raw plural must be gone");
});

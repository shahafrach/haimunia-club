// Hebrew copy rules (2026-09-15), from the RTL-craft research pass.
//
// These are grammar and typography rules, not style preferences, and each one
// was a real defect in shipped copy when this file was written. They are
// asserted against the source rather than a rendered screen because the point
// is that the WRONG FORM never appears anywhere - a single missed string is a
// visible error to every Hebrew speaker who reads it.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { COMMUNITY_MODULES, cloudSource } from "./helpers/community-src.mjs";

// Every file the app's Hebrew copy lives in, INCLUDING src/community/*.js.
// These rules are about the language, not about a file: cloud.js is being
// split per feature, and a list that names it by hand would quietly stop
// covering whatever moved out of it — which for an RTL Hebrew app means the
// slash-gender and final-form rules silently stop being enforced on most of
// the community layer.
const files = ["app.js", "index.html", "privacy.html", ...COMMUNITY_MODULES].map((f) => ({
  name: f, src: fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"),
}));

// ---------------------------------------------------------------------------
// 1. Slash gender forms must keep the masculine final-form letter
// ---------------------------------------------------------------------------
// חבר/ה works because חבר is a complete word. משתתפ/ת does not: the masculine
// is משתתף, and dropping the final ף to graft on /ת leaves a non-word. This is
// a spelling error, not a compression convention.
test("no slash gender form drops the masculine final-form letter", () => {
  const wrong = ["משתתפ/ת", "מעוניינ/ת", "מפרסמ/ת", "הצטרפ/ה", "עודכנ/ה", "מנהלנ/ת", "רשומ/ה"];
  for (const { name, src } of files) {
    for (const w of wrong) {
      assert.ok(!src.includes(w),
        `${name} contains "${w}" - the masculine half must keep its final form (ף/ן/ם/ך), e.g. "משתתף/ת"`);
    }
  }
});

// ---------------------------------------------------------------------------
// 2. ברוך/ה cannot be written as a slash form at all
// ---------------------------------------------------------------------------
// Masculine ברוך, feminine ברוכה. The ך must BECOME כ, so no slash can join
// them - "ברוך/ה" is a non-word in both directions. It was the first string a
// new member ever read. Replaced by a 2nd-person construction rather than
// patched, because the patch (ברוכ/ה) is still wrong.
test("the impossible slash forms are absent", () => {
  for (const { name, src } of files) {
    // "אחד/ת" joined the list 2026-09-15. Same rule, new instance: the
    // feminine of אחד is the irregular אחת, so the ד must BECOME ת and no
    // slash can join them. It was introduced that day by a fix for a
    // DIFFERENT defect in the same string ("1 חברי מועדון" - a plural noun
    // beside the number one), which is worth recording: correcting number
    // agreement is exactly the kind of edit that reaches for a slash form,
    // and this list is what stops the correction from shipping its own bug.
    for (const w of ["ברוך/ה", "הבא/ה", "ברוכ/ה", "אחד/ת"]) {
      assert.ok(!src.includes(w), `${name} contains "${w}", which cannot be a valid slash form`);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Don't slash a verb that is already genderless
// ---------------------------------------------------------------------------
// In unvocalized Hebrew, 2nd-person past-tense verbs are homographs across
// gender: נרשמת, סומנת, הגעת, בחרת, שברת are each already both. Appending /ה
// does not make them more inclusive - it produces the THIRD-person feminine
// (נרשמה), which is a person mismatch. The slash makes correct copy wrong.
test("2nd-person past verbs carry no slash - they are already genderless", () => {
  const wrong = ["נרשמת/ה", "סומנת/ה", "הגעת/ה", "בחרת/ה", "שברת/ה", "סיימת/ה", "התחברת/ה"];
  for (const { name, src } of files) {
    for (const w of wrong) {
      assert.ok(!src.includes(w),
        `${name} contains "${w}" - 2nd-person past is already both genders; the slash yields 3rd-person feminine`);
    }
  }
});

// ---------------------------------------------------------------------------
// 4. Hebrew abbreviations take GERSHAYIM (U+05F4), never an ASCII quote
// ---------------------------------------------------------------------------
// Three independent reasons, all real:
//   * bidi: U+05F4 is bidi class R (strong RTL); U+0022 is a NEUTRAL, and a
//     neutral inside a Hebrew word adjacent to a number run is exactly what
//     strands during bidi resolution.
//   * escaping: esc() turns " into &quot;, which makes the bidi run-finder in
//     safe-helpers.js see a Latin word "quot" INSIDE a Hebrew word. That file
//     documents computing run boundaries pre-escape to route around this; the
//     gershayim removes the hazard instead of routing around it.
//   * CLDR agrees: Intl.NumberFormat("he-IL", {style:"unit", unit:"kilogram"})
//     emits ק״ג.
test("Hebrew abbreviations use gershayim, not an ASCII double quote", () => {
  for (const { name, src } of files) {
    for (const w of ['ק"ג', 'ס"מ', 'ד"ר', 'חו"ל']) {
      assert.ok(!src.includes(w),
        `${name} contains ${w} with an ASCII quote - use the gershayim ״ (U+05F4)`);
    }
  }
});


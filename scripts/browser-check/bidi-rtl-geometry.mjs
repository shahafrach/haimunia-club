#!/usr/bin/env node
// Bidi isolation, asserted the only way it can be: by measuring where the
// characters actually land.
//
// THE BUG. The app is `<html lang="he" dir="rtl">` end to end, and the
// training log is where mixed-script content is the norm rather than the
// exception - rep schemes ("21-15-9"), English movement names, weights
// ("43/30"), all typed into RTL Hebrew paragraphs. Interpolated bare, the
// Unicode bidirectional algorithm reorders those LTR runs against the
// paragraph and what is PAINTED stops matching what was typed. A coach's
//
//     21-15-9 Thrusters + Pull-ups. Rx 43/30 ק"ג.
//
// reached members with the rep scheme at the opposite end of the line; one
// audit persona read it as 9-15-21. That is why this is a safety bug and
// not a cosmetic one: not a garbled string a member notices and ignores,
// but a plausible, valid-looking, DIFFERENT workout they follow to the
// letter without ever knowing it is not the one that was written. Fixed in
// 3a85c76 (cloud.js, 46 sites) and d568aee (app.js) by wrapping each LINE
// in <bdi>.
//
// THE OTHER HALF, and why <bdi> per line could never have covered it. Those
// two commits fix an LTR-first line inside an RTL paragraph. The mirror case
// is a Hebrew-FIRST line — correctly RTL, that is not a defect, that is
// Hebrew — with a Latin/numeric run embedded in it. Wrapping the line does
// nothing there, because the line's own direction is already right; the
// isolate has to go around the RUN INSIDE the line. Measured here:
//
//     עשיתי 3×5 @ 60 היום        paints the formula as `60 @ 5×3`
//     האימון בשעה 7:30 - 8:30    paints the times as   `8:30 - 7:30`
//
// The second is the sharper one. A swapped rep scheme is at least strange to
// look at; a swapped pair of class times is a member showing up an hour late
// and never suspecting the screen. Both are fixed by the run-level isolation
// in bidiText(), and both are asserted below against a control that still
// reorders.
//
// WHAT THIS FILE DELIBERATELY DOES NOT ASSERT. `עם תווית בלוק (A/B/C/D)`
// was reported as painting `(D/C/B/A)`. It does not, and never did. Measured
// in Chromium and confirmed by screenshot: the bidi algorithm's own
// bracket-pair rule (N0) resolves both parentheses to the paragraph
// direction, mirroring (L4) swaps their glyphs, and a reader sees
// `(A/B/C/D)` exactly as typed. What `paintedText` returns for it —
// `)A/B/C/D(` — is the CODEPOINT at each position, and this file cannot see
// mirroring. So that string is asserted as a NO-REGRESSION case instead: the
// shipped output must paint identically to the pre-fix output, and an
// over-isolating build that swallows the parentheses must not. Writing it up
// as a bug fix would have been the same mistake in a new flavour as
// demanding the app force everything LTR.
//
// WHY THIS FILE HAS TO EXIST. Both commits were proven by hand, once, with
// per-character geometry in Chromium, and neither shipped a test. No unit
// test can replace it: the bidi algorithm never touches the DOM, so the
// text node still reads "21-15-9" in logical order while the screen shows
// something else. `textContent` is correct on the broken build. A unit test
// can at best assert that <bdi> appears at the render sites it already
// knows about, which is a restatement of the diff rather than a check on
// the behaviour, and says nothing at all about a NEW render site added
// later without it - which is precisely how this bug arrived the first
// time (<bdi> already existed in cloud.js, wrapping only @handle).
//
// EVERY ASSERTION HERE IS PAIRED WITH A CONTROL. A geometry check with no
// control is close to worthless - "painted order matches typed order" is
// also true of a string that would never have reordered, on a surface that
// was already LTR, in a container that never inherited dir=rtl. In all
// three cases it passes just as happily against the bug. So each check
// below also builds the PRE-FIX node (same text, no isolation) as a
// sibling of the real one, under identical inherited style, and requires
// it to reorder. If the control ever stops reordering, the sample has gone
// stale and the check is no longer proving anything - that is reported as
// a failure too, deliberately.
//
// Usage:
//   node bidi-rtl-geometry.mjs                 # local working tree
//   TARGET_URL=<url> node bidi-rtl-geometry.mjs # a deployed site
import { chromium } from "playwright";
import { resolveTarget } from "./lib/target.mjs";
import { switchTab, dismissWelcomeModal, dismissCelebrationIfOpen, selectBenchmarkWod, consoleErrorCollector } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";
import { paintedText, paintedTextOfUnisolatedControl, paintedTextOfHtmlSibling } from "./lib/geometry.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

// Asserts the pair: the shipped node paints as `expectedPainted`, and the
// pre-fix node built beside it does not.
//
// `typed` and `expectedPainted` are two different strings whenever the text
// contains Hebrew, and the difference is correct rather than a bug. Reading
// the screen left to right, an RTL sub-run inside an LTR line is encountered
// last character first: `ק"ג` is typed in that order and painted `ג"ק`. That
// is what a Hebrew reader sees and reads correctly, because they read that
// run right to left. The property under test is the ORDER OF THE RUNS - rep
// scheme, then movements, then weight, then unit - not the internal
// direction of each run, which the bidi algorithm is supposed to flip and
// which was never broken. Conflating the two is how an assertion here ends
// up demanding the app force everything LTR, which is the other bug.
//
// The control is built from `typed`, because that is what the pre-fix code
// interpolated.
async function checkIsolated(page, label, selector, { typed, expectedPainted }) {
  const real = await paintedText(page, selector);
  const control = await paintedTextOfUnisolatedControl(page, selector, typed);
  check(`${label}: the runs paint in the order they were typed`, real === expectedPainted, `painted "${real}", wanted "${expectedPainted}"`);
  check(
    `${label}: and the un-isolated control still reorders, so the check is load-bearing`,
    control !== expectedPainted,
    `control painted "${control}"${control === expectedPainted ? " — identical to the fixed node, so this sample no longer reproduces the bug and proves nothing" : ""}`,
  );
  return { real, control };
}

// The specific misreading the audit recorded: a member seeing 9-15-21 and
// doing a different, plausible, valid-looking workout. Asserted directly and
// by leftmost painted position rather than by string equality, so it stays
// meaningful even if the surrounding copy changes.
async function checkRepSchemeReadsForward(page, label, selector) {
  const painted = await paintedText(page, selector);
  check(
    `${label}: the rep scheme reads 21-15-9, not the valid-looking 9-15-21`,
    painted.includes("21-15-9") && !painted.includes("9-15-21"),
    painted,
  );
  check(
    `${label}: and it is painted at the start of the line, where it was typed`,
    painted.trimStart().startsWith("21-15-9"),
    painted,
  );
}

const target = await resolveTarget();
console.log(`Target: ${target.url}${target.local ? " (local static server)" : ""}`);

const browser = await chromium.launch();
// 390x844 he-IL: the viewport and locale the original geometry was measured
// at, so the reproduction is the reported one rather than a similar one.
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "he-IL" });
const errors = await consoleErrorCollector(page);

await installMockCloud(page);
await page.goto(target.url, { waitUntil: "networkidle" });
await page.waitForSelector("#app", { state: "visible" });
await dismissWelcomeModal(page);

// Sanity floor for everything below: if the surface under test were not
// actually RTL, no reordering could happen and every assertion in this file
// would be vacuous.
const pageRtl = await page.evaluate(() => getComputedStyle(document.documentElement).direction);
check("the page really is RTL, so bidi reordering is actually possible here", pageRtl === "rtl", pageRtl);

await switchTab(page, "tabWodBtn");
await page.waitForTimeout(200);
await selectBenchmarkWod(page, "fran");
await page.waitForSelector(".wod-desc", { timeout: 5000 });

// ---- 1. A built-in WOD description on the log screen ----
// Fran's own desc: an entirely LTR run (rep scheme + English movements)
// sitting in an RTL paragraph, which is the shape that inverts.
await checkIsolated(page, "a WOD description on the log screen", ".wod-desc", {
  typed: "21-15-9 Thrusters & Pull-ups",
  // No Hebrew in this one, so painted and typed order coincide.
  expectedPainted: "21-15-9 Thrusters & Pull-ups",
});
await checkRepSchemeReadsForward(page, "a WOD description on the log screen", ".wod-desc");

// The fix must isolate the run, NOT force the surface LTR - the same
// paragraph still has to lay out Hebrew correctly for every other string
// the app puts through it.
const descDir = await page.evaluate(() => getComputedStyle(document.querySelector(".wod-desc")).direction);
check("the description's own container stays rtl (the fix isolated, it did not flip the page)", descDir === "rtl", descDir);

// ---- 2. A member-typed note: the exact string from the report ----
// e.notes is free text a member types on their phone and is the field the
// audit actually caught this on. Logging it through the real form and
// reading it back off the history screen exercises the shipped path end to
// end rather than a fixture.
const REPORTED = '21-15-9 Thrusters + Pull-ups. Rx 43/30 ק"ג.';
// #wodNotesInput ("שינוי בתרגיל?") is rendered only on the Scaled branch —
// a note about how the workout was adapted only makes sense once it was.
await page.click("[data-action='set-rx'][data-rx='0']");
await page.waitForSelector("#wodNotesInput", { timeout: 5000 });
await page.fill("#wodNotesInput", REPORTED);
await page.dispatchEvent("#wodNotesInput", "input");
await page.fill("[data-field='wodMinutes'].stepper-val", "7");
await page.dispatchEvent("[data-field='wodMinutes'].stepper-val", "change");
await page.click("[data-action='save-wod']");
await page.waitForTimeout(300);
await dismissCelebrationIfOpen(page);

await switchTab(page, "tabCalendarBtn");
await page.waitForTimeout(250);
// The notes line under a logged WOD is the only node on this screen with
// that padding-inline-start, which keeps the selector off the sibling
// date/Rx spans that share its font-size.
const noteSel = "#calDetail div[style*='padding-inline-start:23px']";
const noteFound = await page.locator(noteSel).count();
check("the member-typed note reaches the calendar day view at all", noteFound > 0);
if (noteFound > 0) {
  await checkIsolated(page, "a member-typed mixed-script note", noteSel, {
    typed: REPORTED,
    // Character-for-character the AFTER line recorded in 3a85c76. The `ק"ג`
    // appears as `ג"ק` for the reason in checkIsolated's comment — it is one
    // RTL run, sitting where it was typed, at the end of the line beside the
    // 43/30 it belongs to rather than stranded 34 characters away from it.
    expectedPainted: '21-15-9 Thrusters + Pull-ups. Rx 43/30 ג"ק.',
  });
  await checkRepSchemeReadsForward(page, "a member-typed mixed-script note", noteSel);
}

// ---------------------------------------------------------------------------
// Sections 3-6 measure the RUN level. Every fragment below is built from the
// shipped helper's own output or from a deliberate mutant of it, and hung off
// a real rendered node so all of them are laid out under the same computed
// style, width and inherited direction.
// ---------------------------------------------------------------------------
const HOST = noteFound > 0 ? noteSel : "#calDetail .log-row";
// The very function the ~77 render sites call. Measuring its output is what
// makes the evidence here transfer to all of them; section 6 then proves the
// app is actually wired to it.
const shipped = (typed) => page.evaluate((t) => window.BoxLogSafe.bidiText(t), typed);
const escaped = (typed) => page.evaluate((t) => window.BoxLogSafe.esc(t), typed);
const paintedOf = (html) => paintedTextOfHtmlSibling(page, HOST, html);

check("the shared module exposes the isolation helper the render sites call", await page.evaluate(() => typeof window.BoxLogSafe?.bidiText === "function"));

// ---- 3. A Latin/numeric run embedded in a Hebrew line ----
// The line's own direction is already correct here — this is Hebrew, and
// Hebrew is RTL. What reorders is the run INSIDE it. Asserted by containment
// rather than whole-line equality so the check survives a re-word or a wrap.
async function checkRunReadsForward(label, typed, forward, scrambled) {
  const real = await paintedOf(await shipped(typed));
  const prefix = await paintedOf(`<bdi>${await escaped(typed)}</bdi>`);
  check(`${label}: the run paints "${forward}", the order it was typed`, real.includes(forward) && !real.includes(scrambled), `painted "${real}"`);
  check(
    `${label}: and the pre-fix line-only build still paints "${scrambled}", so the check is load-bearing`,
    prefix.includes(scrambled) && !prefix.includes(forward),
    `control painted "${prefix}"${prefix.includes(forward) ? " — identical order to the fixed node, so this sample no longer reproduces the bug and proves nothing" : ""}`,
  );
  return { real, prefix };
}

// A rep/weight formula. `×` and `@` are neutrals BETWEEN two numbers, and the
// bidi algorithm has European numbers act as R when it resolves the neutrals
// around them — so one formula becomes three number runs laid out right to
// left.
await checkRunReadsForward("a formula inside a Hebrew sentence", "עשיתי 3×5 @ 60 היום", "3×5 @ 60", "60 @ 5×3");

// The sharper one: a swapped rep scheme is at least odd to look at, a swapped
// pair of class times is a member arriving an hour late with nothing on screen
// to suggest it.
await checkRunReadsForward("a time range inside a Hebrew sentence", "האימון בשעה 7:30 - 8:30 בבוקר", "7:30 - 8:30", "8:30 - 7:30");

// The isolate had to go around the RUN, not the line. Forcing the whole line
// LTR — the obvious wrong fix, and the one that would wreck every Hebrew
// string in the app — does not even repair this case.
const forcedLine = await paintedOf(`<bdi dir="ltr" lang="en">${await escaped("עשיתי 3×5 @ 60 היום")}</bdi>`);
check(
  "forcing the whole LINE ltr does not fix it either — the isolate genuinely had to go around the run",
  forcedLine.includes("60 @ 5×3"),
  `forced-ltr line painted "${forcedLine}"`,
);

// ---- 4. The reported A/B/C/D case: a no-regression assertion, not a fix ----
// RELEASE_NOTES ships `עם תווית בלוק (A/B/C/D)`, reported as painting
// `(D/C/B/A)`. It does not. The bracket-pair rule already resolves both
// parentheses to the paragraph direction and mirroring swaps their glyphs, so
// a reader sees `(A/B/C/D)`. `paintedText` reports the CODEPOINT at each
// position and cannot see mirroring, which is why it returns `)A/B/C/D(` for
// a correctly painted line. The block labels themselves are what matters, and
// they were never reordered — so what is asserted is that the fix did not
// touch this, and that an over-isolating build would have.
const PAREN = "עם תווית בלוק (A/B/C/D)";
const parenReal = await paintedOf(await shipped(PAREN));
const parenPrefix = await paintedOf(`<bdi>${await escaped(PAREN)}</bdi>`);
const parenOver = await paintedOf(`<bdi>עם תווית בלוק <bdi dir="ltr" lang="en">(A/B/C/D)</bdi></bdi>`);
check("the block labels read A/B/C/D forward, not D/C/B/A", parenReal.includes("A/B/C/D") && !parenReal.includes("D/C/B/A"), `painted "${parenReal}"`);
check("the run-level fix left the parentheses to the paragraph: identical paint before and after", parenReal === parenPrefix, `after "${parenReal}" vs before "${parenPrefix}"`);
check(
  "and an over-isolating build that swallows the parentheses DOES move them, so that is a real assertion",
  parenOver !== parenReal,
  `over-isolated painted "${parenOver}"${parenOver === parenReal ? " — indistinguishable, so this check cannot catch over-isolation" : ""}`,
);

// ---- 5. The inverses: neither direction may be forced ----
// "Isolate everything" would satisfy every assertion above and break every
// Hebrew string in the app. These two are what make that impossible.

// 5a. An all-Hebrew line still resolves RTL.
//
// The sample carries sentence-final punctuation deliberately. The comma and
// the full stop are neutrals at the edge of the line, and they are the ONLY
// part of an all-Hebrew string whose painted position depends on the base
// direction: `היה קשה אבל סיימתי` with no punctuation paints identically
// whether it resolves RTL or is forced LTR, because a single RTL run reverses
// to the same place either way. Measured — the earlier sample here could not
// have caught a forced-LTR build at all, which is exactly the stale-control
// failure this file's header says to report rather than tolerate.
const HEBREW = "היה קשה, אבל סיימתי.";
const hebReal = await paintedOf(await shipped(HEBREW));
const hebForced = await paintedOf(`<bdi dir="ltr" lang="en">${await escaped(HEBREW)}</bdi>`);
// Painted left to right, an RTL-resolved Hebrew line reads as its own reverse.
check("a Hebrew-only line still resolves RTL (the fix isolates, it does not force LTR)", hebReal === [...HEBREW].reverse().join(""), `painted "${hebReal}"`);
check("it was not isolated at all: there is no LTR run in it to isolate", !(await shipped(HEBREW)).includes('dir="ltr"'));
check(
  "and a forced-LTR build of the same line paints differently, so the sample is not stale",
  hebForced !== hebReal,
  `forced-ltr painted "${hebForced}"${hebForced === hebReal ? " — identical, so this sample cannot detect a forced-LTR regression" : ""}`,
);

// 5b. A Latin-first line still resolves LTR, and the gate is what keeps it
// that way. <bdi> is dir="auto" and HTML's first-strong scan SKIPS characters
// inside an isolate, so run-isolating the leading `21-15-9 Thrusters…` would
// hide it from that scan and hand the line's base direction to the `ק"ג`
// further along — re-creating the exact bug 3a85c76 fixed.
const LTR_LINE = '21-15-9 Thrusters + Pull-ups. Rx 43/30 ק"ג.';
const ltrReal = await paintedOf(await shipped(LTR_LINE));
const ltrUngated = await paintedOf(`<bdi><bdi dir="ltr" lang="en">21-15-9 Thrusters + Pull-ups. Rx 43/30</bdi> ק&quot;ג.</bdi>`);
// NOTE for whoever revisits the line-level rule: this assertion is the thing
// that would break. cloud.js's bidiIsolateProse() (the outward share card)
// deliberately gives a sentence like `Rx 43/30 ק"ג. נשבר לי הראש` an RTL base
// instead of resolving first-strong, on the grounds that a sentence
// containing Hebrew is a Hebrew sentence. The DOM path does not, so the two
// surfaces currently disagree — see the matching notes on bidiText() in
// src/shared/safe-helpers.js and on bidiIsolateProse() in cloud.js. Adopting
// the card's rule here is a product decision that has to change this line
// too; it is not a latent bug in the check.
check("an LTR-first line still resolves LTR: the rep scheme is painted at the start of the line", ltrReal.trimStart().startsWith("21-15-9"), `painted "${ltrReal}"`);
check("the run-level fix deliberately left it alone — it is gated on the line resolving RTL", !(await shipped(LTR_LINE)).includes('dir="ltr"'));
check(
  "and removing that gate strands the unit at the far end of the line again, so the gate is load-bearing",
  !ltrUngated.trimStart().startsWith("21-15-9"),
  `un-gated painted "${ltrUngated}"${ltrUngated.trimStart().startsWith("21-15-9") ? " — no regression, so the gate is not actually doing anything" : ""}`,
);

// ---- 6. End to end: the app is wired to the promoted helper ----
// Everything above measures src/shared/safe-helpers.js. This drives a real
// app surface — the WOD history search's no-match line, which renders the
// member's own query through bidiText() — so a build where app.js still
// carries its private copy of the helper fails here rather than passing on
// the shared module's behaviour. The Fran entry logged in section 2 is what
// makes the search box render at all (it is gated on activeWods()).
const E2E_QUERY = "עשיתי 3×5 @ 60 היום";
await switchTab(page, "tabWodBtn");
await page.click("[data-action='switch-wod-subtab'][data-subtab='history']");
await page.waitForSelector("#wodHistorySearch", { timeout: 5000 });
await page.fill("#wodHistorySearch", E2E_QUERY);
await page.dispatchEvent("#wodHistorySearch", "input");
await page.waitForTimeout(200);
const emptySel = "#wodHistoryListArea div[style*='padding:20px 0']";
const emptyFound = await page.locator(emptySel).count();
check("the history search's no-match line renders at all", emptyFound > 0);
if (emptyFound > 0) {
  const e2ePainted = await paintedText(page, emptySel);
  const WIRING_HINT = "app.js must bind bidiText to the shared module (const bidiText = SAFE.bidiText) rather than keeping a local copy";
  check(
    "the app's OWN render path isolates the run: the query paints 3×5 @ 60, not 60 @ 5×3",
    e2ePainted.includes("3×5 @ 60") && !e2ePainted.includes("60 @ 5×3"),
    `painted "${e2ePainted}" — if this reads 60 @ 5×3, ${WIRING_HINT}`,
  );
  const e2eHtml = await page.evaluate((sel) => document.querySelector(sel).innerHTML, emptySel);
  check(
    "and it does so by emitting the shared helper's isolate, not a re-implementation of it",
    e2eHtml.includes('<bdi dir="ltr" lang="en">3×5 @ 60</bdi>'),
    `${e2eHtml} — ${WIRING_HINT}`,
  );
}

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\nbidi-rtl-geometry: FAILED" : "\nbidi-rtl-geometry: all checks passed");
process.exit(failed ? 1 : 0);

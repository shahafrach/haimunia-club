#!/usr/bin/env node
// THE CONTAINER-LEVEL HALF OF THE BIDI DEFECT, measured in a real engine.
//
// Reported from a phone, in the member's own words: progress rows showed
// weight and reps in broken RTL order - "90 1 × ק״ג" where "90 ק״ג × 1" was
// logged - and the estimate under a personal record read "משוער 90 ק״ג 1RM".
//
// THE CAUSE IS NOT THE STRING, IT IS THE BOX. index.html declares
//
//     .mono{ font-family:…; direction:ltr; unicode-bidi:isolate; }
//
// and that rule's own comment already says ".mono is not digits-only:
// entrySummary()/ladderRoundSummary() render strings like `100 ק״ג × 5`
// through it". direction:ltr STATES an LTR base direction for a phrase whose
// base is Hebrew, so the Unicode bidirectional algorithm lays the Hebrew unit
// out on the far side of the number it belongs to. Every numeric readout in
// the training log - the all-time-record headline, the 1RM estimate under it,
// the trend chip, bodyweight, body measurements, benchmark attempts, WOD
// results, the calendar's category volume row - goes through that class.
//
// WHY THIS FILE HAS TO EXIST AND `npm test` CANNOT COVER IT. The bidi
// algorithm never touches the DOM. After the engine has decided to paint
// "90 ק״ג × 1" as "ק״ג × 1 90", the text node still contains, in order, the
// characters that were logged. textContent is correct. innerHTML is correct.
// The class list is correct. jsdom has no layout engine at all, so there is
// no measurement it could take that would disagree. The only place the defect
// is visible is in painted geometry, which means Chromium.
//
// WHAT IS ASSERTED, and the shape is the house rule from
// bidi-rtl-geometry.mjs: every fixed node is measured AND a control is built
// beside it, in the same container, with the same computed style, carrying
// the pre-fix markup - and the control is required to read WRONG. Without
// that half, "the painted order matches the logged order" passes just as
// happily on a string that would never have reordered, and nobody finds out
// until a member reads a different number off their own training log.
//
// Usage:
//   node bidi-measurement-order.mjs                  # local working tree
//   TARGET_URL=<url> node bidi-measurement-order.mjs # a deployed site
import { chromium } from "playwright";
import { resolveTarget } from "./lib/target.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";
import {
  dismissWelcomeModal,
  selectMovement,
  dismissFirstLogArrival,
  dismissCelebrationIfOpen,
  switchTab,
  consoleErrorCollector,
} from "./lib/actions.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

const VIEWPORT = { width: 390, height: 844 };

// READING ORDER, BY TOKEN, and why not per character.
//
// lib/geometry.mjs's paintedText() answers "what does a person see, left to
// right". That is the right question for a rep scheme and the wrong one for a
// measurement: inside "90 ק״ג × 1" the digits are painted left-to-right and
// the Hebrew right-to-left, so a left-to-right character dump reports "09"
// and "ג״ק" and says nothing about whether the unit landed next to its
// number. What is actually broken here is the order of the RUNS.
//
// So: take the tokens the caller names, measure where each one is painted,
// and sort them right-to-left - the order a Hebrew reader takes them in. The
// result is directly comparable to the order they were written in.
async function tokenReadingOrder(page, selector, tokens) {
  return page.evaluate(({ sel, tokens }) => {
    const root = document.querySelector(sel);
    if (!root) throw new Error(`no element matches ${sel}`);
    // One flat list of (text node, offset) so a token may be looked up by its
    // index in the element's whole text, wherever the markup splits it.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let whole = "";
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push({ node: n, from: whole.length });
      whole += n.textContent;
    }
    const locate = (offset) => {
      for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i].from <= offset) return nodes[i];
      return null;
    };
    const placed = [];
    let searchFrom = 0;
    for (const t of tokens) {
      const at = whole.indexOf(t, searchFrom);
      if (at < 0) return { error: `token ${JSON.stringify(t)} is not in ${JSON.stringify(whole)}` };
      searchFrom = at + t.length;
      const startNode = locate(at);
      const endNode = locate(at + t.length - 1);
      if (!startNode || startNode !== endNode) return { error: `token ${JSON.stringify(t)} straddles two text nodes` };
      const range = document.createRange();
      range.setStart(startNode.node, at - startNode.from);
      range.setEnd(startNode.node, at + t.length - startNode.from);
      const r = range.getBoundingClientRect();
      if (!r.width) return { error: `token ${JSON.stringify(t)} has no painted width` };
      placed.push({ t, centre: r.left + r.width / 2 });
    }
    placed.sort((a, b) => b.centre - a.centre); // rightmost first = read first
    return { order: placed.map((p) => p.t), whole };
  }, { sel: selector, tokens });
}

// The control. Builds the PRE-FIX node - the same text, interpolated bare
// into the same `.mono` class, in the same parent - measures it the same way,
// and removes it again. Identical computed style, identical inherited
// direction, identical width: the only difference is the isolation.
async function controlReadingOrder(page, selector, text, tokens) {
  await page.evaluate(({ sel, text }) => {
    const ref = document.querySelector(sel);
    const probe = document.createElement("span");
    probe.id = "__bidiControlProbe";
    probe.className = "mono";
    probe.textContent = text;
    probe.style.display = "block";
    ref.parentNode.insertBefore(probe, ref);
  }, { sel: selector, text });
  const res = await tokenReadingOrder(page, "#__bidiControlProbe", tokens);
  await page.evaluate(() => document.getElementById("__bidiControlProbe")?.remove());
  return res;
}

// Both halves of one finding, for one node: the shipped markup reads in the
// order it was written, and the pre-fix markup in the same place does not.
async function checkPair(page, label, selector, text, tokens) {
  const live = await tokenReadingOrder(page, selector, tokens);
  if (live.error) return check(`${label}: measurable`, false, live.error);
  check(
    `${label}: painted right-to-left in the order it was written`,
    JSON.stringify(live.order) === JSON.stringify(tokens),
    `read ${JSON.stringify(live.order)} of ${JSON.stringify(live.whole.trim())}`,
  );
  const ctrl = await controlReadingOrder(page, selector, text, tokens);
  if (ctrl.error) return check(`${label}: control measurable`, false, ctrl.error);
  check(
    `${label}: CONTROL — the same text without bidiUnit() still reads wrong`,
    JSON.stringify(ctrl.order) !== JSON.stringify(tokens),
    `control read ${JSON.stringify(ctrl.order)}`,
  );
}

const isoDaysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

async function logSet(page, { date, weight, reps }) {
  await page.fill("#logDateInput", date);
  await page.dispatchEvent("#logDateInput", "change");
  await page.evaluate(({ weight, reps }) => {
    applyFieldValue("step", "weight", weight);
    applyFieldValue("step", "reps", reps);
  }, { weight, reps });
  await page.click("[data-action='save-set']");
  await page.waitForTimeout(300);
  await dismissFirstLogArrival(page);
  await dismissCelebrationIfOpen(page);
}

const target = await resolveTarget();
console.log(`Target: ${target.url}${target.local ? " (local static server)" : ""}`);
console.log(`Viewport: ${VIEWPORT.width}x${VIEWPORT.height}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, locale: "he-IL" });
// Keeps the anonymous usage count off the real endpoint (see lib/mockCloud.mjs).
await installMockCloud(page);
const errors = await consoleErrorCollector(page);
await page.goto(target.url, { waitUntil: "networkidle" });
await dismissWelcomeModal(page);

// One movement, two sets on two days, so every surface below has real data:
// a heaviest set, an estimate, a trend between two sessions, and a history
// row on the progress tab.
await selectMovement(page, "Back Squat");
await logSet(page, { date: isoDaysAgo(9), weight: 80, reps: 5 });
await logSet(page, { date: isoDaysAgo(2), weight: 90, reps: 1 });

console.log("\n---- the progress tab: the all-time-record row ----");
await switchTab(page, "tabHistoryBtn");
await page.waitForTimeout(400);
await page.click("[data-action='select-history'] >> nth=0");
await page.waitForTimeout(400);

// The headline is formatLiftedSet(): weight, unit, multiplier, reps.
const headline = await page.evaluate(() => {
  const els = [...document.querySelectorAll("#historyListArea .mono")];
  const el = els.find((e) => /ק״ג/.test(e.textContent));
  return el ? { sel: null, text: el.textContent.trim(), id: (el.id = "__headlineProbe") } : null;
});
check("a weight/reps readout is on the progress tab", !!headline, headline ? headline.text : "none found");
if (headline) {
  await checkPair(page, "record headline", "#__headlineProbe", "90 ק״ג × 1", ["90", "ק״ג", "×", "1"]);
}

// The estimate line under it: an LTR-first phrase whose base is still Hebrew.
// This is the one first-strong detection gets wrong, which is why bidiUnit()
// states the base instead of inferring it.
const estLine = await page.evaluate(() => {
  const el = [...document.querySelectorAll("#historyListArea .mono")].find((e) => /1RM משוער/.test(e.textContent));
  if (!el) return null;
  el.id = "__estProbe";
  return el.textContent.trim();
});
check("the 1RM estimate line is on the progress tab", !!estLine, estLine || "none found");
if (estLine) {
  // The estimate is Epley off the best set, so the number is read off the
  // rendered line rather than assumed - pinning "90" here would make this
  // check a test of the arithmetic instead of a test of the paint order.
  const estValue = (estLine.match(/[\d.]+/g) || []).filter((v) => v !== "1")[0];
  await checkPair(page, "1RM estimate", "#__estProbe", estLine, ["1RM", "משוער", estValue, "ק״ג"]);
}

console.log("\n---- the calendar tab: the category volume row ----");
await switchTab(page, "tabCalendarBtn");
await page.waitForTimeout(500);
const volume = await page.evaluate(() => {
  const el = [...document.querySelectorAll(".report-row .mono")].find((e) => /ימים/.test(e.textContent));
  if (!el) return null;
  el.id = "__volumeProbe";
  return el.textContent.trim();
});
check("the volume row names both windows", !!volume && /7/.test(volume) && /30/.test(volume), volume || "none found");
if (volume) {
  // Tokens that are each ONE directional run, read off the row itself.
  //
  // A multi-word token is not measurable here and it is worth saying why: a
  // Range spanning "2 ב-30 ימים" covers an LTR number and an RTL phrase, so
  // getBoundingClientRect() returns their UNION and its centre is an average
  // of two runs rather than a position. The count word ("סט אחד" / "3 סטים")
  // and the two window labels are each a single run, and the order of those
  // three is exactly what was reported broken: the counts and their windows
  // came out swapped.
  const weekCount = volume.split(" ב-7")[0];
  await checkPair(page, "volume counts", "#__volumeProbe", volume, [weekCount, "ב-7", "ב-30"]);
}

console.log("\n---- the same three shapes, in dark theme ----");
await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
await page.waitForTimeout(200);
if (volume) {
  const dark = await tokenReadingOrder(page, "#__volumeProbe", ["ב-7 ימים", "ב-30 ימים"]);
  check(
    "dark theme: the volume row still reads 7-day then 30-day",
    !dark.error && JSON.stringify(dark.order) === JSON.stringify(["ב-7 ימים", "ב-30 ימים"]),
    dark.error || JSON.stringify(dark.order),
  );
}
await switchTab(page, "tabHistoryBtn");
await page.waitForTimeout(400);
await page.click("[data-action='select-history'] >> nth=0");
await page.waitForTimeout(400);
const darkHeadline = await page.evaluate(() => {
  const el = [...document.querySelectorAll("#historyListArea .mono")].find((e) => /ק״ג/.test(e.textContent));
  if (!el) return null;
  el.id = "__headlineProbeDark";
  return el.textContent.trim();
});
if (darkHeadline) {
  const dark = await tokenReadingOrder(page, "#__headlineProbeDark", ["90", "ק״ג", "×", "1"]);
  check(
    "dark theme: the record headline still reads weight, unit, ×, reps",
    !dark.error && JSON.stringify(dark.order) === JSON.stringify(["90", "ק״ג", "×", "1"]),
    dark.error || JSON.stringify(dark.order),
  );
} else {
  check("dark theme: the record headline is measurable", false, "no readout found");
}
await page.evaluate(() => { delete document.documentElement.dataset.theme; });

console.log("\n---- the run rule is still enforced INSIDE the stated RTL base ----");
// bidiUnit() states an RTL base; that alone would paint "3×5 @ 60" as
// "60 @ 5×3", because the interior neutrals resolve to the base direction.
// The run isolation bidiText() already does is what stops it, and it has to
// keep working under the new wrapper. Asserted against the helper itself so
// the sample is exact, then measured.
const runProbe = await page.evaluate(() => {
  const host = document.createElement("div");
  host.id = "__runProbe";
  host.className = "mono";
  host.style.display = "block";
  host.innerHTML = window.BoxLogSafe.bidiUnit("3×5 @ 60");
  document.getElementById("content").appendChild(host);
  return host.innerHTML;
});
check(
  "bidiUnit() still isolates an interior-neutral Latin run",
  /<bdi dir="ltr" lang="en">3×5 @ 60<\/bdi>/.test(runProbe),
  runProbe,
);
const runOrder = await tokenReadingOrder(page, "#__runProbe", ["3", "×", "5", "@", "60"]);
check(
  "a rep scheme inside a measurement still paints left-to-right",
  // Read right-to-left, an LTR island comes back in reverse.
  !runOrder.error && JSON.stringify(runOrder.order) === JSON.stringify(["60", "@", "5", "×", "3"]),
  runOrder.error || JSON.stringify(runOrder.order),
);
await page.evaluate(() => document.getElementById("__runProbe")?.remove());

// And the other half of that rule: a signed number must NOT be isolated as a
// run, because forcing "+12" LTR inside the RTL base paints "12+ ק״ג".
const signProbe = await page.evaluate(() => window.BoxLogSafe.bidiUnit("+12 ק״ג"));
check(
  "bidiUnit() leaves a contiguous signed number alone",
  signProbe === '<bdi dir="rtl">+12 ק״ג</bdi>',
  signProbe,
);

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\nbidi-measurement-order: FAILED" : "\nbidi-measurement-order: all checks passed");
process.exit(failed ? 1 : 0);

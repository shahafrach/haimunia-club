#!/usr/bin/env node
// The two things this change puts on screen, measured in a real browser
// because jsdom has no layout and npm test therefore cannot see either of
// them: the percentage chip row on the log screen, and the effort toggle
// now that it holds THREE options instead of two.
//
// WHY A BROWSER IS THE ONLY PLACE THIS CAN BE CHECKED. Both risks are
// geometric:
//
//  - THE EFFORT TOGGLE. .rx-toggle is a flex row and .rx-btn is flex:1. A
//    third chip divides the same row three ways, and "מותאם (Scaled)" plus
//    its gloss does not fit ~110px at 15px. The fix is flex-wrap plus a
//    min-width, and the thing that must hold is the one design spec §3.6
//    fought for: every option a >=44px target, none of them clipped, and the
//    row not wider than the screen. A wrapped row is fine; an overflowing
//    one is not.
//  - THE CHIP ROW. Ten chips at 50-95% wrap into a .flex.wrap, each one a
//    tap target that fills the weight stepper. Same two questions: >=44px,
//    and no horizontal overflow of the page.
//
// It also drives the chips for real (tap 70%, watch the stepper follow), so
// this is a behavioural check as well as a measurement.
import { chromium } from "playwright";
import { resolveLocalOnlyTarget } from "./lib/target.mjs";
import { consoleErrorCollector, dismissWelcomeModal, dismissFirstLogArrival, dismissCelebrationIfOpen,
  selectMovement, selectBenchmarkWod, switchTab } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

const target = await resolveLocalOnlyTarget();
console.log(`Target: ${target.url} (local static server, mocked backend)`);

const browser = await chromium.launch();
// 360px: the narrowest phone width the club actually sees, and the width at
// which three chips in one row stopped fitting.
const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
const errors = await consoleErrorCollector(page);

await installMockCloud(page);
await page.goto(target.url);
await dismissWelcomeModal(page, "בדיקה");

// ---- 1. The effort toggle, with three options, at 360px ------------------
await switchTab(page, "tabWodBtn");
await selectBenchmarkWod(page, "fran");
await page.waitForSelector(".rx-toggle .rx-btn");

const toggle = await page.evaluate(() => {
  const row = document.querySelector(".rx-toggle");
  const btns = [...row.querySelectorAll(".rx-btn")];
  return {
    count: btns.length,
    rowWidth: Math.round(row.getBoundingClientRect().width),
    docWidth: document.documentElement.clientWidth,
    btns: btns.map((b) => {
      const r = b.getBoundingClientRect();
      const label = b.childNodes[0].textContent.trim();
      return {
        rx: b.dataset.rx, label,
        w: Math.round(r.width), h: Math.round(r.height),
        right: Math.round(r.right), left: Math.round(r.left),
        // The label's own intrinsic width against the box it was given:
        // a clipped or mid-word-broken option is the failure mode here.
        clipped: b.scrollWidth > b.clientWidth + 1,
      };
    }),
  };
});
check("the toggle offers all three answers", toggle.count === 3,
  toggle.btns.map((b) => `${b.rx}="${b.label}"`).join(" "));
check("every option is still a >=44px tap target (design spec 3.6's own floor)",
  toggle.btns.every((b) => b.h >= 44 && b.w >= 44),
  toggle.btns.map((b) => `${b.rx}:${b.w}x${b.h}`).join(" "));
check("no option's label is clipped by its own chip",
  toggle.btns.every((b) => !b.clipped),
  toggle.btns.map((b) => `${b.rx}:scroll>client=${b.clipped}`).join(" "));
check("the toggle row fits the viewport rather than overflowing it",
  toggle.rowWidth <= toggle.docWidth
    && toggle.btns.every((b) => b.left >= -1 && b.right <= toggle.docWidth + 1),
  `row=${toggle.rowWidth} doc=${toggle.docWidth} rights=${toggle.btns.map((b) => b.right).join(",")}`);

// Rx+ selects only itself - the handler used to compare dataset.rx to "1",
// which filed every other chip, Rx+ included, as Scaled.
await page.click('[data-action="set-rx"][data-rx="plus"]');
const chosen = await page.evaluate(() => [...document.querySelectorAll('[data-action="set-rx"]')]
  .map((b) => `${b.dataset.rx}:${b.getAttribute("aria-checked")}`).join(" "));
check("choosing Rx+ checks Rx+ and nothing else", chosen === "1:false 0:false plus:true", chosen);
const ctaEnabled = await page.evaluate(() => {
  const btn = document.getElementById("bottomBarBtn");
  return !btn.disabled && btn.getAttribute("aria-disabled") === "false";
});
check("and it answers the question, so the save CTA unlocks", ctaEnabled);

// ---- 2. The percentage chips, behind the club key ------------------------
await switchTab(page, "tabAddBtn");
await selectMovement(page, "Back Squat");
// A logged set gives bestEst1RM() something to answer with; without one
// there is no estimate and, by design, no percentage surface at all.
await page.evaluate(() => {
  window.applyFieldValue("step", "weight", 100);
  window.applyFieldValue("step", "reps", 5);
  window.applyFieldValue("step", "sets", 1);
});
await page.click('[data-action="save-set"]');
await dismissFirstLogArrival(page);
await dismissCelebrationIfOpen(page);

// The training-log edition has no club switchboard: the chips are simply on.
await page.waitForSelector('[data-action="set-weight-from-pct"]');

const chipRow = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('[data-action="set-weight-from-pct"]')];
  const docWidth = document.documentElement.clientWidth;
  return {
    count: btns.length,
    docWidth,
    scrollWidth: document.documentElement.scrollWidth,
    table: !!document.querySelector('[data-action="toggle-pct-table"]'),
    boxes: btns.map((b) => {
      const r = b.getBoundingClientRect();
      return { pct: b.dataset.pct, kg: b.dataset.kg, w: Math.round(r.width), h: Math.round(r.height),
        left: Math.round(r.left), right: Math.round(r.right) };
    }),
  };
});
check("ten chips, 50 to 95 in fives", chipRow.count === 10,
  chipRow.boxes.map((b) => `${b.pct}%=${b.kg}`).join(" "));
check("the table is gone - never two percentage surfaces on one screen", chipRow.table === false);
check("every chip is a >=44px tap target",
  chipRow.boxes.every((b) => b.h >= 44 && b.w >= 44),
  chipRow.boxes.map((b) => `${b.pct}:${b.w}x${b.h}`).join(" "));
check("the chips wrap inside the viewport instead of scrolling the page sideways",
  chipRow.scrollWidth <= chipRow.docWidth
    && chipRow.boxes.every((b) => b.left >= -1 && b.right <= chipRow.docWidth + 1),
  `scrollWidth=${chipRow.scrollWidth} doc=${chipRow.docWidth}`);

// The increment control, and the numbers changing with it.
const at25 = chipRow.boxes.map((b) => Number(b.kg));
await page.click('[data-action="set-pct-increment"][data-inc="1"]');
await page.waitForFunction(() => {
  const b = document.querySelector('[data-action="set-pct-increment"][data-inc="1"]');
  return b && b.getAttribute("aria-checked") === "true";
});
const at1 = await page.evaluate(() => [...document.querySelectorAll('[data-action="set-weight-from-pct"]')]
  .map((b) => Number(b.dataset.kg)));
check("at a 2.5 kg increment every chip is a 2.5 multiple", at25.every((kg) => Math.round(kg * 10) % 25 === 0), at25.join(","));
check("at a 1 kg increment every chip is a whole kilo", at1.every((kg) => Number.isInteger(kg)), at1.join(","));
check("and the two are not the same numbers (the setting actually does something)",
  at1.some((kg, i) => kg !== at25[i]));

// Tapping one fills the weight stepper, which is the entire point.
const tapped = await page.evaluate(async () => {
  const chip = document.querySelector('[data-action="set-weight-from-pct"][data-pct="70"]');
  const want = Number(chip.dataset.kg);
  chip.click();
  await new Promise((r) => setTimeout(r, 50));
  const field = document.querySelector('.stepper-val[data-action="step"][data-field="weight"]');
  return { want, got: Number(field.value) };
});
check("tapping 70% loads the weight stepper with that weight",
  tapped.want === tapped.got, `chip=${tapped.want} stepper=${tapped.got}`);

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\nstrength-pct-and-rx-plus: FAILED" : "\nstrength-pct-and-rx-plus: all checks passed");
process.exit(failed ? 1 : 0);

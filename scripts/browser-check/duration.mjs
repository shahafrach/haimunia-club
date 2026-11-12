#!/usr/bin/env node
// Sub-task A: timed-hold entries in the strength Log tab. Drives the actual
// reps/duration toggle, the duration stepper, the History tab's duration
// chart, and the calendar day view's duration formatting — none of this is
// reachable from jsdom (no real layout/CSS, and the point here is mostly
// "does the UI actually show the right controls"), so it's covered here
// instead of (or in addition to) the node:test suite.
//
// Usage:
//   node duration.mjs                 # local working tree
//   TARGET_URL=<url> node duration.mjs # a deployed site
import { chromium } from "playwright";
import { resolveTarget } from "./lib/target.mjs";
import { switchTab, dismissWelcomeModal, selectMovement, dismissCelebrationIfOpen, consoleErrorCollector } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

const target = await resolveTarget();
console.log(`Target: ${target.url}${target.local ? " (local static server)" : ""}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
const errors = await consoleErrorCollector(page);

// COMM-333: cloud.js boots unconditionally regardless of which tab a
// script visits, and cloud-config.js points at the real, live production
// Supabase project - without this, an offline-only check like this one
// still fires real network calls (session restore, anonymous sign-in via
// the auto-backup bootstrap, etc.) against production in the background,
// which is both a safety risk (see lib/mockCloud.mjs's own comment) and
// the source of intermittent 401/409 console errors this suite saw.
await installMockCloud(page);
await page.goto(target.url, { waitUntil: "networkidle" });
await page.waitForSelector("#app", { state: "visible" });
await dismissWelcomeModal(page);

// COMM-360: nothing is pre-selected on a fresh load anymore - pick Back
// Squat explicitly first. It's a barbell movement, so the check below is
// on the reps/duration toggle itself, not a movement-specific quirk —
// Weighted Plank below is `barbell: false` and never shows the barbell
// visual in either mode, which would make that check pass for the wrong
// reason.
await selectMovement(page, "Back Squat");
const barbellVisibleBefore = await page.evaluate(() => !!document.getElementById("barbellVisual"));
check("reps mode shows the barbell visual for a barbell movement", barbellVisibleBefore);

await page.click("[data-action='set-log-entry-type'][data-type='duration']");
await page.waitForTimeout(150);

const barbellGone = await page.evaluate(() => !document.getElementById("barbellVisual"));
check("switching to duration mode removes the barbell visual", barbellGone);
const durationStepperShown = await page.evaluate(() => !!document.querySelector("[data-field='durationSeconds'].stepper-val"));
check("duration mode shows a duration stepper", durationStepperShown);
const repsStepperGone = await page.evaluate(() => !document.querySelector("[data-field='reps'].stepper-val"));
check("duration mode hides the reps stepper", repsStepperGone);

await selectMovement(page, "Weighted Plank");
const exerciseName = (await page.textContent(".exercise-select span")).trim();
check("selected the intended exercise", exerciseName.includes("Weighted Plank"), `got "${exerciseName}"`);
// Picking a fresh exercise resets entry type from its own history (none
// yet), not from the previous exercise's mode — switch back to duration
// explicitly for the save/history/calendar checks below.
await page.click("[data-action='set-log-entry-type'][data-type='duration']");
await page.waitForTimeout(150);

await page.fill("[data-field='durationSeconds'].stepper-val", "40");
await page.dispatchEvent("[data-field='durationSeconds'].stepper-val", "change");
await page.fill("[data-field='sets'].stepper-val", "3");
await page.dispatchEvent("[data-field='sets'].stepper-val", "change");
await page.click("[data-action='save-set']");
await page.waitForTimeout(300);
await dismissCelebrationIfOpen(page);

const footerText = await page.evaluate(() => document.querySelector("[data-action='view-log-date-calendar']")?.textContent || "");
check('day footer shows the hold as 3×40"', footerText.includes('3×40"'), footerText.trim());

// A shorter second hold should not flash a PR.
await page.fill("[data-field='durationSeconds'].stepper-val", "25");
await page.dispatchEvent("[data-field='durationSeconds'].stepper-val", "change");
await page.click("[data-action='save-set']");
await page.waitForTimeout(300);
const celebratedOnShorterHold = await dismissCelebrationIfOpen(page);
check("a shorter hold than the existing best does not celebrate a PR", !celebratedOnShorterHold);

// THREE DAYS, because the chart needs three points to be a chart. Both saves
// above landed on today and the series is bestPerDay(), so this exercise had
// one point - and below the trend threshold renderChart() now draws a compact
// readout rather than a 174px plot area with a single dot in it (a real-phone
// report; see renderCompactChart in app.js). Without these two extra days
// "there is no SVG" would be true of a duration exercise and of a barbell one
// alike, and the duration-vs-reps distinction this file exists to pin would
// pass vacuously. Both are SHORTER than the 40" best, so neither celebrates.
for (const [daysBack, seconds] of [[2, 30], [4, 20]]) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  await page.fill("#logDateInput", d.toISOString().slice(0, 10));
  await page.dispatchEvent("#logDateInput", "change");
  await page.fill("[data-field='durationSeconds'].stepper-val", String(seconds));
  await page.dispatchEvent("[data-field='durationSeconds'].stepper-val", "change");
  await page.click("[data-action='save-set']");
  await page.waitForTimeout(300);
  await dismissCelebrationIfOpen(page);
}

// History tab: duration-mode chart renders (an SVG, not the reps rep-table).
await switchTab(page, "tabHistoryBtn");
await page.waitForTimeout(200);
await page.click(`.exercise-row[data-action='select-history']:has-text("Weighted Plank")`);
await page.waitForTimeout(200);
const historyHasSvg = await page.evaluate(() => !!document.querySelector(".chart-card svg"));
const historyHasBestHold = (await page.evaluate(() => document.querySelector(".chart-card")?.textContent || "")).includes("שיא החזקה");
check("History tab renders a chart for the duration exercise", historyHasSvg);
check("History tab shows a best-hold stat instead of the rep-record grid", historyHasBestHold);

// Calendar day view: both rounds show with duration formatting, not "0×0".
await switchTab(page, "tabCalendarBtn");
await page.waitForTimeout(200);
const calText = await page.evaluate(() => document.getElementById("calDetail")?.textContent || "");
check('calendar day view formats the hold entries as seconds (25") not reps', calText.includes('25"'), calText.replace(/\s+/g, " ").trim());

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\nduration: FAILED" : "\nduration: all checks passed");
process.exit(failed ? 1 : 0);

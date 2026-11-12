#!/usr/bin/env node
// The progress chart runs right-to-left, asserted on painted pixels.
//
// THE BUG (8afbc57). renderChart() placed point i at `padX + i * step`:
// oldest at the left edge, newest at the right, inside a page that is
// `dir="rtl"` from <html> down. A Hebrew reader starts at the RIGHT, so
// they read the line newest-to-oldest, and a member whose lifts had been
// climbing for six weeks saw a line falling away in front of them. Every
// progress chart in the app meant the opposite of what its data said, for
// its entire audience. A design review caught it; not one persona did,
// which is the point — a chart that is upside down is not visibly broken,
// it is just wrong, and it is wrong about the single thing a member opens
// the history tab to find out.
//
// The fix mirrors x (`w - padX - i * step`), mirrors the date labels'
// rotation and anchor with it, and flips the wide-chart scroll box to
// dir="ltr" so it still opens on the newest end.
//
// WHY THIS FILE HAS TO EXIST. Nothing asserts any of it. There are two
// chart test files — test/wod-history-chart.test.mjs and
// test/chart-accessible-name.test.mjs — and neither looks at x at all; the
// second deliberately covers the aria-label, which is the one part of the
// chart that carries no direction. The commit message records the
// measurement that proved the fix ("oldest 01.09 sits at cx=276 and newest
// 07.09 at cx=24") and that measurement was taken by hand, once. Reverting
// the mirror today breaks no test in the repo.
//
// This is measured in Chromium rather than asserted on cx attributes,
// because cx is not where the point lands: the SVG is scaled by its
// viewBox against a percentage width, and the wide variant sits in a
// horizontally scrolling box with its own direction. Painted rects are the
// thing a member's eye actually receives.
//
// Usage:
//   node chart-rtl-orientation.mjs                 # local working tree
//   TARGET_URL=<url> node chart-rtl-orientation.mjs # a deployed site
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "he-IL" });
const errors = await consoleErrorCollector(page);

await installMockCloud(page);
await page.goto(target.url, { waitUntil: "networkidle" });
await page.waitForSelector("#app", { state: "visible" });
await dismissWelcomeModal(page);

const htmlDir = await page.evaluate(() => getComputedStyle(document.documentElement).direction);
check("the app really is RTL, which is the entire premise of this check", htmlDir === "rtl", htmlDir);

await selectMovement(page, "Strict");

// Four sessions on four consecutive days, strictly ascending. Ascending is
// load-bearing: on a flat series a mirrored chart and an un-mirrored one
// are the same picture, and every assertion below would hold either way.
// Logged through the real form, including #logDateInput, so this exercises
// the shipped path rather than a fixture pushed into IndexedDB.
const today = new Date();
const session = [];
for (let i = 3; i >= 0; i--) {
  const d = new Date(today);
  d.setDate(today.getDate() - i);
  session.push({ date: d.toISOString().slice(0, 10), weight: 60 + (3 - i) * 5 });
}
for (const { date, weight } of session) {
  await page.fill("#logDateInput", date);
  await page.dispatchEvent("#logDateInput", "change");
  await page.fill("[data-field='weight'].stepper-val", String(weight));
  await page.dispatchEvent("[data-field='weight'].stepper-val", "change");
  await page.fill("[data-field='reps'].stepper-val", "5");
  await page.dispatchEvent("[data-field='reps'].stepper-val", "change");
  await page.click("[data-action='save-set']");
  await page.waitForTimeout(300);
  await dismissCelebrationIfOpen(page);
}

// The history tab opens on a list of exercises; the chart belongs to one of
// them and appears once it is picked.
await switchTab(page, "tabHistoryBtn");
await page.waitForTimeout(300);
await page.click(`.exercise-row[data-action='select-history']:has-text("Strict Press")`);
await page.waitForTimeout(300);
await page.waitForSelector(".chart-card svg circle", { timeout: 5000 });

// renderChart() emits its circles in data order — oldest first — so the
// first and last circles are the two ends of the series.
const plot = await page.evaluate(() => {
  const card = document.querySelector(".chart-card");
  // The card holds more than one <svg> — the trend arrow beside the "+5.8
  // ק"ג" headline is one too. The plot is the one with data points in it.
  const svg = [...card.querySelectorAll("svg")].find((s) => s.querySelector("circle"));
  if (!svg) return { n: 0, points: [], labels: [], note: "" };
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const texts = [...svg.querySelectorAll("text")];
  return {
    n: svg.querySelectorAll("circle").length,
    points: [...svg.querySelectorAll("circle")].map(box),
    labels: texts.map((t) => t.textContent),
    labelPoints: texts.map(box),
    note: (card.textContent || "").replace(/\s+/g, " ").trim(),
  };
});

check("the chart plotted all four sessions", plot.n === 4, String(plot.n));

if (plot.n === 4) {
  const oldest = plot.points[0];
  const newest = plot.points[plot.n - 1];

  // The fix, stated as the thing a reader experiences.
  check(
    "the OLDEST session is painted on the right and the NEWEST on the left",
    oldest.x > newest.x,
    `oldest x=${Math.round(oldest.x)}, newest x=${Math.round(newest.x)}`,
  );
  // Not just the two ends: every step of the series has to march leftwards,
  // or the middle of the chart still reads backwards.
  const marchesLeft = plot.points.every((p, i) => i === 0 || p.x < plot.points[i - 1].x);
  check("and every point in between marches leftwards, so the whole line reads right-to-left", marchesLeft, JSON.stringify(plot.points.map((p) => Math.round(p.x))));

  // The meaning: read the way this page is read, the improving series must
  // climb. Screen y grows downwards, so higher on screen is a smaller y.
  const climbsWhenReadRTL = plot.points.every((p, i) => i === 0 || p.y < plot.points[i - 1].y);
  check(
    "an improving series therefore RISES when read right-to-left, instead of appearing to fall",
    climbsWhenReadRTL,
    JSON.stringify(plot.points.map((p) => Math.round(p.y))),
  );

  // The control, in the same spirit as the other geometry checks here: the
  // sample has to be capable of showing the bug. If the series were flat,
  // or a single point, "it rises right-to-left" would be true of the
  // un-mirrored chart too and this file would be proving nothing.
  const ySpread = Math.max(...plot.points.map((p) => p.y)) - Math.min(...plot.points.map((p) => p.y));
  check(
    "control: the sample actually has a direction to get wrong (the line is not flat)",
    ySpread > 10,
    `vertical spread ${Math.round(ySpread)}px — under ~10px this check could not tell a mirrored chart from an un-mirrored one`,
  );

  // Labels must travel with their points. Mirroring the plot and leaving
  // the dates behind produces a chart that is confidently mislabelled,
  // which is worse than the original bug.
  const labelsMirrored =
    plot.labels.length === plot.n &&
    plot.labelPoints.every((p, i) => i === 0 || p.x < plot.labelPoints[i - 1].x);
  check(
    "the date labels were mirrored along with the plot, not left behind",
    labelsMirrored,
    `${JSON.stringify(plot.labels)} at x=${JSON.stringify(plot.labelPoints.map((p) => Math.round(p.x)))}`,
  );
  // Each label has to stay with its own point, not merely run the same way.
  const labelsNearPoints = plot.labelPoints.every((p, i) => Math.abs(p.x - plot.points[i].x) < 40);
  check("and each date sits beside the session it belongs to", labelsNearPoints);

  // Direction is not self-evident from a line. The chart says which way it
  // runs, for the same reason the rest of the app says what a number is
  // built from.
  check("the chart states its own direction in words", plot.note.includes("מימין לשמאל: מהישן לחדש"), plot.note.slice(0, 120));
}

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\nchart-rtl-orientation: FAILED" : "\nchart-rtl-orientation: all checks passed");
process.exit(failed ? 1 : 0);

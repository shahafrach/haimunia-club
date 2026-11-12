// COMM-359: the generated SVG progression chart (est1RM, bodyweight, and
// body-measurement charts all share this one renderChart()) had no
// role="img", aria-label, or text alternative - a screen-reader user got
// nothing where a sighted user sees the full trend, including which points
// are PRs. Confirmed still open from the 2026-08-27 audit's finding #11.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

test("renderChart() gives the SVG role=img and an aria-label summarizing range, latest value and PR count", async () => {
  const window = await bootApp();
  const html = window.renderChart([
    { dateLabel: "1.1", est1RM: 100, isPR: false },
    { dateLabel: "8.1", est1RM: 110, isPR: true },
    { dateLabel: "15.1", est1RM: 120, isPR: true },
  ]);
  const container = window.document.createElement("div");
  container.innerHTML = html;
  const svg = container.querySelector("svg");
  assert.equal(svg.getAttribute("role"), "img");
  const label = svg.getAttribute("aria-label");
  assert.match(label, /3/, "should mention the point count");
  assert.match(label, /100/, "should mention the earliest value");
  assert.match(label, /120/, "should mention the latest value");
  assert.match(label, /2/, "should mention the PR count (2 PRs)");
});

// UPDATED, not worked around, when the compact state landed. A chart with
// fewer than three points is no longer DRAWN - it was 174px of empty plot
// area around one dot, reported from a real phone - so there is no <svg> to
// query any more. The property this test exists for is unchanged and is
// asserted on whatever now carries it: a screen-reader user still gets one
// role="img" with a real summary where a sighted user sees the value.
//
// The height half of that change is not assertable here (jsdom has no
// layout); it is measured in scripts/browser-check/training-log-polish.mjs.
test("a single-point chart still gets a real accessible name, not a range description", async () => {
  const window = await bootApp();
  const html = window.renderChart([{ dateLabel: "1.1", est1RM: 60, isPR: false }]);
  const container = window.document.createElement("div");
  container.innerHTML = html;
  const img = container.querySelector("[role='img']");
  assert.ok(img, "a single-point chart must still expose one role=img node");
  assert.match(img.getAttribute("aria-label"), /60/);
  assert.match(img.getAttribute("aria-label"), /נתון יחיד/, "and it must say it is a single point, not describe a range");
  // The plot itself is gone, which is the change under test.
  assert.equal(container.querySelector("svg polyline"), null, "no plot is drawn below the trend threshold");
  assert.equal(container.querySelectorAll(".chart-compact-row").length, 1, "one row per point");
  assert.match(container.textContent, /עוד 2/, "and it says how many more points make a trend");
});

test("two points are still compact; the third brings the plot back", async () => {
  const window = await bootApp();
  const point = (d, v) => ({ dateLabel: d, est1RM: v, isPR: false });
  const two = window.document.createElement("div");
  two.innerHTML = window.renderChart([point("1.1", 60), point("8.1", 65)]);
  assert.equal(two.querySelector("svg"), null, "two points do not draw a plot");
  assert.equal(two.querySelectorAll(".chart-compact-row").length, 2);
  assert.match(two.textContent, /עוד 1 נתון/, "singular at one short");

  const three = window.document.createElement("div");
  three.innerHTML = window.renderChart([point("1.1", 60), point("8.1", 65), point("15.1", 70)]);
  assert.ok(three.querySelector("svg polyline"), "the third point is the trend threshold");
  assert.equal(three.querySelector(".chart-compact"), null);
});

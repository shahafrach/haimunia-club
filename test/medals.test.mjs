// Tiered achievement medals (pr/streak groups — the only ones with a
// bronze/silver/gold tier) render as weight-plate photos instead of the
// SVG shield, per the mapping the user gave directly: gray "5 KG" plate =
// bronze, green "10 KG" = silver, blue "20 KG" = gold. Non-tiered medals
// (milestone, rx, capstone) are unaffected — they keep the existing SVG
// shield/circle glyph system.
//
// The plate <img> sits in TWO nested wrappers, not one:
// .medal-shape.medal-shape-plate (outer — locked/earned's grayscale filter
// still applies here) and .medal-plate (inner — does the circular
// overflow:hidden clip + rim + gloss).
//
// THE SQUARE-GLOW BUG, REPORTED TWICE. First shipped with the clip and the
// glow combined on one element; reported as "the square can be seen" and
// "fixed" by splitting the clip (.medal-plate) and the filter
// (.medal-shape-plate) onto two separate, nested elements, on the theory
// that filter:drop-shadow() on an ancestor doesn't reliably respect a
// DESCENDANT's overflow:hidden clip. Real device feedback reported the
// identical square glow again after that "fix" shipped - because the
// theory was incomplete, not fixed: drop-shadow traces the alpha of the
// element's entire rendered subtree regardless of which specific
// descendant does the clipping, so moving the clip to a child changes
// nothing about the ambiguity a filter-based glow has in a browser whose
// drop-shadow implementation falls back to the pre-clip layout box. The
// two-element split stays (test below still checks it - it is still
// correct DOM hygiene, filter and clip on the same element being
// needlessly fragile either way) but it was never the actual fix.
//
// THE ACTUAL FIX: an earned plate's glow no longer uses filter:drop-shadow
// on the ancestor at all. It is a real box-shadow, applied directly to
// .medal-plate (the element that actually carries border-radius:50%).
// box-shadow's shape is defined by spec to follow ITS OWN element's border
// radius - there is no filter-compositing step, no ancestor/descendant
// relationship to get wrong, and therefore no ambiguity for any engine to
// resolve differently. The shield/circle SVG shapes (milestone/rx/
// capstone/streak's non-tiered medals) keep using drop-shadow, unaffected
// - an SVG shape is a real vector path, which drop-shadow traces correctly
// everywhere; the ambiguity is specific to an HTML div clipped by
// border-radius+overflow:hidden, which only the plate shape uses.
//
// ACHIEVEMENTS is a module-scope `const`, not a window property (top-level
// const/let never attach to the global object), so this drives the real
// achievements modal DOM the same way the rest of this suite does, rather
// than reaching into internal state directly.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { bootApp } from "./helpers/boot.mjs";

const indexHtml = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

function badgeByName(window, text) {
  return [...window.document.querySelectorAll(".medal-badge")].find((el) => el.querySelector(".medal-name")?.textContent.includes(text));
}

// The actual fix, verified at the CSS source level rather than by pixel
// comparison (this suite has no real layout/paint engine to check a glow's
// shape against - the browser-check screenshot taken while building this
// fix is the actual visual proof; this guards the mechanism regression-
// style, so a future edit can't quietly reintroduce drop-shadow here
// without a test noticing before a third device report).
test("an earned plate medal's glow is a real box-shadow on .medal-plate, never filter:drop-shadow on an ancestor", () => {
  assert.match(
    indexHtml,
    /\.medal-badge\.earned \.medal-shape-plate \.medal-plate\{[^}]*box-shadow:[^}]*var\(--glow-color\)/,
    "the earned glow must be a box-shadow on the actual clipped circle, not a filter on its ancestor",
  );
  assert.match(
    indexHtml,
    /\.medal-badge\.earned \.medal-shape:not\(\.medal-shape-plate\)\{[^}]*filter:drop-shadow/,
    "the shield/circle SVG shapes keep drop-shadow, explicitly excluding the plate shape",
  );
  assert.doesNotMatch(
    indexHtml,
    /\.medal-badge\.earned \.medal-shape\{[^}]*filter:drop-shadow/,
    "drop-shadow must never apply to EVERY .medal-shape unconditionally again - that unconditional form is exactly what glowed a plate's square bounding box",
  );
});

test("tiered (pr) medals render the mapped weight-plate image, wrapped in the circular plate frame, not the SVG shield", async () => {
  const window = await bootApp();
  window.openAchievements();

  const bronze = badgeByName(window, "ברונזה");
  const silver = badgeByName(window, "כסף");
  const gold = badgeByName(window, "זהב");
  assert.ok(bronze && silver && gold, "the achievements list should show all three PR tiers");

  assert.ok(bronze.querySelector(".medal-plate img")?.src.includes("assets/medal-bronze.png"));
  assert.ok(silver.querySelector(".medal-plate img")?.src.includes("assets/medal-silver.png"));
  assert.ok(gold.querySelector(".medal-plate img")?.src.includes("assets/medal-gold.png"));
  assert.ok(bronze.querySelector(".medal-plate-shine"), "the plate should get the gloss overlay for visual depth");
  assert.equal(bronze.querySelector("svg"), null, "a tiered medal should not also render the SVG shield");
});

test("the glow/grayscale filter and the circular clip live on two different nested elements, not the same one", async () => {
  const window = await bootApp();
  window.openAchievements();
  const bronze = badgeByName(window, "ברונזה");

  // The outer element (target of the locked/earned filter rules) must
  // itself NOT be the clipped one — that combination is exactly what
  // caused the square-glow bug. .medal-plate (the clip) must be a
  // descendant of .medal-shape-plate (the filter target), not the same
  // node wearing both classes.
  const outer = bronze.querySelector(".medal-shape.medal-shape-plate");
  assert.ok(outer, "the outer filter-target wrapper should exist");
  assert.ok(!outer.classList.contains("medal-plate"), "the filter target must not also be the element doing the circular clip");
  const innerPlate = outer.querySelector(".medal-plate");
  assert.ok(innerPlate, "the circular clip should be a separate, nested element");
  assert.ok(innerPlate !== outer);
});

test("tiered (streak) medals use the same tier->plate mapping as pr medals", async () => {
  const window = await bootApp();
  window.openAchievements();
  const streakBronze = [...window.document.querySelectorAll(".medal-badge")].find((el) => el.querySelector(".medal-name")?.textContent.includes("רצף") && el.querySelector(".medal-name")?.textContent.includes("ברונזה"));
  assert.ok(streakBronze, "a bronze-tier streak achievement should exist");
  assert.ok(streakBronze.querySelector(".medal-plate img")?.src.includes("assets/medal-bronze.png"));
});

test("non-tiered medals (milestone, rx, capstone) still render the SVG shield/circle, unaffected by the plate swap", async () => {
  const window = await bootApp();
  window.openAchievements();
  const badges = [...window.document.querySelectorAll(".medal-badge")];
  const milestone = badges.find((el) => el.querySelector(".medal-name")?.textContent.includes("אתלט שלם"));
  const capstone = badges.find((el) => el.classList.contains("capstone-badge"));
  assert.ok(milestone && capstone, "a milestone badge and the capstone badge should both be present");

  for (const badge of [milestone, capstone]) {
    assert.ok(badge.querySelector("svg.medal-shape"), "non-tiered medals should still use the SVG shield/circle");
    assert.equal(badge.querySelector(".medal-plate"), null, "non-tiered medals should never pick up the plate frame (no tier)");
  }
});

test("a tiered medal still gets the locked/earned CSS classes on the surrounding badge, same as before the plate swap", async () => {
  const window = await bootApp();
  window.openAchievements();
  const found = badgeByName(window, "ברונזה");
  assert.ok(found, "the bronze PR badge should exist");
  assert.ok(found.classList.contains("locked"), "a fresh install should have this tier locked");
  assert.ok(!found.classList.contains("earned"));
  // The outer wrapper always carries medal-shape, so the existing
  // grayscale/glow CSS filters (scoped to .medal-badge.locked/.earned
  // .medal-shape) still apply to it, plus the plate-specific locked
  // override that keeps it visible instead of crushed to near-invisible.
  assert.ok(found.querySelector(".medal-shape.medal-shape-plate"));
});

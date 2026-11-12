#!/usr/bin/env node
// Live bug hunt, round 10 (2026-09-11): a fresh-eyes agent found that every
// tier/color CSS rule for a non-PR-tier medal (milestone/Rx/capstone - 40
// of the app's 59 achievements) was a descendant selector reaching from the
// outer <svg class="tier-bronze"/"medal-rx"/etc.> down into <path
// class="medal-rim"> etc., which lives inside a <symbol> only present via
// <use href="#medalCircle"/>. This Chromium build does not match a
// descendant combinator across that <use> reference, so the badge rendered
// as a flat, colorless (SVG's own unstyled default: solid black) circle/
// shield with no visible glyph color - both in the unlock celebration and
// on the achievements screen.
//
// <use>-referenced content has no DOM presence a script can query (no
// shadow root of any kind) - the only way to verify what's actually PAINTED
// is to look at real pixels, so this samples a real rendered screenshot of
// the live badge rather than computed styles.
//
// EVERY ASSERTION IS PAIRED WITH A CONTROL: the fix moves every rule to a
// plain (non-descendant) selector fed by an inherited CSS custom property,
// so this script also forces the fill back to SVG's own unstyled default
// live and re-samples, proving the same page and the same element WOULD
// paint black without the fix.
import { chromium } from "playwright";
import { resolveLocalOnlyTarget } from "./lib/target.mjs";
import { consoleErrorCollector, dismissWelcomeModal } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

const target = await resolveLocalOnlyTarget();
console.log(`Target: ${target.url} (local static server, mocked backend)`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = await consoleErrorCollector(page);

await installMockCloud(page);
await page.goto(target.url);
await dismissWelcomeModal(page, "בדיקה");

// Log a real Rx WOD to earn an "rx-*" achievement - solid var(--blue) fill,
// the simplest tier to assert an unambiguous "is this actually blue, not
// black" test against.
await page.evaluate(() => {
  const wod = window.allWods().find((w) => w.scoreType === "time");
  window.choosePickedWod(wod.id);
  window.applyFieldValue("wod-step", "wodMinutes", 12);
  window.applyFieldValue("wod-step", "wodSeconds", 0);
  window.setWodRx(true);
});
await page.evaluate(() => window.saveWod());
await page.evaluate(() => { if (window.closeCelebration) window.closeCelebration(); });
await page.evaluate(() => window.openAchievements());
const svgHandle = await page.waitForSelector(".medal-badge.earned .medal-rx");

// Sample a point inside the medal's FACE ring, offset from center so it
// avoids the glyph icon drawn in the middle - (0.35, 0.20) of the element's
// own box, in the same relative position every time this element renders.
async function sampleFacePixel() {
  const buf = await svgHandle.screenshot();
  const b64 = buf.toString("base64");
  return page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = "data:image/png;base64," + b64; });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const x = Math.round(img.naturalWidth * 0.35);
    const y = Math.round(img.naturalHeight * 0.20);
    const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
    return { r, g, b, a };
  }, b64);
}

const withFix = await sampleFacePixel();
const isColorlessBlack = (p) => p.r < 12 && p.g < 12 && p.b < 12;
check("an earned Rx medal's face paints a real color, not SVG's unstyled black default",
  withFix && !isColorlessBlack(withFix),
  withFix ? `rgba(${withFix.r},${withFix.g},${withFix.b},${withFix.a})` : "sample failed");
check("the painted color leans blue (b channel is the largest), matching var(--blue)",
  withFix && withFix.b >= withFix.r && withFix.b >= withFix.g && withFix.a > 0,
  withFix ? `rgba(${withFix.r},${withFix.g},${withFix.b},${withFix.a})` : "");

// CONTROL: force every medal fill/stroke back to SVG's own unstyled
// default (the exact pre-fix rendering) and re-sample the SAME element at
// the SAME relative point.
await page.evaluate(() => {
  const style = document.createElement("style");
  style.id = "medal-control-override";
  style.textContent = `
    .medal-rim, .medal-face{ fill: initial !important; }
    .medal-glyph, .medal-glyph-fill{ fill: initial !important; stroke: initial !important; }
  `;
  document.head.appendChild(style);
});
const withoutFix = await sampleFacePixel();
check("CONTROL: reverting to SVG's unstyled default repaints the same point black (proves the assertions above are not vacuous)",
  withoutFix && isColorlessBlack(withoutFix),
  withoutFix ? `rgba(${withoutFix.r},${withoutFix.g},${withoutFix.b},${withoutFix.a})` : "sample failed");

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\nmedal-icon-colors: FAILED" : "\nmedal-icon-colors: all checks passed");
process.exit(failed ? 1 : 0);

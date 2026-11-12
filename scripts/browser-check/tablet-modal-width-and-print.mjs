#!/usr/bin/env node
// Live bug hunt round 5 (2026-09-11), theme/visual-regression agent. Two
// real CSS bugs jsdom cannot see (geometry, and print-media rendering):
//
// 1. .modal-sheet (index.html) was width:100% with no cap at all below the
//    ≥900px breakpoint's own 592px fix - #app itself stays locked to its
//    mobile max-width:480px across the WHOLE 480-899px tablet gap (nothing
//    widens it before 900px), so every dialog in the app (Settings,
//    pickers, WOD builder, achievements, notifications, invite forms...)
//    stretched to the full viewport in that gap. Measured live: a 700px
//    viewport produced a 700px-wide Settings sheet sitting on top of a page
//    still visually a narrow 480px mobile card.
// 2. The @media print block only reset body's background, not html's - both
//    inherit the app's live theme background from the base html,body rule
//    (dark navy by default), so printing the invite QR flyer produced extra
//    full-bleed solid-navy pages after the real card.
//
// Usage:
//   node tablet-modal-width-and-print.mjs                 # local working tree
//   TARGET_URL=<url> node tablet-modal-width-and-print.mjs # a deployed site
import { chromium } from "playwright";
import { resolveTarget } from "./lib/target.mjs";
import { dismissWelcomeModal, openSettings, consoleErrorCollector } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

const target = await resolveTarget();
console.log(`Target: ${target.url}${target.local ? " (local static server)" : ""}`);

const browser = await chromium.launch();

// --- Bug 1: modal-sheet width across the tablet gap (480-899px) ---
for (const width of [600, 700, 850]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = await consoleErrorCollector(page);
  await installMockCloud(page);
  await page.goto(target.url, { waitUntil: "networkidle" });
  await page.waitForSelector("#app", { state: "visible" });
  await dismissWelcomeModal(page);
  await openSettings(page);

  const sheetWidth = await page.evaluate(() => document.querySelector("#settingsOverlay .modal-sheet")?.getBoundingClientRect().width);
  // 512 = #app's own 480px mobile content measure + its 16px padding each
  // side (see the fix's own comment in index.html) - a small render-rounding
  // tolerance, not a loosened bar: the bug produced a sheet equal to the
  // FULL viewport width (600/700/850), nowhere close to this cap.
  check(`${width}px viewport: Settings sheet is capped near the mobile content measure, not stretched to the full viewport`, sheetWidth <= 520, `sheetWidth=${sheetWidth}`);
  check(`${width}px viewport: no console errors`, errors.length === 0, errors.join(" | "));
  await page.close();
}

// --- Regression guard: the existing ≥900px desktop cap is untouched ---
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await installMockCloud(page);
  await page.goto(target.url, { waitUntil: "networkidle" });
  await page.waitForSelector("#app", { state: "visible" });
  await dismissWelcomeModal(page);
  // The mobile hamburger (#navMenuBtn) is display:none at this width - the
  // desktop sidebar's own "open-settings" row is the visible path here
  // (see openSettings()'s own comment in lib/actions.mjs for why a bare
  // selector would be ambiguous between the two).
  await page.click("#desktopSidebar [data-action='open-settings']");
  await page.waitForFunction(() => document.getElementById("settingsOverlay")?.classList.contains("open"), { timeout: 5000 });
  const sheetWidth = await page.evaluate(() => document.querySelector("#settingsOverlay .modal-sheet")?.getBoundingClientRect().width);
  check("1280px viewport: the existing ≥900px 592px cap still applies (not silently overridden by the new base cap)", sheetWidth <= 600, `sheetWidth=${sheetWidth}`);
  await page.close();
}

// --- Bug 2: print media resets html's background, not just body's ---
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await installMockCloud(page);
  await page.goto(target.url, { waitUntil: "networkidle" });
  await page.waitForSelector("#app", { state: "visible" });
  await dismissWelcomeModal(page);

  await page.emulateMedia({ media: "print" });
  const htmlBg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check("print media: <html>'s background resets to white, matching <body>'s", htmlBg === "rgb(255, 255, 255)", `html=${htmlBg} body=${bodyBg}`);
  check("print media: <body>'s background is white (the half that already worked)", bodyBg === "rgb(255, 255, 255)", bodyBg);
  await page.close();
}

await browser.close();

console.log(failed ? "\ntablet-modal-width-and-print: FAILED" : "\ntablet-modal-width-and-print: all checks passed");
process.exit(failed ? 1 : 0);

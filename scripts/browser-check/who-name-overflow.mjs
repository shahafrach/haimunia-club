#!/usr/bin/env node
// Live bug hunt (2026-09-11): a live agent typed an 80-char unbreakable
// name (cleanStr's own cap - one long repeated Hebrew character with no
// spaces) into the profile name and, on the Settings screen, watched it
// overflow the .who-name flex item's edge and bleed under the adjacent
// edit-icon button and the settings card's own border. The wrapping div
// already had flex:1;min-width:0 (so the item COULD shrink); nothing told
// the text it was allowed to break instead of overflow.
//
// EVERY ASSERTION IS PAIRED WITH A CONTROL: the fix is a single CSS rule
// (.who-name{overflow-wrap:anywhere}), so this script also removes it live
// and re-measures, proving the same page and the same element WOULD
// overflow without it.
import { chromium } from "playwright";
import { resolveLocalOnlyTarget } from "./lib/target.mjs";
import { consoleErrorCollector, dismissWelcomeModal, openSettings } from "./lib/actions.mjs";
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

const LONG_NAME = "א".repeat(80);
await page.evaluate((name) => window.saveWelcomeForm(name), LONG_NAME);
await openSettings(page);
await page.waitForSelector(".settings-pane .who-name");

async function measure() {
  return page.evaluate(() => {
    const nameEl = document.querySelector(".settings-pane .who-name");
    if (!nameEl) return null;
    // overflow:visible (the default) means a too-wide inline run paints
    // OUTSIDE the box without changing the box's own getBoundingClientRect
    // - that painted bleed (under the sibling edit-icon button, past the
    // card border) is exactly what was observed live. scrollWidth vs
    // clientWidth is the reliable signal for "does the intrinsic content
    // need more room than the box has", which is the actual overflow.
    return { scrollWidth: nameEl.scrollWidth, clientWidth: nameEl.clientWidth };
  });
}

const withFix = await measure();
check("long name actually wraps (scrollWidth matches clientWidth, not a single unbroken overflowing line)",
  withFix && withFix.scrollWidth <= withFix.clientWidth + 4,
  withFix ? `scrollWidth=${withFix.scrollWidth} clientWidth=${withFix.clientWidth}` : "element not found");

// CONTROL: strip the fix live, prove the same element WOULD overflow.
await page.evaluate(() => {
  const style = document.createElement("style");
  style.id = "who-name-control-override";
  style.textContent = ".who-name{ overflow-wrap: normal !important; word-break: normal !important; }";
  document.head.appendChild(style);
});
const withoutFix = await measure();
check("CONTROL: without overflow-wrap, the same name's content DOES exceed its box (proves the assertion above is not vacuous)",
  withoutFix && withoutFix.scrollWidth > withoutFix.clientWidth + 4,
  withoutFix ? `scrollWidth=${withoutFix.scrollWidth} clientWidth=${withoutFix.clientWidth}` : "element not found");

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\nwho-name-overflow: FAILED" : "\nwho-name-overflow: all checks passed");
process.exit(failed ? 1 : 0);

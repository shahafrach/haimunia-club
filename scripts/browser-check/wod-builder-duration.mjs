#!/usr/bin/env node
// Sub-task A (WOD builder half): a custom WOD's per-movement fields can be
// marked as a timed hold instead of reps — e.g. "45s Plank Hold" instead of
// forcing everything into a rep count. This only affects the generated
// free-text description (saveWod() never reads structured per-movement
// data — see builderMovementsToDesc() in app.js), so the real thing to
// verify here is that the toggle actually swaps the stepper and the final
// description reads correctly.
//
// Usage:
//   node wod-builder-duration.mjs                 # local working tree
//   TARGET_URL=<url> node wod-builder-duration.mjs # a deployed site
import { chromium } from "playwright";
import { resolveTarget } from "./lib/target.mjs";
import { switchTab, dismissWelcomeModal, selectBenchmarkWod, consoleErrorCollector } from "./lib/actions.mjs";
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

await switchTab(page, "tabWodBtn");
await page.waitForTimeout(200);
// COMM-360: selectedWodId now defaults to unset - pick a real WOD first
// (same as a real user must) before the exercise-select/open-wod-picker
// button exists to click.
await selectBenchmarkWod(page, "fran");
await page.click("[data-action='open-wod-picker']");
await page.waitForTimeout(200);
await page.click("[data-action='open-wod-builder']");
await page.waitForSelector("#wodBuilderOverlay.open", { timeout: 5000 });

await page.fill("#wodBuilderName", "Test Builder Duration WOD");
await page.click("#wodBuilderFormats .format-chip[data-format='amrap']");

// Check a movement (defaults to reps mode) then switch it to duration mode.
await page.fill("#wodBuilderMoveSearch", "Plank");
await page.waitForTimeout(150);
await page.click(".movecheck-row[data-name='Plank Hold']");
await page.waitForTimeout(100);

const repsStepperShown = await page.evaluate(() => !!document.querySelector("[data-action='builder-movement-reps'][data-field='Plank Hold']"));
check("checking a movement defaults to a reps stepper", repsStepperShown);

await page.click("[data-action='toggle-builder-movement-type'][data-name='Plank Hold'][data-type='duration']");
await page.waitForTimeout(100);
const durationStepperShown = await page.evaluate(() => !!document.querySelector("[data-action='builder-movement-duration'][data-field='Plank Hold']"));
check("switching to duration mode shows a duration stepper for that movement", durationStepperShown);

await page.fill("[data-action='builder-movement-duration'][data-field='Plank Hold'].stepper-val", "45");
await page.dispatchEvent("[data-action='builder-movement-duration'][data-field='Plank Hold'].stepper-val", "change");
await page.waitForTimeout(100);

await page.click("[data-action='create-wod']");
await page.waitForTimeout(300);

const descText = await page.evaluate(() => document.querySelector(".wod-desc")?.textContent || "");
check('the new WOD\'s generated description shows formatted time, not "10 Plank Hold"', descText.includes('45" Plank Hold'), descText);

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\nwod-builder-duration: FAILED" : "\nwod-builder-duration: all checks passed");
process.exit(failed ? 1 : 0);

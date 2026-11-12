#!/usr/bin/env node
// Lower-priority sub-task: a reference-only time cap on a WOD, and a
// free-text partner tag per attempt. Neither is scored/enforced.
//
// Usage:
//   node wod-extras.mjs                 # local working tree
//   TARGET_URL=<url> node wod-extras.mjs # a deployed site
import { chromium } from "playwright";
import { resolveTarget } from "./lib/target.mjs";
import { switchTab, dismissWelcomeModal, dismissCelebrationIfOpen, selectBenchmarkWod, consoleErrorCollector } from "./lib/actions.mjs";
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

await page.fill("#wodBuilderName", "Test Capped WOD");
await page.click("#wodBuilderFormats .format-chip[data-format='time']");
await page.waitForTimeout(150);
const capStepperShown = await page.evaluate(() => !!document.querySelector("[data-action='builder-time-cap'].stepper-val"));
check("selecting a non-EMOM format shows the time-cap stepper", capStepperShown);
await page.fill("[data-action='builder-time-cap'].stepper-val", "20");
await page.dispatchEvent("[data-action='builder-time-cap'].stepper-val", "change");
await page.click("[data-action='create-wod']");
await page.waitForTimeout(300);

const capText = await page.evaluate(() => document.body.textContent);
check("log view shows the time cap after creating the WOD", capText.includes("מגבלת זמן: 20:00"));

// Log an attempt with a partner tag.
await page.fill("#wodPartnerTagInput", "עם דנה");
await page.fill("[data-field='wodMinutes'].stepper-val", "18");
await page.dispatchEvent("[data-field='wodMinutes'].stepper-val", "change");
// Design spec §3.6: the Rx/Scaled question has no default any more, and the
// save CTA stays disabled until it is answered - so a member logging a WOD
// answers it, and so does this scenario. Answering "מלא (Rx)" keeps the
// entry identical to what this check asserted when Rx was the silent
// default, so everything below still describes the same data.
await page.click('[data-action="set-rx"][data-rx="1"]');
await page.waitForFunction(() => document.getElementById("bottomBarBtn")?.disabled === false, { timeout: 5000 });
await page.click("[data-action='save-wod']");
await page.waitForTimeout(300);
await dismissCelebrationIfOpen(page);

await switchTab(page, "tabCalendarBtn");
await page.waitForTimeout(200);
const calText = (await page.evaluate(() => document.getElementById("calDetail")?.textContent || "")).replace(/\s+/g, " ").trim();
check("calendar day view shows the partner tag next to Rx/Scaled", calText.includes("עם דנה"), calText);

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\nwod-extras: FAILED" : "\nwod-extras: all checks passed");
process.exit(failed ? 1 : 0);

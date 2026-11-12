#!/usr/bin/env node
// Sub-task B: supersets (two exercises alternating rounds under one ladder
// group) and the optional A/B/C/D block-label chips. Drives the real "add
// superset partner" picker flow and the exercise-switch pills — the part
// that node:test can't reach, since it goes through the picker overlay.
//
// Usage:
//   node superset.mjs                 # local working tree
//   TARGET_URL=<url> node superset.mjs # a deployed site
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

await selectMovement(page, "Strict");
await page.click("[data-action='toggle-ladder-mode']");
await page.waitForFunction(() => document.querySelector("[data-action='toggle-ladder-mode']").textContent.includes("פעיל"), { timeout: 5000 });

// Block label chip.
await page.click("[data-action='set-ladder-block-label'][data-label='B']");
await page.waitForTimeout(100);
const labelActive = await page.evaluate(() => document.querySelector("[data-action='set-ladder-block-label'][data-label='B']").classList.contains("active"));
check("tapping a block-label chip marks it active", labelActive);

// Round 1 of the primary exercise.
await page.fill("[data-field='weight'].stepper-val", "40");
await page.dispatchEvent("[data-field='weight'].stepper-val", "change");
await page.fill("[data-field='reps'].stepper-val", "8");
await page.dispatchEvent("[data-field='reps'].stepper-val", "change");
await page.click("[data-action='save-set']");
await page.waitForTimeout(300);
await dismissCelebrationIfOpen(page);

// Add the superset partner through the real picker flow.
await page.click("[data-action='open-picker'][data-target='partner']");
await page.waitForSelector("#pickerOverlay.open", { timeout: 5000 });
await page.fill("#pickerSearch", "Bench");
await page.waitForFunction(
  (q) => { const btn = document.querySelector(".modal-list .movement-btn[data-id]"); return btn && btn.textContent.includes(q); },
  "Bench",
  { timeout: 5000 }
);
await page.click(".modal-list .movement-btn[data-id] >> nth=0");
await page.waitForTimeout(200);

const partnerPillsShown = await page.evaluate(() => document.querySelectorAll("[data-action='ladder-switch-exercise']").length === 2);
check("picking a partner shows the two exercise-switch pills", partnerPillsShown);
const stillOnAfterPartner = await page.evaluate(() => document.querySelector("[data-action='toggle-ladder-mode']").textContent.includes("פעיל"));
check("adding a superset partner does not end the ladder", stillOnAfterPartner);

// Switch to the partner and log round 1 for it.
await page.click("[data-action='ladder-switch-exercise'] >> nth=1");
await page.waitForTimeout(150);
await page.fill("[data-field='weight'].stepper-val", "20");
await page.dispatchEvent("[data-field='weight'].stepper-val", "change");
await page.fill("[data-field='reps'].stepper-val", "10");
await page.dispatchEvent("[data-field='reps'].stepper-val", "change");
await page.click("[data-action='save-set']");
await page.waitForTimeout(300);
await dismissCelebrationIfOpen(page);

// Switch back and log round 2 for the primary.
await page.click("[data-action='ladder-switch-exercise'] >> nth=0");
await page.waitForTimeout(150);
await page.fill("[data-field='weight'].stepper-val", "42.5");
await page.dispatchEvent("[data-field='weight'].stepper-val", "change");
await page.click("[data-action='save-set']");
await page.waitForTimeout(300);
await dismissCelebrationIfOpen(page);

const stillOnAfterThree = await page.evaluate(() => document.querySelector("[data-action='toggle-ladder-mode']").textContent.includes("3 סטים"));
check("all 3 alternating rounds saved with the superset staying active", stillOnAfterThree);

await page.click("[data-action='toggle-ladder-mode']"); // finish
await page.waitForTimeout(200);

await switchTab(page, "tabCalendarBtn");
await page.waitForTimeout(200);
const dayCardText = await page.evaluate(() => document.querySelector("#calDetail .log-row")?.textContent.replace(/\s+/g, " ").trim() || "");
check("calendar folds the superset into one card spanning both exercise names", dayCardText.includes("Strict Press") && dayCardText.includes("Bench") && dayCardText.includes("סופרסט") && dayCardText.includes("בלוק B"), dayCardText);

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\nsuperset: FAILED" : "\nsuperset: all checks passed");
process.exit(failed ? 1 : 0);

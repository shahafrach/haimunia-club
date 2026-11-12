#!/usr/bin/env node
// Sub-task D: EMOM WODs with a rotating movement lineup, built through the
// WOD builder (reusable/named, same pattern as Fran/Grace) rather than a
// one-off freeform entry. Drives the real "EMOM" format chip, the
// minutes stepper, picking two movements in order, and logging an attempt
// with one reps field per movement.
//
// Usage:
//   node emom.mjs                 # local working tree
//   TARGET_URL=<url> node emom.mjs # a deployed site
import { chromium } from "playwright";
import { resolveTarget } from "./lib/target.mjs";
import { switchTab, dismissWelcomeModal, selectBenchmarkWod, dismissFirstLogArrival, consoleErrorCollector } from "./lib/actions.mjs";
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

await page.fill("#wodBuilderName", "Test Builder EMOM");
await page.click("#wodBuilderFormats .format-chip[data-format='emom']");
await page.waitForTimeout(150);

const minutesStepperShown = await page.evaluate(() => !!document.querySelector("[data-action='builder-emom-minutes'].stepper-val"));
check("selecting EMOM format shows the minutes stepper", minutesStepperShown);
await page.fill("[data-action='builder-emom-minutes'].stepper-val", "12");
await page.dispatchEvent("[data-action='builder-emom-minutes'].stepper-val", "change");

// Pick two movements, in order — Wall Balls first, then Burpees.
await page.fill("#wodBuilderMoveSearch", "Wall Balls");
await page.waitForTimeout(150);
await page.click(".movecheck-row[data-name='Wall Balls']");
await page.waitForTimeout(100);
// The older app's EMOM model (docs/audit/standalone-edition-plan.md §4.1):
// a station can be reps, a timed hold, or a rest minute, so an EMOM station
// offers the rest toggle and the same reps/time choice every format has.
const stationControls = await page.evaluate(() => ({
  rest: !!document.querySelector("[data-action='toggle-builder-movement-rest'][data-name='Wall Balls']"),
  type: !!document.querySelector("[data-action='toggle-builder-movement-type'][data-name='Wall Balls']"),
}));
check("an EMOM station can be a rest minute, reps or a timed hold", stationControls.rest && stationControls.type, JSON.stringify(stationControls));

await page.fill("[data-action='builder-movement-reps'][data-field='Wall Balls'].stepper-val", "15");
await page.dispatchEvent("[data-action='builder-movement-reps'][data-field='Wall Balls'].stepper-val", "change");

await page.fill("#wodBuilderMoveSearch", "Burpees");
await page.waitForTimeout(150);
await page.click(".movecheck-row[data-name='Burpees']");
await page.waitForTimeout(100);
await page.fill("[data-action='builder-movement-reps'][data-field='Burpees'].stepper-val", "10");
await page.dispatchEvent("[data-action='builder-movement-reps'][data-field='Burpees'].stepper-val", "change");

await page.click("[data-action='create-wod']");
await page.waitForTimeout(300);

const descText = await page.evaluate(() => document.querySelector(".wod-desc")?.textContent || "");
check("created EMOM's description mentions both movements and the minute count", descText.includes("EMOM 12") && descText.includes("Wall Balls") && descText.includes("Burpees"), descText);

const emomSteppers = await page.evaluate(() => [...document.querySelectorAll("[data-action='wod-emom-step'].stepper-val")].map((el) => el.value));
check("log form shows one prefilled stepper per rotation movement, in order", JSON.stringify(emomSteppers) === JSON.stringify(["15", "10"]), JSON.stringify(emomSteppers));

const scoreTypeLabel = await page.evaluate(() => document.body.textContent.includes("EMOM"));
check("score-type stat card shows EMOM, not a fallback label", scoreTypeLabel);

// Log an attempt: matched wall balls, scaled down burpees.
await page.fill("[data-action='wod-emom-step'][data-field='0'].stepper-val", "15");
await page.dispatchEvent("[data-action='wod-emom-step'][data-field='0'].stepper-val", "change");
await page.fill("[data-action='wod-emom-step'][data-field='1'].stepper-val", "7");
await page.dispatchEvent("[data-action='wod-emom-step'][data-field='1'].stepper-val", "change");
// Design spec §3.6: the Rx/Scaled question has no default any more, and the
// save CTA stays disabled until it is answered - so a member logging a WOD
// answers it, and so does this scenario. Answering "מלא (Rx)" keeps the
// entry identical to what this check asserted when Rx was the silent
// default, so everything below still describes the same data.
await page.click('[data-action="set-rx"][data-rx="1"]');
await page.waitForFunction(() => document.getElementById("bottomBarBtn")?.disabled === false, { timeout: 5000 });
await page.click("[data-action='save-wod']");
await page.waitForTimeout(300);

const noPrFlash = await page.evaluate(() => document.getElementById("wodFlashBox")?.style.display !== "flex");
check("saving an EMOM attempt never flashes a PR (no cross-attempt scoring)", noPrFlash);

// Design spec §1.2 S4. This is the first entry this fresh context has ever
// saved, so it gets the arrival card - and clearing it is not optional
// housekeeping: it is a .modal-overlay and it intercepted the tab switch
// below, which is how the sequence change first showed up in this suite.
//
// Asserted rather than merely clicked away, because the same claim this
// scenario already makes about the PR flash has to hold for the card too:
// an EMOM has no cross-attempt scoring, so nothing about this save is a
// record, and the card must not imply one.
const arrivalText = await dismissFirstLogArrival(page);
check("the first-ever saved entry is answered as arrival", !!arrivalText && arrivalText.includes("הרישום הראשון שלך נשמר"), arrivalText || "no card");
check("...and says nothing about a personal record", !!arrivalText && !arrivalText.includes("שיא"), arrivalText || "");

await switchTab(page, "tabCalendarBtn");
await page.waitForTimeout(200);
const calText = (await page.evaluate(() => document.getElementById("calDetail")?.textContent || "")).replace(/\s+/g, " ").trim();
check("calendar day view shows per-movement reps (15 · 7), not a generic score", calText.includes("15 · 7"), calText);

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\nemom: FAILED" : "\nemom: all checks passed");
process.exit(failed ? 1 : 0);

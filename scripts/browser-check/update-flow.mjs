#!/usr/bin/env node
// Exercises the service-worker update lifecycle end to end — the one class
// of bug this app has actually shipped twice (a self-reload on every first
// install; the update banner never auto-applying). None of this is
// reachable from the jsdom test suite, since jsdom doesn't implement
// Service Worker lifecycle events at all.
//
// Local-only: this script edits sw.js on disk (a temporary version bump,
// reverted at the end) to simulate a new deploy landing, so it always runs
// against a local static server over the working tree — TARGET_URL is
// ignored here.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./lib/target.mjs";
import { startStaticServer } from "./lib/server.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

const swPath = path.join(projectRoot, "sw.js");
const origSw = readFileSync(swPath, "utf8");
function bumpSwVersion(v) {
  writeFileSync(swPath, origSw.replace(/const SW_VERSION = "[^"]+";/, `const SW_VERSION = "${v}";`));
}
function restoreSw() {
  writeFileSync(swPath, origSw);
}

const { url, close } = await startStaticServer(projectRoot);
console.log(`Target: ${url} (local static server, sw.js will be temporarily edited)`);
const browser = await chromium.launch();

async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  // COMM-333: cloud.js boots unconditionally on every one of this script's
  // page loads, and cloud-config.js points at the real, live production
  // Supabase project - see ladder.mjs's own comment on this same call for
  // the full reasoning (safety, and the source of intermittent 401/409s).
  await installMockCloud(page);
  return { ctx, page };
}
async function waitForControllerActive(page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.state === "activated", { timeout: 15000 });
}

try {
  console.log("\n--- Scenario 1: first-ever install must not self-reload ---");
  {
    const { ctx, page } = await freshPage();
    // "load", not "framenavigated": the dialog back-button fix (app.js's
    // APP_DIALOGS history layer — see dialog-back-button.mjs) calls
    // history.pushState() the moment the welcome modal opens, which it does
    // automatically on this exact fresh-install path within this test's own
    // 4s window. Playwright counts that same-document history change as a
    // "framenavigated" event, which is not what this check means by
    // "reload" — see boot-smoke.mjs's identical fix for the same reason.
    // "load" only fires for a genuine document (re)load.
    let loadCount = 0;
    page.on("load", () => loadCount++);
    await page.goto(url, { waitUntil: "networkidle" });
    await waitForControllerActive(page);
    await page.waitForTimeout(4000);
    check("no reload within 4s of a fresh install", loadCount === 1, `loadCount=${loadCount}`);
    await ctx.close();
  }

  console.log("\n--- Scenario 2: update arrives while page is HIDDEN -> auto-applies silently ---");
  {
    const { ctx, page } = await freshPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await waitForControllerActive(page);
    bumpSwVersion("0.0.1-check-hidden");
    await page.evaluate(() => Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }));
    // Attach the reload listener BEFORE triggering the update check — the
    // reload can land during the very next wait, and a listener attached
    // after the fact would simply miss an event that already happened.
    const navPromise = page.waitForEvent("load", { timeout: 15000 }).then(() => true).catch(() => false);
    await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
    await page.waitForTimeout(500);
    const bannerWhileHidden = await page.evaluate(() => document.getElementById("updateBanner").style.display === "block").catch(() => false);
    check("banner does NOT show while hidden", !bannerWhileHidden);
    check("page reloads automatically without ever showing a banner", await navPromise);
    restoreSw();
    await ctx.close();
  }

  console.log("\n--- Scenario 3: update arrives while page is VISIBLE -> banner shown, requires an actual tap ---");
  {
    // Live bug hunt (2026-09-11): this scenario used to assert the OPPOSITE
    // of what app.js's own comment promises ("reloading out from under
    // someone mid-set would drop whatever they just typed but haven't
    // tapped Save on yet") - showUpdateBanner() never marked the banner as
    // showing, so the SAME visibilitychange listener that legitimately
    // auto-applies an update arriving while hidden also fired on the very
    // NEXT hide/show cycle after the banner was already up. A phone screen
    // lock/unlock - named in that same comment as the ordinary, expected
    // case - silently reloaded and dropped in-progress input with no tap
    // ever happening. Confirmed live with real unsaved text in the WOD
    // builder's own name field before this fix. Now: a hide/show cycle
    // while the banner is showing must NOT reload; only tapping the banner
    // itself may.
    const { ctx, page } = await freshPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await waitForControllerActive(page);
    bumpSwVersion("0.0.2-check-visible");
    await page.evaluate(() => Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }));
    await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
    await page.waitForTimeout(1000);
    const bannerShown = await page.evaluate(() => document.getElementById("updateBanner").style.display === "block");
    check("banner shows while actively visible", bannerShown);

    // The exact repro: real unsaved input sitting in a form, then one
    // ordinary screen lock/unlock cycle while the banner is up.
    await page.evaluate(() => { window.openWodBuilder(""); document.getElementById("wodBuilderName").value = "טיוטה שלא נשמרה"; });
    let reloadedTooEarly = false;
    const earlyLoad = page.waitForEvent("load", { timeout: 2500 }).then(() => { reloadedTooEarly = true; }).catch(() => {});
    await page.evaluate(() => Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.evaluate(() => Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await earlyLoad;
    check("a single screen lock/unlock while the banner is showing does NOT reload", !reloadedTooEarly);
    const draftSurvived = await page.evaluate(() => document.getElementById("wodBuilderName")?.value === "טיוטה שלא נשמרה").catch(() => false);
    check("the unsaved draft survives that lock/unlock cycle", draftSurvived);
    const stillShown = await page.evaluate(() => document.getElementById("updateBanner").style.display === "block");
    check("the banner is still up, still waiting for an actual tap", stillShown);

    // The actual tap is what must apply it.
    const navPromise = page.waitForEvent("load", { timeout: 15000 }).then(() => true).catch(() => false);
    await page.click("#updateBanner");
    check("tapping the banner itself does reload", await navPromise);
    restoreSw();
    await ctx.close();
  }
} finally {
  restoreSw(); // belt and braces even if an assertion threw mid-scenario
  await browser.close();
  await close();
}

console.log(failed ? "\nupdate-flow: FAILED" : "\nupdate-flow: all checks passed");
process.exit(failed ? 1 : 0);

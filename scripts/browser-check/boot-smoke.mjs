#!/usr/bin/env node
// Baseline smoke check: fresh load, fonts actually load (not falling back
// to system sans-serif), no unexpected page reload, all 5 tabs switch
// cleanly, no console errors. Run before any release — this is the fastest
// of the three checks and catches the broadest class of regressions.
//
// Usage:
//   node boot-smoke.mjs                 # local working tree
//   TARGET_URL=<url> node boot-smoke.mjs # a deployed site
import { chromium } from "playwright";
import { resolveTarget } from "./lib/target.mjs";
import { switchTab, consoleErrorCollector, dismissWelcomeModal } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

const target = await resolveTarget();
console.log(`Target: ${target.url}${target.local ? " (local static server)" : ""}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors = await consoleErrorCollector(page);

// "load" fired on the main frame, not "framenavigated": this app's dialog
// back-button fix (app.js's registerAppDialog()/APP_DIALOGS history layer,
// mirrored for cloud.js's CLOUD_DIALOGS — see dialog-back-button.mjs) calls
// history.pushState() the moment ANY dialog opens, including the welcome
// modal that opens automatically on a fresh boot within this test's own 4s
// window. "framenavigated" fires for that too (Playwright counts any
// same-document history change as a navigation), which made this check
// fail on navCount===2 the moment that fix shipped even though nothing had
// actually reloaded — confirmed live: two "framenavigated" events, same
// URL, and exactly one "load" event, the whole time. "load" only fires for
// a genuine document (re)load, never for pushState/replaceState/hashchange,
// so it is the signal this check actually wants and is immune to how many
// dialogs a future change teaches to reserve a history entry.
let loadCount = 0;
page.on("load", () => loadCount++);

// COMM-333: cloud.js boots unconditionally regardless of which tab a
// script visits, and cloud-config.js points at the real, live production
// Supabase project - without this, an offline-only check like this one
// still fires real network calls (session restore, anonymous sign-in via
// the auto-backup bootstrap, etc.) against production in the background,
// which is both a safety risk (see lib/mockCloud.mjs's own comment) and
// the source of intermittent 401/409 console errors this suite saw.
await installMockCloud(page);
await page.goto(target.url, { waitUntil: "networkidle" });
await page.waitForSelector("#app", { state: "visible", timeout: 10000 });
check("app shell became visible", true);

const fontInfo = await page.evaluate(async () => {
  await document.fonts.ready;
  return {
    dir: document.documentElement.dir,
    hasRubik: [...document.fonts].some((f) => f.family === "Rubik" && f.status === "loaded"),
  };
});
check("dir=rtl on <html>", fontInfo.dir === "rtl");
check("Rubik font actually loaded", fontInfo.hasRubik);

// The service worker's clients.claim() used to fire an unconditional
// reload on every first-ever install — see CHANGES.md, "stop
// self-reloading on first install". Give it a few seconds to (not) happen.
await page.waitForTimeout(4000);
check("no unexpected page reload in the first 4s", loadCount === 1, `loadCount=${loadCount}`);

await dismissWelcomeModal(page);
for (const id of ["tabHistoryBtn", "tabCalendarBtn", "tabWodBtn", "tabAddBtn"]) {
  await switchTab(page, id);
  await page.waitForTimeout(150);
}
const contentNotEmpty = await page.evaluate(() => document.getElementById("content").children.length > 0);
check("all 4 tabs switch without an empty/broken content area", contentNotEmpty);
check("there is no Community tab", await page.evaluate(() => !document.getElementById("tabCommunityBtn")));

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\nboot-smoke: FAILED" : "\nboot-smoke: all checks passed");
process.exit(failed ? 1 : 0);

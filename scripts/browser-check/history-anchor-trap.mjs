#!/usr/bin/env node
// Live report: "when I move my finger from the left side it opens another
// app or something." manifest.json ships display:standalone - an installed
// PWA's WKWebView still recognizes iOS's own edge-swipe-back gesture even
// with no browser chrome to show for it. Before this fix, the app never
// pushed any history entry except the dialog-open reservation
// (syncAppDialogHistoryState, app.js) - consumed back to zero the instant a
// dialog closed. On any ORDINARY screen, with nothing open, history had
// nowhere to go, so an edge-swipe-back gesture fell straight through the
// page to the OS instead of being absorbed by the app.
//
// jsdom (the unit-test suite's engine) has no layout and cannot fire a real
// OS-level edge-swipe gesture at all - the only way to see this is to drive
// the exact API surface a real gesture drives (history.back() + the
// popstate it fires) in a real browser, which is what this does.
//
// EVERY ASSERTION IS PAIRED WITH A CONTROL: the dialog-reservation case
// (where a bare re-push must NOT happen - the dialog listener owns that
// pop) is exercised right alongside the bare-screen case, so this cannot
// pass by re-pushing unconditionally on every single pop.
import { chromium } from "playwright";
import { resolveTarget } from "./lib/target.mjs";
import { dismissWelcomeModal, consoleErrorCollector } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

const target = await resolveTarget();
console.log(`Target: ${target.url}${target.local ? " (local static server)" : ""}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = await consoleErrorCollector(page);

await installMockCloud(page);
await page.goto(target.url, { waitUntil: "networkidle" });
await page.waitForSelector("#app", { state: "visible" });
await dismissWelcomeModal(page);

const depthAfterBoot = await page.evaluate(() => history.length);
check("boot establishes at least one un-consumable history entry beyond the initial load", depthAfterBoot >= 2, `history.length=${depthAfterBoot}`);

// ---- Bare screen: nothing open, this is the actual reported bug ----
const marker = await page.evaluate(() => document.getElementById("content").innerHTML.length);
const popped = await page.evaluate(() => new Promise((resolve) => {
  window.addEventListener("popstate", () => resolve(true), { once: true });
  history.back();
  setTimeout(() => resolve(false), 2000);
}));
check("a bare back-navigation (the edge-swipe gesture's own API) does fire a popstate to react to", popped);
await page.waitForTimeout(150); // let the re-push listener run
const depthAfterBareSwipe = await page.evaluate(() => history.length);
check(
  "history is re-anchored after a bare swipe, not left exhausted for the NEXT swipe to fall through on",
  depthAfterBareSwipe >= depthAfterBoot,
  `before=${depthAfterBoot} after=${depthAfterBareSwipe}`,
);
const markerAfter = await page.evaluate(() => document.getElementById("content").innerHTML.length);
check("the re-anchor is a pure history operation - the actual screen content is untouched", markerAfter === marker, `before=${marker} after=${markerAfter}`);
const dialogsOpenAfterBareSwipe = await page.evaluate(() => [...document.querySelectorAll(".modal-overlay.open")].map((el) => el.id));
check("no dialog was accidentally opened or closed by the bare swipe", dialogsOpenAfterBareSwipe.length === 0, dialogsOpenAfterBareSwipe.join(", "));

// ---- Control: with a real dialog open, the SAME back-navigation must
// close the dialog (the pre-existing feature), not just re-anchor and
// leave the dialog sitting open. Proves the new listener defers to the
// dialog one instead of unconditionally eating every pop. ----
await page.click("#navMenuBtn");
await page.waitForSelector("#navMenuOverlay.open", { state: "visible", timeout: 5000 });
await page.evaluate(() => history.back());
await page.waitForFunction(() => !document.getElementById("navMenuOverlay")?.classList.contains("open"), { timeout: 5000 });
check("control: with a dialog open, the same back-navigation still closes it (existing feature untouched)", true);

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\nhistory-anchor-trap: FAILED" : "\nhistory-anchor-trap: all checks passed");
process.exit(failed ? 1 : 0);

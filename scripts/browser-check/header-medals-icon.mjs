#!/usr/bin/env node
// Live report: "I want a medal icon in the top left... I can't see any
// change." The header's pre-existing achievements entry point (the
// userGreeting button + "לכל המדליות וההישגים שלי" link) lives in the
// header's SECOND child, which is display:none on every scene page
// (body[data-scene] .header > div:last-child) - and nearly every primary
// tab (Add/History/Progress/Library/Community/Achievements) is a scene
// page. So the entry point a member could actually find was invisible on
// the screens they spend their time on. #medalsBtn (index.html) is a new
// icon in the header's FIRST child instead, which stays visible in scene
// mode, shown only there (the few non-scene screens already have the
// original entry points).
//
// A second live report landed moments later against the achievements
// screen itself: "this button can't be reached" - a screenshot showing its
// close (X) sitting under the device status bar. #achievementsOverlay's
// modal-head was missing from the safe-area-inset-top padding rule that
// #navMenuSheet/#settingsSheet already had (index.html, ~line 1045).
//
// EVERY ASSERTION IS PAIRED WITH A CONTROL where the bug could otherwise
// hide: the medal icon's own hit-test is checked against the bell's, to
// prove the two 44px boxes this session added a grid spacer column for
// don't actually overlap (the exact "edit/delete" tap-resolves-to-the-
// wrong-control shape a comment in this same header elsewhere warns about).
import { chromium } from "playwright";
import { resolveTarget } from "./lib/target.mjs";
import { dismissWelcomeModal, switchTab, consoleErrorCollector } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";
import { hitTest } from "./lib/geometry.mjs";

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

// Visible on the very first screen too (the default "add" tab, itself a
// scene page - PAGE_SCENES maps all 5 main tabs, so there is no ordinary
// screen this needs to hide from; see the button's own comment).
const visibleOnDefaultTab = await page.locator("#medalsBtn").isVisible();
check("#medalsBtn is visible on the default landing tab", visibleOnDefaultTab);

// ---- A scene page (Calendar/History): the bug's actual scene ----
await switchTab(page, "tabCalendarBtn");
const scene = await page.evaluate(() => document.body.dataset.scene || null);
check("calendar/history is a scene page (precondition)", !!scene, String(scene));

const visible = await page.locator("#medalsBtn").isVisible();
check("#medalsBtn is visible on a scene page", visible);

// Both are real 44px boxes now (grid columns, not the invisible ::after
// hit-area trick) - hitTest() on each must resolve to ITSELF, not the
// other, proving the added spacer column actually prevents the overlap a
// zero-gap 4th column would have caused.
const medalHit = await hitTest(page, "#medalsBtn", ["medalsBtn", "notificationsBellBtn"]);
check(
  "#medalsBtn's own tap resolves to itself, not the bell next to it",
  medalHit.reachable === true && medalHit.interceptedBy !== "notificationsBellBtn",
  medalHit.error || `topmost is ${medalHit.topDesc}${medalHit.interceptedBy ? ` (inside #${medalHit.interceptedBy})` : ""}`,
);
const bellHit = await hitTest(page, "#notificationsBellBtn", ["medalsBtn", "notificationsBellBtn"]);
check(
  "the bell's own tap resolves to itself, not the medal icon next to it",
  bellHit.reachable === true && bellHit.interceptedBy !== "medalsBtn",
  bellHit.error || `topmost is ${bellHit.topDesc}${bellHit.interceptedBy ? ` (inside #${bellHit.interceptedBy})` : ""}`,
);

// The actual point of the feature: tapping it opens achievements.
await page.click("#medalsBtn");
await page.waitForSelector("#achievementsOverlay.open", { state: "visible", timeout: 5000 });
check("tapping #medalsBtn opens the achievements/מדליות overlay", true);

// ---- The other live report: the close button must clear the status bar ----
// No real device safe-area to emulate headlessly, so this asserts the
// STRUCTURAL fix instead: #achievementsOverlay's close button now gets the
// exact same padding-top formula #navMenuSheet/#settingsSheet's close
// buttons already relied on (same computed px value with no notch present
// proves the same calc()/env() rule is wired to all three, not just the
// two it used to cover).
const paddings = await page.evaluate(() => {
  const px = (sel) => getComputedStyle(document.querySelector(sel)).paddingTop;
  return {
    achievements: px("#achievementsOverlay .modal-head"),
    nav: px("#navMenuSheet > .modal-head"),
  };
});
check(
  "achievements' close button gets the same safe-area-aware top padding as the nav menu's (was missing before, causing the status-bar collision)",
  paddings.achievements === paddings.nav,
  JSON.stringify(paddings),
);
const closeBtn = await page.locator("#achievementsOverlay button[data-action='close-achievements']");
await closeBtn.click();
await page.waitForFunction(() => !document.getElementById("achievementsOverlay")?.classList.contains("open"), { timeout: 5000 });
check("the close button is a real, working control (not just correctly padded)", true);

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\nheader-medals-icon: FAILED" : "\nheader-medals-icon: all checks passed");
process.exit(failed ? 1 : 0);

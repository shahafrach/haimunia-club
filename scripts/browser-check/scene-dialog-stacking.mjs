#!/usr/bin/env node
// THE BUG (QA-agent-flagged, fresh-eyes persona review, fixed live):
// `body[data-scene] main{ position:relative; z-index:1; }` gave <main> its
// own explicit z-index. Combined with position:relative, that makes
// position:relative CREATE A STACKING CONTEXT for main as a whole (it would
// not, with z-index left at auto). <header> (z-index:20) and #bottomNavWrap
// (z-index:30) are main's SIBLINGS under #app, not its descendants — so on
// a scene page (History, Progress, Library, Community, Achievements, Add),
// main's own stacking level (1) is what they compare against, not the
// z-index:50 any dialog rendered into #content (main's child) carries. A
// dialog's z-index:50 only ever wins against other things inside main; it
// is capped at "1" from its parent's point of view. So the dialog's
// backdrop near the top ~64px (under the header) and bottom ~68px+safe-area
// (under #bottomNavWrap) silently fails hit-testing — the header/bottom bar
// paint over it and eat the tap, even though the dialog is visibly open and
// its own z-index looks like it should already win.
//
// THE FIX: drop the z-index from that rule, keep position:relative (nothing
// in this file asserts why it's there, so it's left alone; position:relative
// alone, with z-index left auto, never creates a stacking context). Nothing
// else relied on main having a competing z-index — .scene-page already has
// isolation:isolate and .scene-sheet has its own scoped z-index:1 for the
// photo/scrim layering this looked like it was meant for.
//
// EVERY ASSERTION HERE IS PAIRED WITH A CONTROL (same discipline as
// install-dock-hit-check.mjs / bidi-rtl-geometry.mjs): re-adding the old
// z-index:1 live must make the exact same hit-tests fail, or this check
// would pass against a page that never had the fix at all.
//
// Usage:
//   node scene-dialog-stacking.mjs                 # local working tree
//   TARGET_URL=<url> node scene-dialog-stacking.mjs # a deployed site
import { chromium } from "playwright";
import { resolveTarget } from "./lib/target.mjs";
import { dismissWelcomeModal, switchTab, consoleErrorCollector } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

// Point-based, not hitTest()'s element-center-based helper: the whole bug is
// about the EDGES of the dialog's own backdrop, which is a full-viewport
// inset:0 box — its own center is nowhere near the header or bottom nav, so
// a center hit-test would pass whether the fix exists or not. This asks the
// exact question the bug is about: does the topmost element at a point
// under the header / under the bottom nav belong to the open overlay?
async function pointOwnedByOverlay(page, x, y, overlayId) {
  return page.evaluate(
    ({ x, y, overlayId }) => {
      const top = document.elementFromPoint(x, y);
      if (!top) return { owned: false, topDesc: "(nothing)" };
      const overlay = document.getElementById(overlayId);
      const owned = !!overlay && (top === overlay || overlay.contains(top));
      return {
        owned,
        topDesc: top.id ? `#${top.id}` : `${top.tagName.toLowerCase()}${typeof top.className === "string" && top.className ? "." + top.className : ""}`,
      };
    },
    { x, y, overlayId },
  );
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

// Calendar/History is a scene-mapped tab (.scene-page--history) — puts
// body[data-scene] on, which is the precondition for the whole bug.
await switchTab(page, "tabCalendarBtn");
const scene = await page.evaluate(() => document.body.dataset.scene || null);
check("calendar/history is a scene page (body[data-scene] is set)", !!scene, String(scene));

// #appConfirmOverlay, unlike #navMenuOverlay/#achievementsOverlay/etc, is not
// a permanent top-level DOM node — renderAppConfirmSheet()'s markup is
// concatenated into `content` and set as #content's innerHTML on every
// render() (app.js), so while open it is a genuine DOM DESCENDANT of <main>
// — exactly the dialog shape the bug traps. Opened directly via
// askAppConfirm() (the same function askDeleteEntry() etc. call) rather
// than through a seeded delete flow, since the dialog itself is what's
// under test, not any particular caller of it.
await page.evaluate(() => {
  window.askAppConfirm({
    title: "בדיקה", message: "בדיקת מיקום דיאלוג.", confirmLabel: "אישור",
    action: "noop-test", payload: {},
  });
});
await page.waitForSelector("#appConfirmOverlay.open", { state: "visible", timeout: 5000 });

const viewport = page.viewportSize();
const underHeader = { x: Math.round(viewport.width / 2), y: 20 };   // inside the 64px header band
const underBottomNav = { x: Math.round(viewport.width / 2), y: viewport.height - 20 }; // inside #bottomNavWrap's band

const headerHit = await pointOwnedByOverlay(page, underHeader.x, underHeader.y, "appConfirmOverlay");
check(
  "the open dialog's backdrop owns a tap under the header, not the header itself",
  headerHit.owned,
  `topmost at (${underHeader.x},${underHeader.y}) is ${headerHit.topDesc}`,
);

const bottomHit = await pointOwnedByOverlay(page, underBottomNav.x, underBottomNav.y, "appConfirmOverlay");
check(
  "the open dialog's backdrop owns a tap under the bottom nav, not the bottom nav itself",
  bottomHit.owned,
  `topmost at (${underBottomNav.x},${underBottomNav.y}) is ${bottomHit.topDesc}`,
);

// ---- Control: prove these hit-tests can actually fail ----
// Re-creates the pre-fix rule live and re-runs the exact same two hit-tests.
// If they do not now fail, this script has stopped proving anything.
await page.evaluate(() => {
  const style = document.createElement("style");
  style.id = "__preFixStackingControl";
  style.textContent = "body[data-scene] main{ position:relative; z-index:1; }";
  document.head.appendChild(style);
});
await page.waitForTimeout(50);

const headerHitBroken = await pointOwnedByOverlay(page, underHeader.x, underHeader.y, "appConfirmOverlay");
const bottomHitBroken = await pointOwnedByOverlay(page, underBottomNav.x, underBottomNav.y, "appConfirmOverlay");
check(
  "control: re-adding main's old z-index:1 DOES trap the backdrop under the header",
  headerHitBroken.owned === false,
  headerHitBroken.owned ? "still reachable — this check can no longer detect the bug it guards" : `topmost is now ${headerHitBroken.topDesc}`,
);
check(
  "control: re-adding main's old z-index:1 DOES trap the backdrop under the bottom nav",
  bottomHitBroken.owned === false,
  bottomHitBroken.owned ? "still reachable — this check can no longer detect the bug it guards" : `topmost is now ${bottomHitBroken.topDesc}`,
);

await page.evaluate(() => document.getElementById("__preFixStackingControl")?.remove());
await page.waitForTimeout(50);

// Sanity: the dialog still closes normally after all this style poking.
await page.click("#appConfirmOverlay", { position: { x: 5, y: 5 } });
await page.waitForFunction(() => !document.getElementById("appConfirmOverlay")?.classList.contains("open"), { timeout: 5000 });

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\nscene-dialog-stacking: FAILED" : "\nscene-dialog-stacking: all checks passed");
process.exit(failed ? 1 : 0);

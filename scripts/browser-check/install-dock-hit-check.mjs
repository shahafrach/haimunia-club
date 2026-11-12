#!/usr/bin/env node
// The install dock, asserted by hit-testing rather than by inspecting the
// DOM — because the DOM was never wrong.
//
// THE BUG (53d6230). #installBanner and #iosInstallBanner were each their
// own `position:fixed; bottom:0; z-index:59` element, 163px tall on an
// 844px screen, while `.tabbar` carried no z-index at all and #bottomBarBtn
// — the primary "רישום סט" save CTA — sat at z-index 20. So the moment
// Chrome offered the install prompt, the banner parked itself on top of the
// entire bottom navigation and the save button. A member who had just been
// invited to install the app could no longer log a set or change tabs. Both
// banners are now ordinary in-flow children of #bottomNavWrap, stacked
// above .bottom-bar and .tabbar, so zero overlap is a consequence of block
// layout rather than of anyone winning a z-index argument.
//
// WHY THIS FILE HAS TO EXIST. test/install-prompt.test.mjs covers the
// beforeinstallprompt handshake thoroughly — defer the native prompt, show
// the banner, replay it on tap, stay dismissed for the session — and none
// of that can see this bug. jsdom has no layout engine: every
// getBoundingClientRect() it returns is 0x0 at (0,0) and
// document.elementFromPoint() is not implemented at all. The banner's
// display flips to "block" in jsdom exactly as it does in Chrome, and the
// save button is present and clickable in the DOM either way. The original
// fix was proven by elementFromPoint hit-tests run by hand, once, and
// nothing has re-run them since.
//
// The failure mode is silent in the worst way: it only appears once the
// browser decides to offer installation, which is a heuristic nobody
// controls and which never fires during ordinary development.
//
// EVERY ASSERTION IS PAIRED WITH A CONTROL, for the same reason as
// bidi-rtl-geometry.mjs: "the save button is tappable" is also true on a
// page with no banner at all. So this script re-creates the pre-fix
// geometry on the live page (position:fixed; bottom:0; z-index:59) and
// requires the hit-tests to FAIL under it. If they ever stop failing, this
// check has stopped proving anything and says so.
//
// Usage:
//   node install-dock-hit-check.mjs                 # local working tree
//   TARGET_URL=<url> node install-dock-hit-check.mjs # a deployed site
import { chromium } from "playwright";
import { resolveTarget } from "./lib/target.mjs";
import { dismissWelcomeModal, selectMovement, dismissFirstLogArrival, consoleErrorCollector } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";
import { hitTest } from "./lib/geometry.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

// Chrome fires beforeinstallprompt on its own heuristics, which will not
// fire for a local static server — so the event is synthesised with the
// same shape a real one has (cancelable, carrying prompt() and userChoice),
// exactly as test/install-prompt.test.mjs does. app.js's own handler does
// the rest, so this drives the shipped code path, not a CSS fixture.
async function fireBeforeInstallPrompt(page) {
  await page.evaluate(() => {
    const evt = new Event("beforeinstallprompt", { cancelable: true });
    evt.prompt = () => {};
    evt.userChoice = Promise.resolve({ outcome: "dismissed" });
    window.dispatchEvent(evt);
  });
}
async function waitForDock(page, shown, timeout = 5000) {
  try {
    await page.waitForFunction(
      (want) => (document.getElementById("installBanner")?.style.display === "block") === want,
      shown,
      { timeout },
    );
    return true;
  } catch { return false; }
}
// Design spec §1.2 S6. The event alone is no longer enough to put the dock
// on screen — it is held until the member has something saved AND has come
// back on a later calendar day. This walks the app to the far side of that
// gate the way a returning member arrives at it: log a real entry, then move
// the recorded first-open date back a day and let app.js re-read it.
async function satisfyInstallGate(page) {
  await page.click("#bottomBarBtn");                 // one saved entry
  await dismissFirstLogArrival(page);                // §1.2 S4's card
  await page.evaluate(async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await dbSetSetting("haimunia:firstOpenDate", yesterday);
    await loadFirstOpenDate();
    render();                                        // the gate is re-checked per render
  });
}

// The three things a member must still be able to reach while the dock is
// up: the save CTA and the tab bar that gets them anywhere else.
const CONTROLS = [
  ["the save CTA (#bottomBarBtn)", "#bottomBarBtn"],
  ["the first tab button", "#bottomTabBar .tabbtn:first-child"],
  ["the last tab button", "#bottomTabBar .tabbtn:last-child"],
];

const target = await resolveTarget();
console.log(`Target: ${target.url}${target.local ? " (local static server)" : ""}`);

const browser = await chromium.launch();
// 390x844 — the viewport the 163px overlap was originally measured on.
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = await consoleErrorCollector(page);

await installMockCloud(page);
await page.goto(target.url, { waitUntil: "networkidle" });
await page.waitForSelector("#app", { state: "visible" });
await dismissWelcomeModal(page);
// Pick a movement first. #bottomBar is display:none until there is
// something to save, so this is what turns #bottomBarBtn into the "רישום
// סט" save CTA the banner used to bury — and it is also the exact moment
// the bug bites: a member mid-way through logging a set when Chrome decides
// to offer the install prompt.
await selectMovement(page, "Strict");
await page.waitForSelector("#bottomBarBtn", { state: "visible", timeout: 5000 });
const ctaAction = await page.evaluate(() => document.getElementById("bottomBarBtn").dataset.action);
check("the bottom bar is showing the save CTA, the control this bug buried", ctaAction === "save-set", ctaAction);

// Baseline: everything is reachable before the banner exists. Without this,
// a later failure cannot be attributed to the banner.
for (const [label, sel] of CONTROLS) {
  const r = await hitTest(page, sel, ["installBanner"]);
  check(`before the banner: ${label} is reachable`, r.reachable === true, r.error || r.topDesc);
}

// ---- §1.2 S6: the event is held, not obeyed ----
// This half is new and it is a control in its own right. The dock used to go
// up the instant the browser offered it, which on a fresh profile is during
// the first load — so the largest, most colourful block in the app was an
// advertisement for itself, shown on an empty log before the app had done
// anything for the member. Firing the event here, with nothing saved and on
// the first calendar day, must NOT put it on screen.
await fireBeforeInstallPrompt(page);
const deferred = await waitForDock(page, false, 2000);
check(
  "the install dock stays down on day one with an empty log, even after beforeinstallprompt",
  deferred === true,
  deferred ? "" : "the dock appeared the moment the browser offered it — §1.2 S6's deferral is gone",
);

// ...and comes up once the member has something to keep and has come back.
await satisfyInstallGate(page);
const shown = await waitForDock(page, true, 5000);
check("the dock does appear once §1.2 S6's conditions are met", shown === true,
  shown ? "" : "the gate never opens — the prompt would now be unreachable rather than deferred");

// ---- The assertion the fix exists for ----
for (const [label, sel] of CONTROLS) {
  const r = await hitTest(page, sel, ["installBanner"]);
  check(
    `with the install dock showing: ${label} still receives the tap`,
    r.reachable === true,
    r.error || `topmost is ${r.topDesc}${r.interceptedBy ? ` (inside #${r.interceptedBy})` : ""}`,
  );
}

// ---- Zero overlap, structurally ----
// The dock is stacked ABOVE the bar and the tabs inside #bottomNavWrap, so
// its box must end where theirs begin. Asserted on geometry rather than on
// z-index, because the point of the fix was to stop depending on z-index.
const boxes = await page.evaluate(() => {
  const r = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) };
  };
  return {
    dock: r("#installBanner"),
    bar: r("#bottomBar"),
    tabs: r("#bottomTabBar"),
    inWrap: !!document.getElementById("bottomNavWrap")?.contains(document.getElementById("installBanner")),
    dockPosition: getComputedStyle(document.getElementById("installBanner")).position,
  };
});
check("the dock is a child of #bottomNavWrap, not a fixed element of its own", boxes.inWrap, String(boxes.inWrap));
check("the dock is in normal flow (not position:fixed)", boxes.dockPosition === "static", boxes.dockPosition);
check(
  "the dock ends above the tab bar — no overlap at all, not merely a winning z-index",
  boxes.dock && boxes.tabs && boxes.dock.bottom <= boxes.tabs.top,
  JSON.stringify(boxes),
);

// ---- The control: prove all of the above can actually fail ----
// Re-creates the pre-fix geometry on the live page and re-runs the same
// hit-tests. This is what separates "the fix holds" from "the sample never
// could have broken". It runs here, while the dock is still up, rather than
// at the end: dismissInstallBanner() records the refusal — in localStorage
// now, not sessionStorage, because a session-scoped "no" came back on every
// cold open forever (persona finding B10) — and the §1.2 S6 gate honours it
// permanently, so there is no second chance to put the dock back on this
// page, and no longer even on the next one.
await page.evaluate(() => {
  const b = document.getElementById("installBanner");
  b.style.position = "fixed";
  b.style.left = "0";
  b.style.right = "0";
  b.style.bottom = "0";
  b.style.zIndex = "59";
});
await page.waitForTimeout(100);
const buried = [];
for (const [label, sel] of CONTROLS) {
  const r = await hitTest(page, sel, ["installBanner"]);
  if (r.reachable === false && r.interceptedBy === "installBanner") buried.push(label);
}
check(
  "control: re-creating the pre-fix `position:fixed;bottom:0;z-index:59` DOES bury the bottom bar",
  buried.length === CONTROLS.length,
  buried.length
    ? `buried ${buried.length}/${CONTROLS.length}: ${buried.join(", ")}`
    : "nothing was buried — this check can no longer detect the bug it guards and is not proving anything",
);
// Put the shipped geometry back before measuring anything else.
await page.evaluate(() => {
  const b = document.getElementById("installBanner");
  b.style.position = "";
  b.style.left = "";
  b.style.right = "";
  b.style.bottom = "";
  b.style.zIndex = "";
});
await page.waitForTimeout(100);

// ---- The dock must not bury the bottom of the page content either ----
// The `body:has(.install-dock[style*="block"])` rule adds
// --install-dock-reserve to #app's padding while the dock is up. Without
// it the dock is merely a taller nav that hides the last rows of whatever
// screen the member is on.
const padWithDock = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById("app")).paddingBottom));
await page.click("[data-action='dismiss-install-hint']");
await page.waitForFunction(() => document.getElementById("installBanner")?.style.display === "none", { timeout: 5000 });
const padWithout = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById("app")).paddingBottom));
check(
  "#app reserves extra bottom padding while the dock is up, and gives it back on dismiss",
  padWithDock > padWithout,
  `${padWithDock}px with dock vs ${padWithout}px without`,
);
for (const [label, sel] of CONTROLS) {
  const r = await hitTest(page, sel, ["installBanner"]);
  check(`after dismissing the dock: ${label} is reachable`, r.reachable === true, r.error || r.topDesc);
}

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\ninstall-dock-hit-check: FAILED" : "\ninstall-dock-hit-check: all checks passed");
process.exit(failed ? 1 : 0);

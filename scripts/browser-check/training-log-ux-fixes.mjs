#!/usr/bin/env node
// The four training-log UX-review findings, all of them measured at
// 390x844 in a real engine because not one of them is visible in the DOM.
//
// WHY THIS FILE HAS TO EXIST. Every one of these four is a geometry or a
// computed-style fact. jsdom has no layout engine: every
// getBoundingClientRect() it returns is 0x0 at (0,0),
// document.elementFromPoint() is not implemented at all, and
// getComputedStyle() resolves neither svh, nor clamp(), nor a colour
// written as var(--red-text). The markup was correct in all four cases, so
// `npm test` passed against every one of them and would pass again on the
// day any of them comes back.
//
//   1. THE SAVE TOAST SAT ON THE SAVE BUTTON. renderToastBar() emitted its
//      own `position:fixed; bottom:calc(env(safe-area-inset-bottom,0px) +
//      84px)` bar. At 390x844 that is y=704-760, and #bottomBarBtn - the
//      button just tapped - is y=716-768. elementFromPoint() at the save
//      button's own centre returned the toast's card for the full
//      five-second window: the confirmation covered the control it was
//      confirming and swallowed the next tap aimed at it.
//   2. NEVER-LOGGED WORE OVERDUE'S RED. renderVolumeReport()'s `diff ===
//      null` branch set the same var(--red-text) on rgba(216,69,60,.10) as
//      its `diff > 14` branch, so on a fresh install five of six category
//      rows were red before the member had done anything - and a category
//      genuinely left to lapse looked exactly like one they had simply
//      never logged.
//   3. THE ADD PHOTO PUSHED THE PICKER UNDER THE SAVE BAR.
//      .scene-page--add carried clamp(360px, 56svh, 500px) - 472.6px at
//      844, about 100px taller than every other scene. With one set
//      already logged for the day, .exercise-select landed at y=663-712
//      against a #bottomNavWrap starting at y=706.
//   4. FOUR .link-btn CONTROLS WERE 36px. One of them is a save.
//
// EVERY ASSERTION IS PAIRED WITH A CONTROL, the house rule from
// install-dock-hit-check.mjs and bidi-rtl-geometry.mjs: each fix is also
// re-broken on the live page and the same measurement is required to FAIL.
// "the save button is tappable" and "the picker is on screen" are both
// true of a page with no toast and no photo at all, so without the control
// half a green run here would prove nothing.
//
// Usage:
//   node training-log-ux-fixes.mjs                  # local working tree
//   TARGET_URL=<url> node training-log-ux-fixes.mjs # a deployed site
import { chromium } from "playwright";
import { resolveTarget } from "./lib/target.mjs";
import {
  dismissWelcomeModal,
  selectMovement,
  dismissFirstLogArrival,
  dismissCelebrationIfOpen,
  switchTab,
  consoleErrorCollector,
} from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";
import { hitTest } from "./lib/geometry.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

const VIEWPORT = { width: 390, height: 844 };
// The pre-fix values, kept here as literals so the controls below re-create
// the exact geometry that shipped, not an approximation of it.
const PREFIX_TOAST_BOTTOM = "calc(env(safe-area-inset-bottom,0px) + 84px)";
const PREFIX_ADD_PHOTO = "clamp(360px, 56svh, 500px)";
// Add's value AFTER finding 3, named so the check below can say "Calendar's
// height is not Add's" without restating a literal that would then have two
// places to drift from.
const ADD_PHOTO_AFTER = "clamp(320px, 46svh, 440px)";

const rect = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) };
  }, sel);

// Every .link-btn on the current screen, with the three properties that
// decide whether the hit area grew WITHOUT the link growing visually.
const linkButtons = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#content .link-btn")].map((el) => {
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return {
        action: el.dataset.action + (el.dataset.target ? `:${el.dataset.target}` : ""),
        height: Math.round(b.height),
        width: Math.round(b.width),
        fontSize: cs.fontSize,
        decoration: cs.textDecorationLine,
        text: (el.textContent || "").trim().slice(0, 24),
      };
    }),
  );

// Logs one set of the currently selected movement, on `date`. Driven through
// the real form - #logDateInput and the real save action - so this exercises
// the shipped path rather than a record pushed into IndexedDB behind it.
async function logSetOn(page, date) {
  await page.fill("#logDateInput", date);
  await page.dispatchEvent("#logDateInput", "change");
  await page.click("[data-action='save-set']");
  await page.waitForTimeout(300);
  await dismissCelebrationIfOpen(page);
}
const isoDaysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const target = await resolveTarget();
console.log(`Target: ${target.url}${target.local ? " (local static server)" : ""}`);
console.log(`Viewport: ${VIEWPORT.width}x${VIEWPORT.height}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = await consoleErrorCollector(page);

await installMockCloud(page);
await page.goto(target.url, { waitUntil: "networkidle" });
await page.waitForSelector("#app", { state: "visible" });
await dismissWelcomeModal(page);

// ===========================================================================
// FINDING 3 — the Add photo must not push the movement picker under the nav
// ===========================================================================
// .exercise-select IS the Add screen: nothing else on it can be used until a
// movement is chosen. "Visible without scrolling" is asserted as its box
// lying entirely above #bottomNavWrap's top edge at scrollY 0 - the fixed
// nav, not the viewport bottom, is what a member can actually see past.
console.log("\n---- finding 3: Add photo height vs the movement picker ----");
const photoToken = await page.evaluate(() =>
  getComputedStyle(document.querySelector(".scene-page--add")).getPropertyValue("--scene-photo-height").trim(),
);
check("the Add scene declares its own, reduced --scene-photo-height", photoToken.includes("46svh"), photoToken);

const otherScenePhoto = await page.evaluate(async () => {
  // The look of the other scenes is the thing finding 3 must not change, so
  // it is asserted rather than assumed: Calendar's token is read from the
  // live Calendar page, not from the stylesheet.
  document.getElementById("tabCalendarBtn").click();
  await new Promise((r) => setTimeout(r, 400));
  const el = document.querySelector(".scene-page--history");
  const v = el ? getComputedStyle(el).getPropertyValue("--scene-photo-height").trim() : null;
  document.getElementById("tabAddBtn").click();
  await new Promise((r) => setTimeout(r, 400));
  return v;
});
// UPDATED, and the assertion it makes is unchanged in substance. What this
// line pins is that finding 3 is ADD-SPECIFIC - that reducing Add's photo did
// not quietly move every other scene with it - and the way it pins that is by
// reading Calendar's own token off the live Calendar page. Calendar has since
// been reduced too, deliberately and separately (a later real-phone report:
// "the scene photo still takes almost half the screen on the workouts
// library, progress and calendar tabs"), so the value it must hold is its
// new one. The property is still "Calendar carries a height of its own,
// different from Add's", which the inequality below states directly rather
// than leaving implied by two literals.
check(
  "the other scenes keep a photo height of their own — Calendar resolves its own 33svh + 16px, not Add's",
  otherScenePhoto === "calc(33svh + 16px)",
  String(otherScenePhoto),
);
check(
  "and it is not Add's value — the two are still tuned separately",
  otherScenePhoto !== ADD_PHOTO_AFTER,
  `${otherScenePhoto} vs Add's ${ADD_PHOTO_AFTER}`,
);

await page.waitForSelector(".exercise-select", { state: "visible", timeout: 5000 });
const pickerEmpty = await rect(page, ".exercise-select");
const navEmpty = await rect(page, "#bottomNavWrap");
check(
  "with nothing chosen: the picker is fully above the bottom nav, unscrolled",
  (await page.evaluate(() => Math.round(window.scrollY))) === 0 && pickerEmpty.bottom <= navEmpty.top,
  `picker ${pickerEmpty.top}-${pickerEmpty.bottom}, nav starts ${navEmpty.top}`,
);

await selectMovement(page, "Strict");
await page.waitForSelector("#bottomBarBtn", { state: "visible", timeout: 5000 });
await logSetOn(page, new Date().toISOString().slice(0, 10));
await dismissFirstLogArrival(page);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(200);

// THE STATE THE DEFECT ACTUALLY BIT IN, and the reason this check does not
// stop at the empty screen: once the day has a set in it, the day-summary
// card and its row sit above the picker and push it down. This is what a
// member returning to log their second exercise arrives at.
const pickerLogged = await rect(page, ".exercise-select");
const navLogged = await rect(page, "#bottomNavWrap");
const scrollLogged = await page.evaluate(() => Math.round(window.scrollY));
check(
  "with one set already logged today: the picker is STILL fully above the bottom nav, unscrolled",
  scrollLogged === 0 && pickerLogged.bottom <= navLogged.top,
  `picker ${pickerLogged.top}-${pickerLogged.bottom}, nav starts ${navLogged.top}, scrollY=${scrollLogged}`,
);

// ---- control: the pre-fix photo height DOES bury it ----
await page.evaluate((v) => {
  document.querySelector(".scene-page--add").style.setProperty("--scene-photo-height", v);
}, PREFIX_ADD_PHOTO);
await page.waitForTimeout(150);
const pickerPrefix = await rect(page, ".exercise-select");
const navPrefix = await rect(page, "#bottomNavWrap");
check(
  `control: restoring ${PREFIX_ADD_PHOTO} DOES push the picker into the bottom nav`,
  pickerPrefix.bottom > navPrefix.top,
  pickerPrefix.bottom > navPrefix.top
    ? `picker ${pickerPrefix.top}-${pickerPrefix.bottom} overlaps a nav starting at ${navPrefix.top}`
    : `picker ${pickerPrefix.top}-${pickerPrefix.bottom} still clears a nav starting at ${navPrefix.top} — this check can no longer detect the bug it guards and is not proving anything`,
);
await page.evaluate(() => document.querySelector(".scene-page--add").style.removeProperty("--scene-photo-height"));
await page.waitForTimeout(150);

// ===========================================================================
// FINDING 4 — the 36px .link-btn controls
// ===========================================================================
console.log("\n---- finding 4: .link-btn tap targets ----");
const addLinks = await linkButtons(page);
check(
  "the Add screen's .link-btn controls are on screen to be measured",
  addLinks.some((l) => l.action === "view-log-date-calendar") && addLinks.some((l) => l.action === "toggle-ladder-mode"),
  JSON.stringify(addLinks.map((l) => l.action)),
);
for (const l of addLinks) {
  check(`Add: .link-btn[${l.action}] reaches the app's 44px floor`, l.height >= 44, `${l.width}x${l.height}`);
  check(
    `Add: .link-btn[${l.action}] still LOOKS like a 13px underlined link`,
    l.fontSize === "13px" || l.fontSize === "12.5px",
    `font-size ${l.fontSize}, text-decoration-line ${l.decoration}`,
  );
  check(`Add: .link-btn[${l.action}] keeps its underline`, l.decoration === "underline", l.decoration);
}

// The fourth one only exists inside the ladder/superset panel, which is why
// the review counted three: it is the same 36px control on the same screen.
await page.click("[data-action='toggle-ladder-mode']");
await page.waitForTimeout(250);
const ladderLinks = await linkButtons(page);
const partner = ladderLinks.find((l) => l.action === "open-picker:partner");
check("the superset partner picker is reachable to be measured", !!partner, JSON.stringify(ladderLinks.map((l) => l.action)));
if (partner) {
  check("Add (ladder panel): .link-btn[open-picker:partner] reaches 44px", partner.height >= 44, `${partner.width}x${partner.height}`);
  check("Add (ladder panel): it still looks like a link", partner.decoration === "underline", partner.decoration);
}

// ---- control: without the class these are 36px again ----
const strippedHeights = await page.evaluate(() => {
  const els = [...document.querySelectorAll("#content .link-btn--tap")];
  els.forEach((el) => el.classList.remove("link-btn--tap"));
  const hs = els.map((el) => ({ action: el.dataset.action, h: Math.round(el.getBoundingClientRect().height) }));
  els.forEach((el) => el.classList.add("link-btn--tap"));
  return hs;
});
check(
  "control: dropping .link-btn--tap DOES take them back under 44px",
  strippedHeights.length > 0 && strippedHeights.every((r) => r.h < 44),
  strippedHeights.length
    ? JSON.stringify(strippedHeights)
    : "nothing carried the class — the measurement above is not attributable to it",
);
await page.click("[data-action='toggle-ladder-mode']");   // leave ladder mode
await page.waitForTimeout(250);

// ===========================================================================
// FINDING 1 — elementFromPoint at the save button's centre, right after a save
// ===========================================================================
console.log("\n---- finding 1: the save toast vs the save button ----");
// The SECOND save is the one that toasts: the first entry of all is design
// spec §1.2 S4's arrival card instead, dismissed above.
await page.click("#bottomBarBtn");
await page.waitForSelector("#appToastBar", { state: "visible", timeout: 5000 });

const toastBox = await rect(page, "#appToastBar");
const barBox = await rect(page, "#bottomBar");
const btnBox = await rect(page, "#bottomBarBtn");
const wrapBox = await rect(page, "#bottomNavWrap");
console.log(
  `    toast ${toastBox.top}-${toastBox.bottom} · save bar ${barBox.top}-${barBox.bottom} · ` +
    `save button ${btnBox.top}-${btnBox.bottom} · nav wrap starts ${wrapBox.top}`,
);

// THE ASSERTION THE FIX EXISTS FOR. elementFromPoint at the centre of
// #bottomBarBtn, with the toast up, in the same tick the member would be
// reaching for it.
const hit = await hitTest(page, "#bottomBarBtn", ["appToastDock", "appToastBar"]);
check(
  "right after a save, elementFromPoint at the save button's centre returns the save button",
  hit.reachable === true,
  hit.error || `topmost is ${hit.topDesc}${hit.interceptedBy ? ` (inside #${hit.interceptedBy})` : ""}`,
);
check(
  "the toast's box ends at or above the bottom bar's top edge — no overlap to win a z-index argument over",
  toastBox.bottom <= barBox.top,
  `toast bottom ${toastBox.bottom} vs bar top ${barBox.top}`,
);
check(
  "the toast is docked inside #bottomNavWrap rather than fixed to the viewport",
  await page.evaluate(
    () =>
      !!document.getElementById("bottomNavWrap")?.contains(document.getElementById("appToastBar")) &&
      getComputedStyle(document.getElementById("appToastBar")).position === "static",
  ),
  String(await page.evaluate(() => getComputedStyle(document.getElementById("appToastBar")).position)),
);
// The tab bar is the other half of the nav and was never the reported
// casualty, so it is a second control on the same measurement.
const tabHit = await hitTest(page, "#bottomTabBar .tabbtn:first-child", ["appToastDock", "appToastBar"]);
check("with the toast up, the first tab button still receives its tap", tabHit.reachable === true, tabHit.error || tabHit.topDesc);

// ---- control: the pre-fix fixed geometry DOES intercept the save button ----
await page.evaluate((bottom) => {
  const t = document.getElementById("appToastBar");
  t.style.position = "fixed";
  t.style.left = "0";
  t.style.right = "0";
  t.style.bottom = bottom;
  t.style.zIndex = "45";
}, PREFIX_TOAST_BOTTOM);
await page.waitForTimeout(150);
const hitPrefix = await hitTest(page, "#bottomBarBtn", ["appToastDock", "appToastBar"]);
check(
  `control: re-creating the pre-fix \`position:fixed; bottom:${PREFIX_TOAST_BOTTOM}\` DOES intercept the save button`,
  hitPrefix.reachable === false,
  hitPrefix.reachable === false
    ? `topmost is ${hitPrefix.topDesc}`
    : "the save button was still reachable — this check can no longer detect the bug it guards and is not proving anything",
);
await page.evaluate(() => {
  const t = document.getElementById("appToastBar");
  if (!t) return;
  for (const p of ["position", "left", "right", "bottom", "zIndex"]) t.style.removeProperty(p);
});

// ===========================================================================
// FINDING 2 — never-logged is neutral, red is left to mean overdue
// ===========================================================================
console.log("\n---- finding 2: the calendar's volume-report flags ----");
// Three states have to be on screen at once for this to mean anything: a
// category trained today, a category trained and left to lapse, and a
// category never logged. Two of them are seeded through the real form.
await page.evaluate(() => window.scrollTo(0, 0));
await selectMovement(page, "Back Squat");
await page.waitForSelector("#bottomBarBtn", { state: "visible", timeout: 5000 });
// 45 DAYS, NOT 20. When this check was written the overdue threshold was 14
// days, so 20 was comfortably past it. It is 30 now (VOLUME_OVERDUE_DAYS, a
// later real-phone report: at 14 days a member on a block programme saw four
// of six rows red on an ordinary fortnight, which teaches that red here means
// nothing). 20 days is deliberately NEUTRAL under the new rule, so seeding it
// here would make the control below assert the absence of the very signal it
// exists to prove is present. The finding this file pins - never-logged is
// not red - is unchanged; only the fixture had to move past the new line.
await logSetOn(page, isoDaysAgo(45));
await dismissFirstLogArrival(page);

await switchTab(page, "tabCalendarBtn");
await page.waitForSelector(".report-flag", { timeout: 5000 });
const flags = await page.evaluate(() =>
  [...document.querySelectorAll(".report-row")].map((row) => {
    const flag = row.querySelector(".report-flag");
    const cs = getComputedStyle(flag);
    return {
      cat: row.querySelector("span[style*='font-weight']")?.textContent?.trim() || row.textContent.trim().slice(0, 12),
      text: flag.textContent.trim(),
      color: cs.color,
      bg: cs.backgroundColor,
    };
  }),
);
console.log("    " + flags.map((f) => `${f.cat}="${f.text}" ${f.color}`).join("  ·  "));

const overdue = flags.find((f) => f.cat === "Squat");
const recent = flags.find((f) => f.cat === "Press");
const never = flags.filter((f) => !["Squat", "Press"].includes(f.cat));

// The control, and it comes first: red has to still be on this screen. An
// assertion that never-logged "is not red" passes trivially on a screen
// with no red left anywhere, which would be a different regression of the
// same finding.
check(
  "control: a category trained 45 days ago is STILL flagged in red — red survives as the overdue signal",
  !!overdue && overdue.color === "rgb(255, 120, 105)" && overdue.bg === "rgba(216, 69, 60, 0.1)",
  overdue ? `${overdue.text} ${overdue.color} on ${overdue.bg}` : "no overdue row on screen to compare against",
);
check(
  "a category trained today is green, unchanged",
  !!recent && recent.color === "rgb(92, 187, 116)",
  recent ? `${recent.text} ${recent.color}` : "no recent row",
);
check("there are never-logged categories on screen to assert about", never.length >= 3, `${never.length} rows`);
for (const f of never) {
  check(
    `never-logged "${f.cat}" is not wearing overdue's red`,
    overdue && f.color !== overdue.color && f.bg !== overdue.bg,
    `${f.color} on ${f.bg}`,
  );
  check(
    `never-logged "${f.cat}" carries the neutral --steel treatment`,
    f.bg === "rgba(138, 143, 151, 0.1)",
    `${f.color} on ${f.bg}`,
  );
  check(
    `never-logged "${f.cat}" no longer asserts "מעולם לא" about the member`,
    f.text !== "מעולם לא" && f.text !== overdue?.text,
    `reads "${f.text}"`,
  );
}

// ===========================================================================
// BOTH THEMES — the rule these four changes had to answer to
// ===========================================================================
// CLAUDE.md's first hard rule: a colour declared in one theme block and not
// the other renders one theme's text on the other theme's background. The
// three CSS changes here are deliberately colourless (#appToastDock is
// position/pointer-events, .link-btn--tap is one min-height,
// --scene-photo-height is a length) and finding 2's new state reuses the
// --steel default that already shipped in both blocks - so there is nothing
// to duplicate. That is a claim about the stylesheet, and this is the
// measurement of it: every number and every colour above is re-read with
// data-theme pinned to each value in turn. `:root[data-theme=...]` is what
// an explicit member choice writes (theme-init.js), so it also wins over
// whatever prefers-color-scheme the runner happens to report.
console.log("\n---- both themes: the same geometry, and two legible flag palettes ----");
for (const theme of ["light", "dark"]) {
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await page.waitForTimeout(250);
  const themed = await page.evaluate(() =>
    [...document.querySelectorAll(".report-row")].map((row) => {
      const flag = row.querySelector(".report-flag");
      const cs = getComputedStyle(flag);
      return {
        cat: row.querySelector("span[style*='font-weight']")?.textContent?.trim() || "",
        text: flag.textContent.trim(),
        color: cs.color,
        bg: cs.backgroundColor,
      };
    }),
  );
  const od = themed.find((f) => f.cat === "Squat");
  const nv = themed.filter((f) => !["Squat", "Press"].includes(f.cat));
  check(
    `${theme} theme: the overdue flag still resolves to a colour at all`,
    !!od && od.color !== "" && od.color !== "rgba(0, 0, 0, 0)",
    od ? `${od.color} on ${od.bg}` : "no overdue row",
  );
  check(
    `${theme} theme: never-logged and overdue are still two different colours`,
    nv.length > 0 && nv.every((f) => f.color !== od.color),
    `never-logged ${nv[0] && nv[0].color} vs overdue ${od && od.color}`,
  );
  check(
    `${theme} theme: never-logged reads "טרם נרשם" in both, not a theme-specific string`,
    nv.every((f) => f.text === "טרם נרשם"),
    JSON.stringify(nv.map((f) => f.text)),
  );
  const themedNoteSave = await page.evaluate(() => {
    const el = document.querySelector('.link-btn[data-action="save-session-note"]');
    return el ? Math.round(el.getBoundingClientRect().height) : null;
  });
  check(`${theme} theme: the session-note save is still 44px`, themedNoteSave >= 44, String(themedNoteSave));
}
await page.evaluate(() => { delete document.documentElement.dataset.theme; });
await page.waitForTimeout(200);

// finding 4, the save: "שמירת הערה" lives on this screen.
console.log("\n---- finding 4 (cont.): the calendar's own .link-btn, which is a save ----");
const calLinks = await linkButtons(page);
const noteSave = calLinks.find((l) => l.action === "save-session-note");
check("the session-note save is on screen", !!noteSave, JSON.stringify(calLinks.map((l) => l.action)));
if (noteSave) {
  check("Calendar: .link-btn[save-session-note] reaches 44px", noteSave.height >= 44, `${noteSave.width}x${noteSave.height}`);
  check("Calendar: it still looks like a 13px underlined link", noteSave.fontSize === "13px" && noteSave.decoration === "underline",
    `${noteSave.fontSize} / ${noteSave.decoration}`);
}

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\ntraining-log-ux-fixes: FAILED" : "\ntraining-log-ux-fixes: all checks passed");
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
// Covers the "look at every tab" roadmap round: onboarding, the bell/
// notifications overlay, the streak indicator, recent-history-at-entry,
// and per-day session notes. Local-only in spirit (a fresh browser context
// is always a "fresh install" from the app's point of view, so this
// exercises the first-run paths specifically) but works against any target.
//
// Usage:
//   node roadmap.mjs                 # local working tree
//   TARGET_URL=<url> node roadmap.mjs # a deployed site
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveTarget } from "./lib/target.mjs";
import { switchTab, selectMovement, dismissCelebrationIfOpen, consoleErrorCollector } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

// Screenshots are a debugging aid, not an artifact this repo commits — the
// OS temp dir keeps this script working on any machine, not just the one
// whose path got hardcoded here originally.
const outDir = path.join(tmpdir(), "haimunia-roadmap-screenshots");
mkdirSync(outDir, { recursive: true });

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

// --- Onboarding: offered on the logging screen, never as a second gate ---
//
// REWRITTEN, design spec §1.2. This used to assert the opposite - that the
// five-screen explainer opened automatically the instant the welcome form
// was saved - which is precisely the behaviour the audit's top friction
// finding was about: two full-screen gates in a row, whose primary buttons
// both read בואו נתחיל, in front of a member who had not yet logged a rep.
// The explainer's CONTENT is unchanged and still good; what it may no
// longer be is something the member has to get past. So the assertion
// flips: after the welcome sheet, nothing opens on its own, and the tour is
// reachable by choice - which is a stronger guarantee than the old one,
// because "it opens by itself" was never something a member wanted.
await page.fill("#welcomeNameInput", "בודק סבב");
await page.click("[data-action='save-user-name']");
await page.waitForTimeout(400);
const overlaysAfterWelcome = await page.evaluate(() =>
  [...document.querySelectorAll(".modal-overlay.open")].map((el) => el.id));
check("nothing at all opens after the welcome sheet — the explainer is no longer a gate",
  overlaysAfterWelcome.length === 0, overlaysAfterWelcome.join(", "));

const tourCard = await page.evaluate(() => {
  const el = document.querySelector("#content [data-action='open-onboarding']");
  return el ? el.innerText.replace(/\s+/g, " ").trim() : null;
});
check("the logging screen offers the tour instead", !!tourCard, tourCard || "no tour card on screen");

await page.click("#content [data-action='open-onboarding']");
await page.waitForFunction(() => document.getElementById("onboardingOverlay").classList.contains("open"), { timeout: 5000 });
check("tapping the tour card opens the explainer", true);
// The label pass that goes with the sequence: no two consecutive primary
// buttons in the first run may carry the same string, which is why tapping
// through them used to feel like a screen that had not advanced.
const labels = await page.evaluate(() => ({
  welcome: document.getElementById("welcomeSaveLabel").textContent.trim(),
  explainer: document.querySelector("#onboardingOverlay [data-action='close-onboarding'].save-btn").textContent.trim(),
  reopenNote: document.getElementById("onboardingReopenNote")?.textContent.trim() || null,
}));
check("the welcome and explainer primaries no longer carry the same label",
  labels.welcome !== labels.explainer && labels.welcome !== "בואו נתחיל" && labels.explainer !== "בואו נתחיל",
  `${labels.welcome} / ${labels.explainer}`);
check("the explainer says it can be reopened, so skipping it costs nothing",
  !!labels.reopenNote, labels.reopenNote || "missing");
await page.screenshot({ path: `${outDir}/roadmap-01-onboarding.png` });
await page.click("[data-action='close-onboarding']");
await page.waitForTimeout(200);
const onboardingClosed = !(await page.evaluate(() => document.getElementById("onboardingOverlay").classList.contains("open")));
check("onboarding dismisses on tap", onboardingClosed);

const whatsNewOpen = await page.evaluate(() => document.getElementById("notificationsOverlay").classList.contains("open"));
check("no what's-new popup for a fresh install (nothing to catch up on)", !whatsNewOpen);

// --- Notifications bell ---
const badgeHiddenFresh = await page.evaluate(() => document.getElementById("notificationsBadge").style.display !== "flex");
check("bell badge shows nothing for a fresh install", badgeHiddenFresh);
await page.click("[data-action='open-notifications']");
await page.waitForTimeout(200);
// THE BELL NO LONGER OPENS AN EMPTY CHANGELOG, and this pair of checks used
// to require that it did.
//
// The self-cleaning fix this block was written for is unchanged and is still
// asserted below: the list must never dump RELEASE_NOTES' full history at a
// member who has already seen it (live report, "currently it's super old").
// What changed underneath it is the answer to a tap on a NOTIFICATIONS
// control when there is nothing to notify. Reported from a real phone: "the
// מה חדש sheet opens on the log screen with only אין עדכונים חדשים" - the
// path being the bell's fallback to this sheet on a device whose badge is
// counting community notifications the community centre cannot open.
// openNotifications({onlyIfUnseen:true}) now refuses, and the tap is
// answered with a toast instead.
const notifOpen = await page.evaluate(() => document.getElementById("notificationsOverlay").classList.contains("open"));
check("the bell does not open an empty changelog on a fresh install", !notifOpen);
const notifToast = await page.evaluate(() => (document.getElementById("appToastDock")?.textContent || "").trim());
check("and the tap is answered rather than swallowed", /אין התראות/.test(notifToast), notifToast);
// The empty state itself still has to be right, because Settings' own
// "מה חדש" row opens this sheet unconditionally - there the question is
// direct and an empty answer is the honest one. That is where the
// seen/unseen filter is now proved.
await page.evaluate(() => openNotifications());
await page.waitForTimeout(200);
const notifEmptyState = await page.evaluate(() => document.getElementById("notificationsList").textContent.trim());
check(
  "asked directly, a fresh install's list says there's nothing new rather than a wall of old history",
  notifEmptyState === "אין עדכונים חדשים",
  notifEmptyState,
);
await page.screenshot({ path: `${outDir}/roadmap-02-notifications.png` });
// The bare selector matches both the overlay backdrop div and the explicit
// close button inside it (both carry data-action="close-notifications");
// Playwright picks the first DOM match, the backdrop div, whose own click
// guard only closes when the click target is the div itself - a click at
// its center can land on real dialog content instead once that content
// grows tall enough, same class of ambiguous-selector bug already fixed
// once for the settings overlay. Scope to the real button.
await page.click("#notificationsOverlay button[data-action='close-notifications']");
await page.waitForTimeout(150);

// ---- Control: a member who genuinely HAS something to catch up on still
// sees real entries - proves the empty state just above is the seen/unseen
// filter actually working, not the list quietly being broken. ----
await page.evaluate(async () => {
  await dbSetSetting("haimunia:lastSeenVersion", "0.0.0");
  await loadLastSeenVersion();
  render();
});
await page.click("[data-action='open-notifications']");
await page.waitForTimeout(200);
const notifHasEntry = await page.evaluate(() => document.getElementById("notificationsList").textContent.includes("."));
check("control: with something genuinely unseen, the list renders real version entries", notifHasEntry);
await page.click("#notificationsOverlay button[data-action='close-notifications']");
await page.waitForTimeout(150);

// --- Streak + recent-history: log a set today, check both ---
await selectMovement(page, "Strict");
await page.fill("[data-field='weight'].stepper-val", "60");
await page.dispatchEvent("[data-field='weight'].stepper-val", "change");
await page.fill("[data-field='reps'].stepper-val", "5");
await page.dispatchEvent("[data-field='reps'].stepper-val", "change");
await page.click("[data-action='save-set']");
await page.waitForTimeout(300);
await dismissCelebrationIfOpen(page);

const streakVisible = await page.evaluate(() => document.getElementById("streakLabel").style.display === "flex");
const streakText = await page.evaluate(() => document.getElementById("streakLabel").textContent.trim());
check("streak indicator shows 1 after logging today's only set", streakVisible && streakText === "1", `visible=${streakVisible} text="${streakText}"`);
await page.screenshot({ path: `${outDir}/roadmap-03-streak.png` });

// Log a second set for the same exercise -> recent-history strip should appear.
await page.fill("[data-field='weight'].stepper-val", "65");
await page.dispatchEvent("[data-field='weight'].stepper-val", "change");
await page.click("[data-action='save-set']");
await page.waitForTimeout(300);
await dismissCelebrationIfOpen(page);
const recentText = await page.evaluate(() => document.body.textContent);
check("recent-history strip shows up after a second logged set", recentText.includes("14 הימים האחרונים"));
await page.screenshot({ path: `${outDir}/roadmap-04-recent-history.png` });

// --- Session note on the Calendar tab ---
await switchTab(page, "tabCalendarBtn");
await page.waitForTimeout(250);
await page.fill("#sessionNoteInput", "בדיקת הערה אוטומטית");
await page.click("[data-action='save-session-note']");
await page.waitForTimeout(300);
const noteConfirmShown = (await page.evaluate(() => document.body.textContent)).includes("ההערה נשמרה");
check("saving a session note shows the confirmation message", noteConfirmShown);
await page.screenshot({ path: `${outDir}/roadmap-05-session-note.png` });

// Switch away and back to a different day, then back to today, to confirm
// the note actually persisted (not just sitting in the textarea).
await page.click("[data-action='cal-prev']");
await page.waitForTimeout(200);
await page.click("[data-action='cal-next']");
await page.waitForTimeout(200);
const today = await page.evaluate(() => window.todayISO());
await page.click(`[data-action='cal-select-day'][data-date="${today}"]`);
await page.waitForTimeout(400); // note loads async from IndexedDB
const noteValueAfterRoundTrip = await page.inputValue("#sessionNoteInput");
check("session note persists after navigating away and back", noteValueAfterRoundTrip === "בדיקת הערה אוטומטית", `got "${noteValueAfterRoundTrip}"`);

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\nroadmap: FAILED" : "\nroadmap: all checks passed");
process.exit(failed ? 1 : 0);

// Batch of small, self-contained findings from a fresh-eyes product/UX
// review (a genuine first-time hands-on tour of the shipped app, not a
// code read): a near-empty nav menu, "1 ימים" grammar, and other small
// polish items grouped together the same way test/audit-ux-fixes.test.mjs
// already batches an earlier review's small findings.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

test("real-user report: the profile card that opens medals shows a visible 'מדליות' label, not only a hidden aria-label", async () => {
  const window = await bootApp();
  window.document.getElementById("navMenuBtn").click();
  const who = window.document.querySelector("#navMenuList .who");
  assert.ok(who, "the profile card renders in the nav menu");
  assert.equal(who.getAttribute("data-action"), "open-achievements");
  assert.match(who.textContent, /מדליות/, "the destination is named visibly, not only in aria-label");
});

test("the achievements screen title reads 'מדליות', not 'עיטורים'", async () => {
  const window = await bootApp();
  window.document.getElementById("navMenuBtn").click();
  window.document.querySelector(".who").click();
  await new Promise((r) => setTimeout(r, 20));
  const overlay = window.document.getElementById("achievementsOverlay");
  assert.equal(overlay.classList.contains("open"), true);
  assert.match(window.document.getElementById("achievementsTitle").textContent, /מדליות/);
  assert.doesNotMatch(overlay.textContent, /עיטור/, "the old wording is gone from the achievements screen entirely");
});

test("real-user report, root cause: opening medals or settings from the nav menu closes the menu, instead of leaving it open underneath", async () => {
  // The menu staying open behind whatever was opened from it is what made
  // Escape/back-button close the WRONG (hidden) dialog - currentAppDialog()
  // returns the first APP_DIALOGS entry whose isOpen() is true, in
  // registration order, and navMenu is registered before both achievements
  // and settings.
  const window = await bootApp();
  window.document.getElementById("navMenuBtn").click();
  window.document.querySelector(".who").click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(window.document.getElementById("achievementsOverlay").classList.contains("open"), true);
  assert.equal(window.document.getElementById("navMenuOverlay").classList.contains("open"), false,
    "the nav menu must not still be open underneath achievements");

  window.document.querySelector("[data-action='close-achievements']").click();
  window.document.getElementById("navMenuBtn").click();
  await new Promise((r) => setTimeout(r, 20));
  window.document.querySelector("[data-action='open-settings']").click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(window.document.getElementById("settingsOverlay").classList.contains("open"), true);
  assert.equal(window.document.getElementById("navMenuOverlay").classList.contains("open"), false,
    "the nav menu must not still be open underneath Settings either");
});

// Live bug hunt (2026-09-11): same root cause as the achievements/nav-menu
// bug just above, found again in a different pair - "בניית אימון מותאם
// אישית" opens the WOD builder from INSIDE the still-open WOD picker
// without closing it first. currentAppDialog() (first APP_DIALOGS match by
// registration order) kept treating the now-invisible picker as "the" open
// dialog, breaking Escape (closed the hidden picker, needed a second press
// for the visible builder) and the Tab trap (Shift+Tab from the builder's
// first control landed in the hidden picker instead of wrapping).
test("real-user report, root cause: opening the WOD builder from inside the WOD picker closes the picker, instead of leaving it open underneath", async () => {
  const window = await bootApp();
  window.document.getElementById("tabWodBtn").click();
  window.document.querySelector('[data-action="open-wod-picker"]').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(window.document.getElementById("wodPickerOverlay").classList.contains("open"), true);

  window.document.querySelector('#wodPickerOverlay [data-action="open-wod-builder"]').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(window.document.getElementById("wodBuilderOverlay").classList.contains("open"), true);
  assert.equal(window.document.getElementById("wodPickerOverlay").classList.contains("open"), false,
    "the WOD picker must not still be open underneath the builder");
});

test("real-user report: the phone back button (browser history back) closes an open dialog instead of doing nothing", async () => {
  // On a phone there is no Escape key - the equivalent gesture is the
  // Android back button / swipe, which the browser surfaces as history
  // navigation. Before this session's fix, no dialog in this app pushed
  // any history state on open, so "back" had nothing of its own to
  // consume and either did nothing or (on an installed PWA with no other
  // history) backgrounded/exited the app - reported directly as "had to
  // close the app to get back out" with achievements as the caught case,
  // but the gap was every dialog registered in APP_DIALOGS.
  const window = await bootApp();
  window.document.getElementById("navMenuBtn").click();
  window.document.querySelector(".who").click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(window.document.getElementById("achievementsOverlay").classList.contains("open"), true);

  window.history.back();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(window.document.getElementById("achievementsOverlay").classList.contains("open"), false,
    "the back button must close the open dialog, not leave it stuck open");
});

test("closing a dialog normally (its own close button) consumes the reserved back-button history entry, so a later real back-press does not land on a dead state", async () => {
  const window = await bootApp();
  window.document.getElementById("navMenuBtn").click();
  window.document.querySelector(".who").click();
  await new Promise((r) => setTimeout(r, 20));

  window.document.querySelector("#achievementsOverlay [data-action='close-achievements']").click();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(window.document.getElementById("achievementsOverlay").classList.contains("open"), false);

  // The entry reserved on open must already be consumed - a further,
  // genuinely unrelated back-press now must NOT re-trigger any dialog
  // close (there is nothing left to close), proving the reserved state
  // didn't linger for a future back-press to hit.
  let popstateCount = 0;
  window.addEventListener("popstate", () => { popstateCount++; });
  window.history.back();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(window.document.getElementById("achievementsOverlay").classList.contains("open"), false,
    "no dialog re-opens from a stray leftover history entry");
});

test("the nav menu shows an app version footer instead of ending in empty space", async () => {
  const window = await bootApp();
  window.document.getElementById("navMenuBtn").click();
  const list = window.document.getElementById("navMenuList");
  assert.match(list.textContent, /v\d+\.\d+\.\d+/, "the nav menu names the running app version");
  assert.match(list.textContent, /האימוניה/, "the footer names the app, not a bare version number");
});

test("a one-day streak reads '1 יום ברצף', not the grammatically wrong '1 ימים ברצף'", async () => {
  const window = await bootApp();
  await window.addMovement("Streak Grammar Check", "Squat");
  window.applyFieldValue("step", "weight", 40);
  window.applyFieldValue("step", "reps", 5);
  window.applyFieldValue("step", "sets", 1);
  await window.saveSet();
  window.closeCelebration();

  assert.equal(window.computeCurrentStreak(), 1, "one set logged today is a one-day streak");

  window.document.getElementById("navMenuBtn").click();
  const who = window.document.querySelector("#navMenuList .who-sub");
  assert.equal(who.textContent, "1 יום ברצף");

  const streakLabel = window.document.getElementById("streakLabel");
  assert.equal(streakLabel.getAttribute("aria-label"), "1 יום ברצף");
});

test("a near-empty progress chart (1-2 points) explains itself instead of just looking sparse", async () => {
  const window = await bootApp();
  const oneNote = window.renderChart([{ dateLabel: "01.09", est1RM: 50, isPR: true }]);
  assert.match(oneNote, /עוד 2 נתונים ותראו כאן מגמה/);

  const twoNote = window.renderChart([
    { dateLabel: "01.09", est1RM: 50, isPR: true },
    { dateLabel: "05.09", est1RM: 55, isPR: true },
  ]);
  assert.match(twoNote, /עוד 1 נתון ותראו כאן מגמה/);

  const threeNote = window.renderChart([
    { dateLabel: "01.09", est1RM: 50, isPR: true },
    { dateLabel: "05.09", est1RM: 55, isPR: true },
    { dateLabel: "09.09", est1RM: 58, isPR: true },
  ]);
  assert.doesNotMatch(threeNote, /ותראו כאן מגמה/, "the hint drops away once there's enough to actually trend");
});

// Live bug hunt (2026-09-11): saveSet() had no in-flight guard at all - a
// rapid double-tap on the save CTA (a real, easy-to-hit case on a
// touchscreen, especially post-workout) fired it twice before the first
// call's render() had visibly changed anything, each creating its own
// fresh uid() entry. Calling it twice back-to-back with no await in
// between, exactly as two overlapping click events would, is the most
// direct way to prove the guard actually blocks re-entry rather than
// merely "usually winning the race" in a real browser.
test("real-user report: rapid double-tap on save-set creates exactly one entry, not two", async () => {
  const window = await bootApp();
  await window.addMovement("Test Double-Tap Squat", "Squat");
  window.applyFieldValue("step", "weight", 60);
  window.applyFieldValue("step", "reps", 5);
  window.applyFieldValue("step", "sets", 1);
  assert.equal(window.totalLoggedEntries(), 0);
  const p1 = window.saveSet();
  const p2 = window.saveSet(); // fired before p1 has awaited anything
  await Promise.all([p1, p2]);
  assert.equal(window.totalLoggedEntries(), 1, "the second, overlapping call must be a no-op, not a second entry");
});

test("real-user report: rapid double-tap on save-wod creates exactly one entry, not two", async () => {
  const window = await bootApp();
  const wod = window.allWods()[0];
  window.document.getElementById("tabWodBtn").click();
  window.choosePickedWod(wod.id);
  window.render();
  window.setWodRx(true);
  assert.equal(window.totalLoggedEntries(), 0);
  const p1 = window.saveWod();
  const p2 = window.saveWod();
  await Promise.all([p1, p2]);
  assert.equal(window.totalLoggedEntries(), 1, "the second, overlapping call must be a no-op, not a second entry");
});

// Live bug hunt (2026-09-11): clearAllData() is triggered from inside the
// Settings sheet, which is still open at the moment it runs. Wiping the
// stored name re-triggers the mandatory Welcome modal - but it used to open
// ON TOP of the still-open Settings overlay, leaving two modal-overlays
// open at once (verified live via
// document.querySelectorAll(".modal-overlay.open")), right at the exact
// moment a member most needs a coherent, single-dialog screen.
test("real-user report: wiping all data from inside Settings does not leave Settings and Welcome open at the same time", async () => {
  const window = await bootApp();
  window.document.getElementById("navMenuBtn").click();
  window.document.querySelector('[data-action="open-settings"]').click();
  assert.equal(window.document.getElementById("settingsOverlay").classList.contains("open"), true);

  await window.clearAllData();

  const openOverlays = [...window.document.querySelectorAll(".modal-overlay.open")].map((el) => el.id);
  assert.equal(openOverlays.length, 1, `exactly one dialog should be open, found: ${openOverlays.join(", ") || "(none)"}`);
  assert.equal(window.document.getElementById("welcomeOverlay").classList.contains("open"), true, "Welcome is the one dialog that should be open, since the name was just wiped");
  assert.equal(window.document.getElementById("settingsOverlay").classList.contains("open"), false, "Settings must have been closed, not left open underneath");
});

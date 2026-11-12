// Support and bug reporting, reachable from the menu you already have open.
//
// Owner's instruction, 2026-09-17: "should be in the hamburger, so people will
// have easy access to report."
//
// It lived in one place - a row inside Settings, under עזרה - which is three
// taps and a scroll from anywhere in the app. The moment a member most needs
// to report a fault is the moment they are least inclined to go hunting for
// where. The row's own comment in renderSettingsBody records why it was added
// at all: before it existed the app had no route for "this is broken", and the
// four defects found in the first real-phone session reached a developer only
// because the tester happened to be one.
//
// It is in BOTH places now, deliberately. "Something is broken right now"
// belongs on the menu already open; "where do I get help" belongs under עזרה
// with the rest of it. Both call the same openSupport().
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

async function openNavMenu(window) {
  const opener = window.document.querySelector('[data-action="open-nav-menu"], #navMenuBtn, [data-action="toggle-nav-menu"]');
  assert.ok(opener, "the app has a hamburger button");
  opener.click();
  return window.document.getElementById("navMenuOverlay");
}

test("the hamburger offers support and bug reporting", async () => {
  const window = await bootApp();
  const overlay = await openNavMenu(window);
  assert.ok(overlay && overlay.classList.contains("open"), "the menu opened");
  const row = overlay.querySelector('[data-action="open-support"]');
  assert.ok(row, "the menu has a support row");
  assert.match(row.textContent, /תמיכה ודיווח על תקלה/);
});

test("tapping it CLOSES the menu rather than opening the sheet on top of it", async () => {
  // openSupport() already closes the nav menu - its first line - so putting
  // this row in the menu needed no dispatcher change. I added one anyway,
  // with a comment explaining the stacked-overlay bug it prevented, then
  // reverted the fix to check this test caught it and watched all five pass.
  // It could not catch anything, because there was nothing to catch.
  //
  // The assertion stays: it is the invariant that matters regardless of which
  // function upholds it, and if someone later simplifies openSupport() the
  // stacked overlays become real.
  const window = await bootApp();
  const overlay = await openNavMenu(window);
  overlay.querySelector('[data-action="open-support"]').click();

  assert.equal(window.document.getElementById("navMenuOverlay").classList.contains("open"), false,
    "the nav menu closed");
  const support = window.document.getElementById("supportOverlay");
  assert.ok(support && support.classList.contains("open"), "and the support sheet opened");
});

test("it is still in Settings too - this was an addition, not a move", async () => {
  const window = await bootApp();
  window.document.querySelector('[data-action="open-settings"]').click();
  const settings = window.document.getElementById("settingsOverlay");
  assert.ok(settings.classList.contains("open"), "settings opened");
  const rows = settings.querySelectorAll('[data-action="open-support"]');
  assert.ok(rows.length >= 1, "the original עזרה row is still there");
  assert.match(settings.textContent, /משהו לא עובד\? ספרו לנו/,
    "including its explanatory line, which the nav row does not repeat");
});

test("the desktop sidebar gets it as well - it shares renderNavSettingsRow", async () => {
  // A desktop user has no hamburger to find. Putting the row in
  // renderNavSettingsRow rather than renderNavMenuList is what covers both.
  const window = await bootApp();
  const sidebar = window.document.getElementById("desktopSidebar");
  assert.ok(sidebar, "the desktop sidebar exists in the DOM");
  assert.ok(sidebar.querySelector('[data-action="open-support"]'),
    "and carries the support row");
});

test("the two rows do not wear the same icon", async () => {
  // The first version fell back to ICONS.settingsIcon, which would have put
  // two identical gears on adjacent rows.
  const window = await bootApp();
  const overlay = await openNavMenu(window);
  const settingsRow = overlay.querySelector('[data-action="open-settings"] svg');
  const supportRow = overlay.querySelector('[data-action="open-support"] svg');
  assert.ok(settingsRow && supportRow, "both rows have an icon");
  assert.notEqual(settingsRow.innerHTML, supportRow.innerHTML,
    "adjacent rows must be distinguishable at a glance");
  assert.equal(supportRow.getAttribute("width"), settingsRow.getAttribute("width"),
    "and the same size, since both sit in the same 30px icon chip");
});

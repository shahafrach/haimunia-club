// Covers the smaller additive features from the "look at every tab" roadmap
// round: update notifications, onboarding, streak, recent-history-at-entry,
// and per-day session notes. Drives the real app the same way the rest of
// this suite does — window.<exposedFunction>(...), never a re-implementation
// of the logic under test.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

test("compareVersions orders semver-like strings numerically, not lexicographically", async () => {
  const window = await bootApp();
  assert.ok(window.compareVersions("2.1.0", "2.0.9") > 0);
  assert.equal(window.compareVersions("2.0.0", "2.0.0"), 0);
  assert.ok(window.compareVersions("1.9.9", "2.0.0") < 0);
  assert.ok(window.compareVersions("2.10.0", "2.9.0") > 0, "10 > 9 numerically, not as strings");
});

// REWRITTEN, design spec §1.2. This test used to require the opposite of
// what it now requires: that the five-screen explainer opened automatically
// the instant the welcome form was saved. That was the audit's top friction
// finding — two full-screen gates back to back, both with a primary button
// reading בואו נתחיל, in front of a member who had not yet logged a rep. The
// explainer is unchanged and still reachable; what it may no longer be is
// something a member has to get past. The fresh-install special-casing this
// test was originally written to protect (no changelog for someone who has
// never used the app) is untouched and still asserted.
test("a fresh install skips the what's-new popup, and nothing opens after the welcome sheet", async () => {
  const window = await bootApp();
  // bootApp() starts from a genuinely empty IndexedDB, so this is exactly
  // the fresh-install path init() is meant to special-case.
  assert.equal(window.document.getElementById("welcomeOverlay").classList.contains("open"), true, "welcome modal should be showing");
  assert.equal(window.document.getElementById("notificationsOverlay").classList.contains("open"), false, "no changelog for someone who's never used the app");
  assert.equal(window.document.getElementById("onboardingOverlay").classList.contains("open"), false, "the explainer is not a gate, before or after");

  window.saveWelcomeForm("בודק");

  const stillOpen = [...window.document.querySelectorAll(".modal-overlay.open")].map((el) => el.id);
  assert.deepEqual(stillOpen, [], "nothing may stand between the welcome sheet and the logging screen");
  // Not shown does not mean not offered: the explainer is now pulled from a
  // card on the logging screen, and §1.5 keeps it in Settings forever after.
  assert.match(window.renderLogTab(), /data-action="open-onboarding"/);
});

test("editing the profile later never opens the explainer either", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("בודק");
  window.openOnboarding();
  window.closeOnboarding();
  assert.equal(window.document.getElementById("onboardingOverlay").classList.contains("open"), false);

  window.openWelcomeModal(true); // "edit profile" flow
  window.saveWelcomeForm("שם חדש");
  assert.equal(window.document.getElementById("onboardingOverlay").classList.contains("open"), false, "editing the profile must not show onboarding");
});

test("computeCurrentStreak counts consecutive logged days backward; today unlogged doesn't break it", async () => {
  const window = await bootApp();
  const iso = (daysAgo) => window.localISODate(new Date(Date.now() - daysAgo * 86400000));

  assert.equal(window.computeCurrentStreak(), 0, "nothing logged yet");

  await window.addMovement("Test Streak Squat", "Squat");
  const movement = window.allMovements().find((m) => m.name === "Test Streak Squat");

  // Seed entries directly via the DB (bypasses needing to drive the date
  // picker through the UI) for today, yesterday, and 2 days ago.
  for (const daysAgo of [0, 1, 2]) {
    await window.dbPut({
      id: `seed-streak-${daysAgo}`, exerciseId: movement.id, date: iso(daysAgo),
      weight: 50, reps: 5, sets: 1, ts: Date.now() - daysAgo * 86400000, isPR: false, est1RM: 50, groupId: null,
    });
  }
  await window.reloadFromDb();
  assert.equal(window.computeCurrentStreak(), 3, "today + yesterday + 2 days ago logged");

  // Now seed 4 days ago too but leave 3 days ago empty — the gap should
  // cap the streak at the 3 unbroken days, not count through the gap.
  await window.dbPut({
    id: "seed-streak-4", exerciseId: movement.id, date: iso(4),
    weight: 50, reps: 5, sets: 1, ts: Date.now() - 4 * 86400000, isPR: false, est1RM: 50, groupId: null,
  });
  await window.reloadFromDb();
  assert.equal(window.computeCurrentStreak(), 3, "a gap at day 3 should stop the count, not skip over it");
});

test("computeCurrentStreak: today not logged yet doesn't break a streak that's otherwise unbroken", async () => {
  const window = await bootApp();
  const iso = (daysAgo) => window.localISODate(new Date(Date.now() - daysAgo * 86400000));
  await window.addMovement("Test Streak Deadlift", "Deadlift");
  const movement = window.allMovements().find((m) => m.name === "Test Streak Deadlift");
  for (const daysAgo of [1, 2, 3]) { // yesterday back through 3 days ago; today untouched
    await window.dbPut({
      id: `seed-yest-${daysAgo}`, exerciseId: movement.id, date: iso(daysAgo),
      weight: 40, reps: 5, sets: 1, ts: Date.now() - daysAgo * 86400000, isPR: false, est1RM: 40, groupId: null,
    });
  }
  await window.reloadFromDb();
  assert.equal(window.computeCurrentStreak(), 3, "today just not being logged yet shouldn't reset or exclude yesterday's streak");
});

test("recentEntriesFor respects the 14-day window and caps at 5, most recent first", async () => {
  const window = await bootApp();
  const iso = (daysAgo) => window.localISODate(new Date(Date.now() - daysAgo * 86400000));
  await window.addMovement("Test Recent Bench", "Press");
  const movement = window.allMovements().find((m) => m.name === "Test Recent Bench");

  // 7 entries inside the 14-day window (should cap at 5) + 1 outside it.
  for (let daysAgo = 0; daysAgo < 7; daysAgo++) {
    await window.dbPut({
      id: `seed-recent-${daysAgo}`, exerciseId: movement.id, date: iso(daysAgo),
      weight: 60 + daysAgo, reps: 5, sets: 1, ts: Date.now() - daysAgo * 86400000, isPR: false, est1RM: 60, groupId: null,
    });
  }
  await window.dbPut({
    id: "seed-recent-old", exerciseId: movement.id, date: iso(20),
    weight: 999, reps: 5, sets: 1, ts: Date.now() - 20 * 86400000, isPR: false, est1RM: 60, groupId: null,
  });
  await window.reloadFromDb();

  const recent = window.recentEntriesFor(movement.id);
  assert.equal(recent.length, 5, "should cap at 5 even though 7 are within the window");
  assert.ok(recent.every((e) => e.weight !== 999), "the 20-day-old entry must not appear");
  assert.equal(recent[0].weight, 60, "most recent (today, daysAgo=0) first");
});

test("session note round-trips through IndexedDB and is scoped per date", async () => {
  const window = await bootApp();
  const today = window.todayISO();

  await window.saveSessionNote(today, "  הרגשתי חזק היום  ");
  const stored = await window.dbGetSetting(`sessionNote:${today}`);
  assert.equal(stored, "הרגשתי חזק היום", "should be trimmed via the same cleanStr cap as other free-text fields");

  const otherDate = window.localISODate(new Date(Date.now() - 5 * 86400000));
  const storedOther = await window.dbGetSetting(`sessionNote:${otherDate}`);
  assert.equal(storedOther, null, "a note on one date must not leak onto another");
});

// Live bug hunt (2026-09-11): saveSessionNote() used to run every note
// through cleanStr(), which deletes \n/\r outright - a real multi-line
// reflection ("...\nהמשקל עלה\n...") was saved with its line breaks silently
// stripped and the sentences fused word-to-word, with no warning. The
// textarea (rows="3") is genuinely multi-line, so cleanMultilineStr() is now
// used instead. The control below proves this would have failed against the
// pre-fix cleanStr() behavior.
test("session note preserves line breaks instead of fusing lines together", async () => {
  const window = await bootApp();
  const today = window.todayISO();
  const typed = "הרגשתי מעולה היום\nהמשקל עלה\nבפעם הבאה להוסיף עוד סט";

  await window.saveSessionNote(today, typed);
  const stored = await window.dbGetSetting(`sessionNote:${today}`);
  assert.equal(stored, typed, "line breaks must survive a save/reload round-trip");
  assert.equal((stored.match(/\n/g) || []).length, 2, "all three lines must stay separated");

  // Control: the bug's exact failure mode, demonstrated against the old
  // sanitizer directly (not re-testing production code, just proving the
  // assertion above is not vacuous).
  const viaOldCleanStr = window.cleanStr(typed, 4000);
  assert.equal(viaOldCleanStr, "הרגשתי מעולה היוםהמשקל עלהבפעם הבאה להוסיף עוד סט", "cleanStr alone reproduces the fused-lines bug this test guards against");
});

// Coverage gap closed (full-codebase audit, "regression + coverage" pass):
// the achievements modal and the post-save celebration popup had zero
// automated coverage before this. Uses the "אתלט שלם" (well-rounded)
// milestone — logging one set in each of the five PR categories
// (ACHIEVEMENT_PR_CATEGORIES) — since it's deterministic and needs no date
// or session-count bookkeeping, unlike the streak/session-count badges.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

test("logging a set in every PR category earns the well-rounded badge and pops the celebration", async () => {
  const window = await bootApp();
  assert.equal(window.isWellRounded(), false, "should not start well-rounded");

  const categories = ["Squat", "Deadlift", "Press", "Olympic", "Pull"];
  for (const cat of categories) {
    await window.addMovement(`Test WR ${cat}`, cat);
    window.applyFieldValue("step", "weight", 40);
    window.applyFieldValue("step", "reps", 5);
    window.applyFieldValue("step", "sets", 1);
    await window.saveSet();
  }

  assert.equal(window.isWellRounded(), true, "one set in each PR category should satisfy the well-rounded rule");

  // The last save should have triggered celebrateAfterSave(), which pops
  // the celebration overlay for any badge newly earned by that save.
  assert.equal(window.document.getElementById("celebrationOverlay").classList.contains("open"), true, "earning a new badge should pop the celebration overlay");
  const medalsText = window.document.getElementById("celebrationMedals").textContent;
  assert.ok(medalsText.includes("אתלט שלם"), "the newly-earned well-rounded medal should be shown in the celebration");

  window.closeCelebration();
  assert.equal(window.document.getElementById("celebrationOverlay").classList.contains("open"), false);
});

test("the achievements modal shows the well-rounded badge as earned, and still prints its rule as a visible caption", async () => {
  const window = await bootApp();
  for (const cat of ["Squat", "Deadlift", "Press", "Olympic", "Pull"]) {
    await window.addMovement(`Test Ach ${cat}`, cat);
    window.applyFieldValue("step", "weight", 30);
    window.applyFieldValue("step", "reps", 3);
    window.applyFieldValue("step", "sets", 1);
    await window.saveSet();
  }
  window.closeCelebration();

  window.openAchievements();
  assert.equal(window.document.getElementById("achievementsOverlay").classList.contains("open"), true);
  // Match on the medal's own name exactly, not a substring search over the
  // whole badge — the capstone badge's *rule* text also mentions "אתלט שלם"
  // as one of its requirements, which a loose substring match would hit
  // first (it renders earlier in the list) and it's locked by design.
  const badge = [...window.document.querySelectorAll(".medal-badge")].find((el) => el.querySelector(".medal-name")?.textContent === "אתלט שלם");
  assert.ok(badge, "the well-rounded medal should be rendered in the achievements list");
  assert.ok(badge.classList.contains("earned"), "it should be marked earned, not locked");
  // Inverted 2026-09-15 after the first real-phone session. This assertion
  // used to require the OPPOSITE ("an earned badge should not show its unlock
  // rule as a caption") and so encoded the defect as the contract: on a touch
  // screen the earned medal was the only one on the page with no text under
  // it, because its rule lived solely in a `title` and a phone never shows a
  // title. The rule is the record of what the athlete did to earn it, which
  // is exactly the text worth keeping once unlocked.
  const rule = badge.querySelector(".medal-rule");
  assert.ok(rule, "an earned badge must still print its rule - a title alone is invisible on a touch screen");
  assert.ok(rule.textContent.trim().length > 0, "and the caption must not be empty");

  window.closeAchievements();
  assert.equal(window.document.getElementById("achievementsOverlay").classList.contains("open"), false);
});

test("a locked achievement shows its rule as a visible caption (touch screens never see the title tooltip)", async () => {
  const window = await bootApp();
  window.openAchievements();
  const locked = window.document.querySelector(".medal-badge.locked");
  assert.ok(locked, "a fresh install should have plenty of locked badges");
  assert.ok(locked.querySelector(".medal-rule"), "a locked badge must print its rule, since title tooltips never show on touch");
});

test("a plain PR with no new badge still celebrates, without a badge grid", async () => {
  const window = await bootApp();
  await window.addMovement("Test Plain PR Deadlift", "Deadlift");
  // UX-audit recalibration (design spec 5.3.1, MIN_ENTRIES_BEFORE_PR): a
  // result is only a personal record once there are 3 prior entries for the
  // exercise to beat. This test used to celebrate on the SECOND set ever
  // logged, which is the old "with no history every set is a record"
  // behaviour the audit named as the reason the word stopped meaning
  // anything. Building a real baseline first is what the test needs to say
  // now; what it asserts about the popup itself is unchanged.
  window.applyFieldValue("step", "reps", 5);
  window.applyFieldValue("step", "sets", 1);
  for (const kg of [50, 55, 60]) {
    window.applyFieldValue("step", "weight", kg);
    await window.saveSet();
    window.closeCelebration();
  }

  // A heavier set on the same movement is a PR but (on its own) shouldn't
  // complete any category/streak/milestone tier this fresh.
  window.applyFieldValue("step", "weight", 65);
  await window.saveSet();

  assert.equal(window.document.getElementById("celebrationOverlay").classList.contains("open"), true, "a plain PR alone should still pop the celebration");
  const title = window.document.getElementById("celebrationTitle").textContent;
  assert.equal(title, "שיא אישי חדש!", "a PR-only celebration should use the PR title, not the badge one");
  const prLine = window.document.getElementById("celebrationPrLine");
  assert.equal(prLine.style.display, "block");
  assert.ok(prLine.textContent.includes("Test Plain PR Deadlift"));
});

test("celebration never offers a community share button when cloud.js hasn't loaded (no community configured)", async () => {
  const window = await bootApp();
  for (const cat of ["Squat", "Deadlift", "Press", "Olympic", "Pull"]) {
    await window.addMovement(`Test NoShare ${cat}`, cat);
    window.applyFieldValue("step", "weight", 35);
    window.applyFieldValue("step", "reps", 4);
    window.applyFieldValue("step", "sets", 1);
    await window.saveSet();
  }
  assert.equal(window.document.getElementById("celebrationOverlay").classList.contains("open"), true);
  assert.equal(window.document.getElementById("celebrationShare").innerHTML, "", "with no window.isCommunitySignedIn (cloud.js absent), the share slot must stay empty");
});

test("fresh-eyes audit: categoryPRCounts and the first_pr milestone don't count a movement's first few (trivial) entries", async () => {
  const window = await bootApp();
  await window.addMovement("Trivial Count Squat", "Squat");
  window.applyFieldValue("step", "reps", 5);
  window.applyFieldValue("step", "sets", 1);

  // Same MIN_ENTRIES_BEFORE_PR=3 the celebration already enforces: the
  // first 3 entries for a movement have nothing to beat, so none of them
  // should register in categoryPRCounts() or communityMilestoneCodes()'s
  // prTotal — this used to unlock "first_pr" and show "שיאים החודש: 3" for
  // a member's very first-ever session (three sets, one movement).
  for (const kg of [40, 45, 50]) {
    window.applyFieldValue("step", "weight", kg);
    await window.saveSet();
    window.closeCelebration();
    assert.equal(window.categoryPRCounts().Squat || 0, 0,
      `entry at ${kg}kg is one of the first ${window.MIN_ENTRIES_BEFORE_PR ?? 3} for this movement and must not count as a PR`);
  }

  // The 4th entry has three real prior entries to beat — a genuine PR.
  window.applyFieldValue("step", "weight", 55);
  await window.saveSet();
  assert.equal(window.categoryPRCounts().Squat, 1, "the 4th entry, beating 3 real priors, is the movement's first real PR");
});

test("fresh-eyes audit: the Progress tab's this-month PR count excludes a movement's trivial first entries", async () => {
  const window = await bootApp();
  await window.addMovement("Trivial Count Press", "Press");
  window.applyFieldValue("step", "reps", 5);
  window.applyFieldValue("step", "sets", 1);
  for (const kg of [20, 25, 30]) {
    window.applyFieldValue("step", "weight", kg);
    await window.saveSet();
    window.closeCelebration();
  }
  window.document.getElementById("tabHistoryBtn").click();
  const prCard = [...window.document.querySelectorAll(".stat-hero")]
    .find((el) => el.querySelector(".stat-label")?.textContent === "שיאים החודש");
  assert.ok(prCard, "the this-month PR stat card renders");
  const prValue = prCard.querySelector(".stat-value").textContent.trim();
  assert.equal(prValue, "0", "three trivial first-of-movement entries in one session must read as 0 PRs, not 3");
});

test("fresh-eyes audit: the achievements screen shows a 'next medal' nudge naming the single closest countable badge", async () => {
  const window = await bootApp();
  await window.addMovement("Nudge Test Squat", "Squat");
  window.applyFieldValue("step", "weight", 40);
  window.applyFieldValue("step", "reps", 5);
  window.applyFieldValue("step", "sets", 1);
  // 4 entries: past the first_pr/trivial window (3), so the Squat bronze
  // tier (needs 3 real PRs beyond the first) has genuine, nonzero progress
  // to be the closest thing to unlock.
  for (const kg of [40, 45, 50, 55]) {
    window.applyFieldValue("step", "weight", kg);
    await window.saveSet();
    window.closeCelebration();
  }
  window.openAchievements();
  const overlay = window.document.getElementById("achievementsOverlay");
  assert.match(overlay.textContent, /המדליה הבאה שלך/, "the nudge section renders");
  assert.match(overlay.textContent, /Squat/, "it names the closest real badge, not a generic placeholder");
  assert.match(overlay.textContent, /עוד \d+ להשלמה/, "it states a concrete remaining count");
});

test("the next-medal nudge shows something meaningful even for a completely fresh account, not only once training history exists", async () => {
  const window = await bootApp();
  window.openAchievements();
  const overlay = window.document.getElementById("achievementsOverlay");
  // The lowest-threshold countable badges (a bronze PR tier needs only 3)
  // are genuinely "closest" from square one too - the nudge is not gated
  // on having any history at all, and must not silently disappear here.
  assert.match(overlay.textContent, /המדליה הבאה שלך/);
  assert.match(overlay.textContent, /עוד \d+ להשלמה/);
});

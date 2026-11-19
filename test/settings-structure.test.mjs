// Q-43a (owner approved 2026-11-18): the header is the logo and one gear; Settings is four blocks (פרופיל,
// מועדון, תצוגה, עזרה) and one "מתקדם" fold holding everything else.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

test("Settings: four blocks, then a closed 'מתקדם' with backup, transfer codes, usage, what's new, privacy, version, delete data", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  window.document.getElementById("settingsGearBtn").click();
  const doc = window.document;
  const titles = [...doc.querySelectorAll("#settingsBody .settings-pane > .settings-block > .settings-block-title")].map((t) => t.textContent);
  assert.deepEqual(titles.filter((t) => t !== "מועדון"), ["פרופיל", "תצוגה", "עזרה"], "the blocks outside the fold");
  const adv = doc.getElementById("settingsAdvanced");
  assert.equal(adv.tagName, "DETAILS");
  assert.equal(adv.open, false, "closed");
  for (const a of ["export-data", "import-data", "open-transfer-create", "open-transfer", "open-release-notes", "ask-clear"]) {
    assert.ok(adv.querySelector(`[data-action='${a}']`), a + " is under מתקדם");
  }
  assert.ok(adv.querySelector("#usageSettingsBlock"), "usage counting is under מתקדם");
  assert.ok(adv.querySelector("a[href='./privacy.html']"), "privacy is under מתקדם");
  // Q-61 (owner 2026-11-19): the version and the update check left the fold for one small card at the very bottom.
  assert.ok(!/v\d+\.\d+\.\d+/.test(adv.textContent), "the version is not inside מתקדם any more");
  const foot = doc.getElementById("settingsFooter");
  assert.match(foot.textContent, /v\d+\.\d+\.\d+/);
  assert.ok(foot.querySelector("[data-action='check-update']"), "with the update check");
  assert.equal(foot, doc.querySelector("#settingsBody .settings-pane").lastElementChild, "at the very bottom");
  assert.ok(doc.querySelector("#settingsProfileBlock [data-action='edit-user-name']"), "the name in פרופיל");
  assert.ok(doc.querySelector("#settingsHelpBlock [data-feedback-open]"), "feedback in עזרה");
});

test("an old link to the ☰ menu opens Settings; medals stay reachable from התקדמות", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const b = window.document.createElement("button");
  b.setAttribute("data-action", "open-nav-menu");
  window.document.body.appendChild(b);
  b.click();
  assert.ok(window.document.getElementById("settingsOverlay").classList.contains("open"));
  window.closeSettings();
  window.document.querySelector("[data-action='switch-tab'][data-tab='history']").click();
  const who = window.document.querySelector("#progressWho .who[data-action='open-achievements']");
  assert.ok(who, "the member's card heads התקדמות and opens medals");
  who.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(window.document.getElementById("achievementsOverlay").classList.contains("open"));
});

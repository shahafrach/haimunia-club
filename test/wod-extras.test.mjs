// Lower-priority sub-task: an optional, reference-only time cap on a WOD
// definition, and a free-text partner tag per attempt. Neither is scored or
// enforced — see sanitizeCustomWod/sanitizeWodEntry and CHANGES.md.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp, answerWodRx } from "./helpers/boot.mjs";

test("sanitizeCustomWod: a well-formed time cap round-trips; absent/zero clamps to null (no cap)", async () => {
  const window = await bootApp();
  const withCap = window.sanitizeCustomWod({ id: "w1", name: "Test Cap WOD", scoreType: "time", timeCapSeconds: 1200 });
  assert.equal(withCap.timeCapSeconds, 1200);
  const noCap = window.sanitizeCustomWod({ id: "w2", name: "Test No Cap WOD", scoreType: "time" });
  assert.equal(noCap.timeCapSeconds, null);
  const zeroCap = window.sanitizeCustomWod({ id: "w3", name: "Test Zero Cap WOD", scoreType: "time", timeCapSeconds: 0 });
  assert.equal(zeroCap.timeCapSeconds, null, "0 means no cap, not a literal 0-second cap");
});

test("createWodFromBuilder: a time-cap minutes stepper value becomes the WOD's timeCapSeconds", async () => {
  const window = await bootApp();
  window.openWodBuilder();
  window.document.getElementById("wodBuilderName").value = "Test Builder Cap WOD";
  window.document.querySelector("[data-action='builder-set-format'][data-format='time']").click();
  window.applyFieldValue("builder-time-cap", "timeCapMinutes", 20);
  window.createWodFromBuilder();

  const wod = window.allWods().find((w) => w.name === "Test Builder Cap WOD");
  assert.ok(wod);
  assert.equal(wod.timeCapSeconds, 1200);
});

test("createWodFromBuilder: leaving the time cap at 0 creates a WOD with no cap", async () => {
  const window = await bootApp();
  window.openWodBuilder();
  window.document.getElementById("wodBuilderName").value = "Test Builder No Cap WOD";
  window.document.querySelector("[data-action='builder-set-format'][data-format='amrap']").click();
  window.createWodFromBuilder();
  const wod = window.allWods().find((w) => w.name === "Test Builder No Cap WOD");
  assert.equal(wod.timeCapSeconds, null);
});

test("sanitizeWodEntry: partnerTag round-trips regardless of Rx/Scaled status", async () => {
  const window = await bootApp();
  const base = { id: "e1", wodId: "w1", date: "2024-01-01", scoreType: "load", weight: 60 };
  const rxWithTag = window.sanitizeWodEntry({ ...base, rx: true, partnerTag: "עם דנה" });
  assert.equal(rxWithTag.partnerTag, "עם דנה");
  const scaledWithTag = window.sanitizeWodEntry({ ...base, rx: false, partnerTag: "Team Blue" });
  assert.equal(scaledWithTag.partnerTag, "Team Blue");
  const noTag = window.sanitizeWodEntry({ ...base, rx: true });
  assert.equal(noTag.partnerTag, null);
});

test("saveWod: persists the partner tag and startEditWodEntry restores it; clears after a normal save", async () => {
  const window = await bootApp();
  await window.addCustomWod("Test Partner WOD", "load", "");
  const wod = window.allWods().find((w) => w.name === "Test Partner WOD");

  window.applyFieldValue("wod-step", "wodWeight", 60);
  // The partner-tag input only exists once the WOD tab is actually
  // rendered — switch to it for real, same as a user tapping the tab.
  window.document.getElementById("tabWodBtn").click();
  const partnerInput = window.document.getElementById("wodPartnerTagInput");
  partnerInput.value = "עם דנה";
  partnerInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  answerWodRx(window);
  await window.saveWod();

  const dbEntries = await window.dbLoadWodEntries();
  const saved = dbEntries.find((e) => e.wodId === wod.id);
  assert.equal(saved.partnerTag, "עם דנה");

  // Saving again without touching the input should NOT still carry the old
  // tag forward onto an unrelated new entry.
  const afterFirstSaveInput = window.document.getElementById("wodPartnerTagInput");
  assert.equal(afterFirstSaveInput.value, "", "the input should clear after a normal (non-edit) save");

  await window.startEditWodEntry(saved.id);
  const editInput = window.document.getElementById("wodPartnerTagInput");
  assert.equal(editInput.value, "עם דנה", "editing should restore the saved partner tag");
});

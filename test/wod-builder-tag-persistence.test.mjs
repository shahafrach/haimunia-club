// Architecture finding, deferred from the earlier audit: a movement
// typed into the WOD builder (e.g. "Sandbag Carry") lived only in the
// in-memory WOD_MOVEMENT_TAGS array, unlike every other "custom X"
// feature (movements, WODs), which both write through to IndexedDB - it
// vanished on reload, and re-building a similar WOD meant
// re-categorizing the same movement from scratch every time.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

function addBuilderTag(window, name, category) {
  window.openWodBuilder("");
  window.document.getElementById("wodBuilderMoveSearch").value = name;
  window.document.getElementById("wodBuilderMoveSearch").dispatchEvent(new window.Event("input", { bubbles: true }));
  window.document.querySelector(`[data-action="add-builder-movement-tag"][data-category="${category}"]`).click();
}

test("a movement typed into the WOD builder survives a reload, unlike before", async () => {
  const window = await bootApp();
  addBuilderTag(window, "Yoke Carry Custom Test", "Odd Object");
  assert.ok(window.allWodMovementTags().some((t) => t.name === "Yoke Carry Custom Test"), "the tag should exist in memory immediately after adding it");

  // Simulate a reload: pull everything back out of IndexedDB the way the
  // app does on every real page load.
  const ok = await window.reloadFromDb();
  assert.ok(ok, "reloadFromDb() must succeed");
  assert.ok(window.allWodMovementTags().some((t) => t.name === "Yoke Carry Custom Test" && t.category === "Odd Object"), "the custom movement must still exist after reloading from IndexedDB, not just in the session that created it");
});

test("clearing all data also wipes custom WOD-builder movement tags", async () => {
  const window = await bootApp();
  addBuilderTag(window, "Test Tag For Clearing", "Gymnastics");
  assert.ok(window.allWodMovementTags().some((t) => t.name === "Test Tag For Clearing"));

  await window.clearAllData();
  assert.ok(!window.allWodMovementTags().some((t) => t.name === "Test Tag For Clearing"), "the in-memory list must no longer include it");
  const stored = await window.dbLoadWodMovementTags();
  assert.equal(stored.length, 0, "the IndexedDB store itself must be cleared too, not just the in-memory array");
});

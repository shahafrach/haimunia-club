// Deep-dive audit finding: there was no way to delete a custom WOD
// definition at all — only entries logged against one. Every typo or
// one-off test WOD (e.g. this very test suite's own "Test EMOM ..." WODs,
// if run against a real profile) stuck around in the picker forever. Adds
// a delete button in the picker for custom WODs only, refusing to delete
// one with any logged history — the definition is the only thing removed,
// never someone's actual training data.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp, answerWodRx } from "./helpers/boot.mjs";

test("a custom WOD with zero logged entries can be deleted from the picker, through a confirmation step", async () => {
  const window = await bootApp();
  await window.addCustomWod("Test Delete Me", "load", "");
  const wod = window.allWods().find((w) => w.name === "Test Delete Me");

  window.openWodPicker();
  const deleteBtn = window.document.querySelector(`[data-action='delete-custom-wod'][data-id='${wod.id}']`);
  assert.ok(deleteBtn, "a never-logged custom WOD should offer a delete button in the picker");
  deleteBtn.click();

  // Security hunt round 8: this was the one delete-* action with no
  // askAppConfirm step at all - one tap deleted the WOD outright, with its
  // ✕ button sitting pixel-adjacent to the pick-wod button beside it.
  const overlay = window.document.getElementById("appConfirmOverlay");
  assert.ok(overlay, "the click opens a confirm dialog instead of deleting immediately");
  assert.ok(overlay.textContent.includes("Test Delete Me"), "the dialog names the WOD being deleted");
  assert.ok(window.allWods().some((w) => w.id === wod.id), "the WOD is still there while the dialog is open");

  window.document.querySelector('[data-action="app-confirm-yes"]').click();
  await new Promise((r) => setTimeout(r, 0)); // deleteCustomWod() is async

  assert.equal(window.allWods().find((w) => w.id === wod.id), undefined, "the WOD should be gone from allWods()");
  const stored = await window.dbLoadCustomWods();
  assert.ok(!stored.some((w) => w.id === wod.id), "it should be gone from IndexedDB too, not just in-memory");
});

test("cancelling the delete-custom-wod confirmation leaves the WOD untouched", async () => {
  const window = await bootApp();
  await window.addCustomWod("Test Cancel Delete", "load", "");
  const wod = window.allWods().find((w) => w.name === "Test Cancel Delete");

  window.openWodPicker();
  window.document.querySelector(`[data-action='delete-custom-wod'][data-id='${wod.id}']`).click();
  window.document.querySelector('[data-action="app-confirm-no"]').click();

  assert.ok(window.allWods().some((w) => w.id === wod.id), "cancelling the confirmation must not delete the WOD");
});

test("a custom WOD with logged entries offers no delete button, and deleteCustomWod refuses to touch it directly", async () => {
  const window = await bootApp();
  await window.addCustomWod("Test Keep Me", "load", "");
  const wod = window.allWods().find((w) => w.name === "Test Keep Me");
  window.applyFieldValue("wod-step", "wodWeight", 60);
  answerWodRx(window);
  await window.saveWod();

  window.openWodPicker();
  const deleteBtn = window.document.querySelector(`[data-action='delete-custom-wod'][data-id='${wod.id}']`);
  assert.equal(deleteBtn, null, "a custom WOD with logged history should not offer a delete button at all");

  // Even a direct call (bypassing the UI) must refuse — this is the
  // authoritative guard, not just a UI nicety.
  await window.deleteCustomWod(wod.id);
  assert.ok(window.allWods().some((w) => w.id === wod.id), "deleteCustomWod must refuse to delete a WOD with logged entries");
  assert.equal(window.wodEntriesFor(wod.id).length, 1, "its entry must survive untouched");
});

test("deleting the currently-selected custom WOD clears the selection instead of leaving a dangling reference", async () => {
  const window = await bootApp();
  await window.addCustomWod("Test Selected Delete", "load", "");
  const wod = window.allWods().find((w) => w.name === "Test Selected Delete");

  await window.deleteCustomWod(wod.id);

  window.document.getElementById("tabWodBtn").click();
  assert.equal(window.document.getElementById("wodLogDateInput"), null, "with the selection cleared, the log tab should fall back to its empty state, not a form for a WOD that no longer exists");
});

test("a benchmark (built-in) WOD never offers a delete button, even though it shares the picker with custom ones", async () => {
  const window = await bootApp();
  window.openWodPicker();
  const franDeleteBtn = window.document.querySelector("[data-action='delete-custom-wod'][data-id='fran']");
  assert.equal(franDeleteBtn, null, "built-in benchmarks are never deletable");

  // The authoritative guard rejects it too, not just the UI.
  await window.deleteCustomWod("fran");
  assert.ok(window.allWods().some((w) => w.id === "fran"), "deleteCustomWod must refuse anything that isn't category \"Custom\"");
});

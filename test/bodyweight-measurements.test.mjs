// Coverage gap closed (full-codebase audit): the History tab's bodyweight
// and custom-measurements sections (both nested under #tabHistoryBtn, not
// their own top-level tabs) had zero automated coverage. Drives the real
// expand/save actions and confirms the write actually lands in IndexedDB.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

// Live bug hunt (2026-09-11): saveBodyweight()/saveMeasurement() now do an
// extra IndexedDB round-trip (re-reading today's row before deciding
// update-vs-insert - see their own comments in app.js) before the actual
// write, so a single fixed `setTimeout(r, 0)` tick is no longer guaranteed
// to span the whole save. Polling (with an async check, unlike boot.mjs's
// own sync-only waitFor) for the actual expected disk state is robust to
// however many ticks the async chain now takes, and doubles as a timeout if
// a save genuinely never completes.
async function pollUntil(checkAsync, timeoutMs = 2000, intervalMs = 5) {
  const start = Date.now();
  for (;;) {
    if (await checkAsync()) return;
    if (Date.now() - start > timeoutMs) throw new Error("pollUntil timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
async function waitForBwWeight(window, weight) {
  await pollUntil(async () => {
    const rows = await window.dbLoadBodyweight();
    return rows.some((r) => r.date === window.todayISO() && r.weight === weight);
  });
}
async function waitForMeasurementValue(window, typeId, value) {
  await pollUntil(async () => {
    const rows = await window.dbLoadMeasurements();
    return rows.some((r) => r.typeId === typeId && r.date === window.todayISO() && r.value === value);
  });
}

test("logging today's bodyweight persists it and updates the collapsed row's summary", async () => {
  const window = await bootApp();
  window.document.getElementById("tabHistoryBtn").click();
  window.document.querySelector("[data-action='toggle-bodyweight']").click();

  window.applyFieldValue("bw-step", "bwWeight", 78.5);
  window.document.querySelector("[data-action='save-bw']").click();
  await waitForBwWeight(window, 78.5);

  const rows = await window.dbLoadBodyweight();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].weight, 78.5);
  assert.equal(rows[0].date, window.todayISO());

  // Collapse and re-expand: the collapsed row's summary should reflect the
  // just-saved weight, not the pre-save default.
  window.document.querySelector("[data-action='toggle-bodyweight']").click();
  const summaryText = window.document.getElementById("bodyweightArea").textContent;
  assert.ok(summaryText.includes("78.5"), "the collapsed row should show the newly-saved weight");
});

test("logging bodyweight again the same day overwrites today's entry instead of adding a second one", async () => {
  const window = await bootApp();
  window.document.getElementById("tabHistoryBtn").click();
  window.document.querySelector("[data-action='toggle-bodyweight']").click();

  window.applyFieldValue("bw-step", "bwWeight", 80);
  window.document.querySelector("[data-action='save-bw']").click();
  await waitForBwWeight(window, 80);

  window.applyFieldValue("bw-step", "bwWeight", 81);
  window.document.querySelector("[data-action='save-bw']").click();
  await waitForBwWeight(window, 81);

  const rows = await window.dbLoadBodyweight();
  assert.equal(rows.length, 1, "same-day saves should overwrite, not duplicate");
  assert.equal(rows[0].weight, 81);
});

// Live bug hunt (2026-09-11): confirmed live with two real tabs sharing one
// IndexedDB origin - the test above only covers the SAME tab saving twice,
// where the in-memory array is already up to date after the first save.
// The real bug needs a tab whose in-memory bodyweightEntries never saw the
// other tab's write - simulated here by writing "another tab's" row
// straight to IndexedDB, bypassing this window's in-memory state entirely,
// the same way a second, never-reloaded tab genuinely would.
test("logging bodyweight when another tab already saved today's row updates that row instead of creating a duplicate", async () => {
  const window = await bootApp();
  const today = window.todayISO();
  const otherTabsRow = { id: window.uid("bw"), date: today, ts: Date.now() - 60000, weight: 80 };
  await window.dbPutBodyweight(otherTabsRow); // "tab A" - never reflected in this window's in-memory state

  window.document.getElementById("tabHistoryBtn").click();
  window.document.querySelector("[data-action='toggle-bodyweight']").click();
  window.applyFieldValue("bw-step", "bwWeight", 82);
  window.document.querySelector("[data-action='save-bw']").click();
  await waitForBwWeight(window, 82);

  const rows = await window.dbLoadBodyweight();
  assert.equal(rows.length, 1, "must update the existing on-disk row for today, not create a second one");
  assert.equal(rows[0].id, otherTabsRow.id, "the existing row's id must be preserved, not replaced with a new one");
  assert.equal(rows[0].weight, 82);
});

test("logging a measurement when another tab already saved today's row updates that row instead of creating a duplicate", async () => {
  const window = await bootApp();
  window.document.getElementById("tabHistoryBtn").click();
  await window.addMeasureType("Test Waist Two Tabs");
  const type = (await window.dbLoadMeasureTypes()).find((t) => t.name === "Test Waist Two Tabs");

  const today = window.todayISO();
  const otherTabsRow = { id: window.uid("meas"), typeId: type.id, date: today, ts: Date.now() - 60000, value: 80 };
  await window.dbPutMeasurement(otherTabsRow); // "tab A" - never reflected in this window's in-memory state

  window.applyFieldValue("measure-step", type.id, 95);
  window.document.querySelector(`[data-action='save-measurement'][data-id='${type.id}']`).click();
  await waitForMeasurementValue(window, type.id, 95);

  const rows = (await window.dbLoadMeasurements()).filter((m) => m.typeId === type.id);
  assert.equal(rows.length, 1, "must update the existing on-disk row for today, not create a second one");
  assert.equal(rows[0].id, otherTabsRow.id, "the existing row's id must be preserved, not replaced with a new one");
  assert.equal(rows[0].value, 95);
});

test("adding a custom measure type, then logging and reading back a measurement", async () => {
  const window = await bootApp();
  window.document.getElementById("tabHistoryBtn").click();

  await window.addMeasureType("Test Waist");
  const typesArea = window.document.getElementById("measureArea").textContent;
  assert.ok(typesArea.includes("Test Waist"), "the new measure type should appear in the list");

  const type = (await window.dbLoadMeasureTypes()).find((t) => t.name === "Test Waist");
  assert.ok(type, "the type should be persisted");

  // addMeasureType() already expands the freshly-created type.
  window.applyFieldValue("measure-step", type.id, 82);
  window.document.querySelector(`[data-action='save-measurement'][data-id='${type.id}']`).click();
  await waitForMeasurementValue(window, type.id, 82);

  const entries = await window.dbLoadMeasurements();
  const saved = entries.find((e) => e.typeId === type.id);
  assert.ok(saved, "the measurement should be persisted");
  assert.equal(saved.value, 82);
  assert.equal(saved.date, window.todayISO());
});

test("adding a measure type with a name that already exists re-opens the existing one instead of duplicating it", async () => {
  const window = await bootApp();
  window.document.getElementById("tabHistoryBtn").click();
  await window.addMeasureType("Test Chest");
  await window.addMeasureType("test chest"); // same name, different case

  const types = await window.dbLoadMeasureTypes();
  const matches = types.filter((t) => t.name.toLowerCase() === "test chest");
  assert.equal(matches.length, 1, "re-adding the same name (case-insensitively) should not create a duplicate type");
});

test("deleting a measure type removes it and its logged measurements", async () => {
  const window = await bootApp();
  window.document.getElementById("tabHistoryBtn").click();
  await window.addMeasureType("Test Hips");
  const type = (await window.dbLoadMeasureTypes()).find((t) => t.name === "Test Hips");

  window.applyFieldValue("measure-step", type.id, 95);
  await window.saveMeasurement(type.id);
  assert.ok((await window.dbLoadMeasurements()).some((e) => e.typeId === type.id));

  await window.deleteMeasureType(type.id);

  assert.ok(!(await window.dbLoadMeasureTypes()).some((t) => t.id === type.id), "the type itself should be gone");
  assert.ok(!(await window.dbLoadMeasurements()).some((e) => e.typeId === type.id), "its measurements should be cleaned up too, not left orphaned");
});

// Go-live audit: this was "the least-guarded destructive action left in the
// app now that the entry-delete path is fixed" — tapping the bin icon
// deleted the type and every measurement under it immediately, with no
// confirmation at all. Fixed to follow the same askAppConfirm + offerUndo
// pattern askDeleteEntry already established.
test("tapping delete on a measure type asks for confirmation, names it and its measurement count, and only deletes on confirm", async () => {
  const window = await bootApp();
  window.document.getElementById("tabHistoryBtn").click();
  await window.addMeasureType("Test Waist");
  const type = (await window.dbLoadMeasureTypes()).find((t) => t.name === "Test Waist");
  window.applyFieldValue("measure-step", type.id, 80);
  await window.saveMeasurement(type.id);
  window.renderMeasureArea();

  window.document.querySelector(`[data-action="delete-measure-type"][data-id="${type.id}"]`).click();

  const dialogText = window.document.getElementById("appConfirmOverlay").textContent;
  assert.match(dialogText, /Test Waist/, "the dialog names the type being deleted, not a generic message");
  assert.match(dialogText, /1/, "the dialog names the count of measurements that will also be deleted");

  // Not deleted yet - the confirm sheet is up, nothing has happened.
  assert.ok((await window.dbLoadMeasureTypes()).some((t) => t.id === type.id), "the type must survive until the confirm button is actually pressed");

  window.document.querySelector('[data-action="app-confirm-yes"]').click();
  await new Promise((r) => setTimeout(r, 0)); // deleteMeasureType() is async

  assert.ok(!(await window.dbLoadMeasureTypes()).some((t) => t.id === type.id), "confirming deletes the type");
  assert.ok(!(await window.dbLoadMeasurements()).some((e) => e.typeId === type.id), "and its measurements");

  // The same confirm+undo parity askDeleteEntry gets: a five-second window
  // to put it back exactly as it was.
  const toastBtn = window.document.querySelector('[data-action="toast-action"]');
  assert.ok(toastBtn, "a confirmed delete offers an undo, matching every other destructive action in this app");
  toastBtn.click();
  await new Promise((r) => setTimeout(r, 0)); // restoreMeasureType() is async

  const restoredType = (await window.dbLoadMeasureTypes()).find((t) => t.id === type.id);
  assert.ok(restoredType, "undo restores the type");
  assert.equal(restoredType.name, "Test Waist");
  assert.ok((await window.dbLoadMeasurements()).some((e) => e.typeId === type.id), "and restores its measurement, not just the type");
});

test("deleting a measure type with zero logged measurements does not falsely claim any will be deleted", async () => {
  const window = await bootApp();
  window.document.getElementById("tabHistoryBtn").click();
  await window.addMeasureType("Test Empty");
  const type = (await window.dbLoadMeasureTypes()).find((t) => t.name === "Test Empty");
  window.renderMeasureArea();

  window.document.querySelector(`[data-action="delete-measure-type"][data-id="${type.id}"]`).click();
  const dialogText = window.document.getElementById("appConfirmOverlay").textContent;
  assert.match(dialogText, /Test Empty/);
  assert.doesNotMatch(dialogText, /יימחקו גם/, "no measurements exist, so the dialog should not claim any will be deleted with it");
});

// Live bug hunt (2026-09-11): unlike the measure TYPE above (and every
// other destructive action in this app), deleting a single logged
// measurement VALUE had no confirmation and no undo - one accidental tap
// on the trash icon lost a real, hand-entered data point with no recovery.
// Same askAppConfirm + offerUndo shape as the type-delete test above.
test("tapping delete on a single measurement entry asks for confirmation, names it, and offers undo - not an immediate, unrecoverable delete", async () => {
  const window = await bootApp();
  window.document.getElementById("tabHistoryBtn").click();
  await window.addMeasureType("Test Waist Entry");
  const type = (await window.dbLoadMeasureTypes()).find((t) => t.name === "Test Waist Entry");
  window.applyFieldValue("measure-step", type.id, 82.5);
  await window.saveMeasurement(type.id);
  window.renderMeasureArea();
  const entry = (await window.dbLoadMeasurements()).find((e) => e.typeId === type.id);

  window.document.querySelector(`[data-action="delete-measurement-entry"][data-id="${entry.id}"]`).click();

  const overlay = window.document.getElementById("appConfirmOverlay");
  assert.equal(overlay.classList.contains("open"), true, "a confirm dialog opens instead of deleting immediately");
  assert.match(overlay.textContent, /Test Waist Entry/, "the dialog names the measurement type, not a generic message");
  assert.match(overlay.textContent, /82\.5/, "the dialog names the value being deleted");
  assert.ok((await window.dbLoadMeasurements()).some((e) => e.id === entry.id), "not deleted yet - confirm is still pending");

  window.document.querySelector('[data-action="app-confirm-yes"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(!(await window.dbLoadMeasurements()).some((e) => e.id === entry.id), "confirming deletes the entry");

  const toastBtn = window.document.querySelector('[data-action="toast-action"]');
  assert.ok(toastBtn, "a confirmed delete offers an undo, matching every other destructive action in this app");
  toastBtn.click();
  await new Promise((r) => setTimeout(r, 0));
  const restored = (await window.dbLoadMeasurements()).find((e) => e.id === entry.id);
  assert.ok(restored, "undo restores the exact measurement");
  assert.equal(restored.value, 82.5);
});

// Live bug hunt (2026-09-11): a fresh measure type's stepper defaults to 0,
// and saveMeasurement() has always silently no-op'd at value <= 0 - with no
// UI feedback at all, a member could tap "רישום מדידה" repeatedly thinking
// it was broken. The button is disabled at 0 instead, and stays correctly
// in sync as the stepper moves (the stepper's own tap handler patches the
// DOM in place rather than doing a full render() - see FIELD_ACTIONS
// "measure-step".sync in app.js - so the disabled state has to be updated
// from that same place or it would get stuck disabled forever, not just
// while the value is genuinely 0).
test("the save-measurement button is disabled at the default 0 value, and re-enables as soon as the stepper moves off it", async () => {
  const window = await bootApp();
  window.document.getElementById("tabHistoryBtn").click();
  await window.addMeasureType("Test Calf");
  const type = (await window.dbLoadMeasureTypes()).find((t) => t.name === "Test Calf");
  window.renderMeasureArea();

  const btn = () => window.document.querySelector(`[data-action="save-measurement"][data-id="${type.id}"]`);
  assert.equal(btn().disabled, true, "a fresh type with no prior measurements starts at 0 and the button must not invite a no-op tap");

  const stepUp = window.document.querySelector(`[data-action="measure-step"][data-field="${type.id}"][data-dir="1"]`);
  assert.ok(stepUp, "the stepper's own increment control");
  stepUp.click();
  assert.equal(btn().disabled, false, "raising the value above 0 must re-enable the button immediately, via the same in-place DOM patch the stepper itself uses");

  await window.saveMeasurement(type.id);
  assert.ok((await window.dbLoadMeasurements()).some((e) => e.typeId === type.id && e.value > 0), "the now-enabled button actually saves a real value");
});



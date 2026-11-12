// COMM-364. noteStorageError() (app.js) is the one thing standing between a
// full IndexedDB and a member who believes their training log is being kept
// while every write since actually fails - it distinguishes
// QuotaExceededError from any other storage failure and surfaces a
// dedicated message ("out of storage - export a backup and delete old
// data") instead of the generic write-failed one, but nothing exercised
// that branch: every existing storage test (storage-isolation.test.mjs)
// checks naming/isolation, not failure handling. Community carries more
// storage pressure than a plain training log (avatar photos, post photos,
// cached feed/analytics data on top of the same sets/bodyweight/
// measurements every install already has), which makes a real
// quota-exceeded write more likely here, not less.
//
// dbPut() is swapped for a rejecting stand-in rather than actually filling
// fake-indexeddb to capacity - fake-indexeddb has no storage-quota
// simulation, and the real defect class this guards (silently swallowing
// the failure, or throwing past the caller and crashing the save flow) lives
// entirely in noteStorageError()/saveSet()'s own catch, not in IndexedDB
// itself.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

async function logASet(window) {
  await window.addMovement("Test Squat", "Squat");
  window.applyFieldValue("step", "weight", 40);
  window.applyFieldValue("step", "reps", 5);
  window.applyFieldValue("step", "sets", 1);
}

test("a QuotaExceededError from the write path is surfaced with the dedicated out-of-storage message, not the generic failure text", async () => {
  const window = await bootApp();
  await logASet(window);

  window.dbPut = () => {
    const e = new Error("could not perform the operation due to quota");
    e.name = "QuotaExceededError";
    return Promise.reject(e);
  };
  const errors = [];
  window.console.error = (...args) => errors.push(args.join(" "));

  // Must not throw/reject past saveSet() - a caller (the save button's
  // click handler) that awaits this with no catch of its own would crash
  // the app on every subsequent interaction if it did.
  await assert.doesNotReject(window.saveSet());

  window.openSettings();
  window.render();
  const settingsHtml = window.document.getElementById("settingsBody").innerHTML;
  assert.match(settingsHtml, /אין מקום אחסון פנוי — ייצאו גיבוי ומחקו נתונים ישנים/, "the quota-specific message must be shown, not the generic one");
  assert.match(settingsHtml, /role="alert"/, "a storage failure must be announced, not a silent color change only");
  assert.ok(errors.some((m) => /storage write failed/.test(m)), "the failure is still logged for diagnosis, not swallowed entirely");
});

test("a non-quota storage failure (e.g. a corrupted/blocked database) gets the generic failure message, not the quota-specific one", async () => {
  const window = await bootApp();
  await logASet(window);

  window.dbPut = () => Promise.reject(new Error("database connection is closing"));
  window.console.error = () => {};

  await assert.doesNotReject(window.saveSet());

  window.openSettings();
  window.render();
  const settingsHtml = window.document.getElementById("settingsBody").innerHTML;
  assert.match(settingsHtml, /השמירה במכשיר נכשלה — הנתונים האחרונים אולי לא נשמרו/, "a non-quota failure must not be mislabeled as an out-of-storage error");
  assert.doesNotMatch(settingsHtml, /אין מקום אחסון פנוי/);
});

test("a save that succeeds after a prior quota failure clears the error state back to the normal footer note", async () => {
  const window = await bootApp();
  await logASet(window);

  const realDbPut = window.dbPut;
  window.dbPut = () => { const e = new Error("quota"); e.name = "QuotaExceededError"; return Promise.reject(e); };
  window.console.error = () => {};
  await window.saveSet();
  window.openSettings();
  window.render();
  assert.match(window.document.getElementById("settingsBody").innerHTML, /אין מקום אחסון פנוי/);

  window.dbPut = realDbPut;
  window.applyFieldValue("step", "weight", 42);
  window.applyFieldValue("step", "reps", 5);
  window.applyFieldValue("step", "sets", 1);
  await window.saveSet();
  window.render();
  const recovered = window.document.getElementById("settingsBody").innerHTML;
  assert.doesNotMatch(recovered, /אין מקום אחסון פנוי/, "a later successful save must clear the earlier storage error, not leave it stuck");
});

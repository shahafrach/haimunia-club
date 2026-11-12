// Audit finding (low severity, cosmetic): clearAllData() reset 21 pieces of
// state but not the five ladderMode/ladderGroupId/ladderPrimaryId/
// ladderPartnerId/ladderBlockLabel variables. If "מחיקת כל הנתונים" was
// triggered while a ladder was active, the toggle kept showing "active"
// against a groupId that pointed at nothing once entries was emptied — not
// data corruption (currentLadderRounds() just renders "0 rounds"), but a
// stale toggle until the next ladder-ending interaction. Fixed by calling
// the existing endLadder() from clearAllData().
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

test("clearing all data ends an active ladder instead of leaving it stale", async () => {
  const window = await bootApp();
  await window.addMovement("Test Clear Ladder Squat", "Squat");
  window.toggleLadderMode();
  window.applyFieldValue("step", "weight", 40);
  window.applyFieldValue("step", "reps", 5);
  await window.saveSet();

  const isOn = () => window.document.querySelector("[data-action='toggle-ladder-mode']")?.textContent.includes("פעיל");
  assert.equal(isOn(), true, "ladder should be active after toggling it on and logging a round");

  await window.clearAllData();
  // COMM-360: clearAllData() also resets movementExplicitlyChosen, so the
  // log screen falls back to its pick-a-movement empty state - the ladder
  // toggle button itself is gone, not just inactive. Either way (gone, or
  // present-but-inactive) is a pass here: what must never happen is the
  // toggle surviving in an "active" state pointing at a groupId that no
  // longer exists.
  assert.ok(!isOn(), "clearing all data should end the ladder, not leave it advertising a groupId that points at nothing");
});



// Live bug hunt, round 9 (2026-09-11): buildBackupPayload() never included
// session notes (saveSessionNote(), stored as sessionNote:<date> settings
// rows) - confirmed live, a real hand-typed note was absent from every
// export, including the auto-downloaded safety backup taken right before
// delete-all wipes it. Now included, and restored on import.
test("a session note survives an export-then-import round trip", async () => {
  const window = await bootApp();
  const today = window.todayISO();
  await window.saveSessionNote(today, "הרגשתי מעולה היום");
  // importDataFromFile() rejects a backup with zero real records
  // regardless of note content ("לא נמצאו רישומים תקינים") - a real set
  // alongside the note keeps this test on the normal, common import path.
  await window.addMovement("Test Note Roundtrip Squat", "Squat");
  const movement = window.allMovements().find((m) => m.name === "Test Note Roundtrip Squat");
  window.choosePickedMovement(movement.id);
  window.applyFieldValue("step", "weight", 40);
  window.applyFieldValue("step", "reps", 5);
  await window.saveSet();

  const payload = await window.buildBackupPayload();
  assert.ok(payload.sessionNotes && payload.sessionNotes[today] === "הרגשתי מעולה היום",
    "the note must be present in the export payload, keyed by date");

  await window.clearAllData();
  assert.equal(await window.dbGetSetting(`sessionNote:${today}`), null, "delete-all must actually remove it locally");

  const file = { size: JSON.stringify(payload).length, text: async () => JSON.stringify(payload) };
  await window.importDataFromFile(file);
  assert.equal(await window.dbGetSetting(`sessionNote:${today}`), "הרגשתי מעולה היום", "importing the same backup must restore the note");
});

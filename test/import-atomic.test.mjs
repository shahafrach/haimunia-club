// Audit 2026-11, findings 13, 18 and 21.
//  13. Import is all or nothing: one bad record, or a transaction that aborts
//      at commit, leaves the log exactly as it was.
//  18. Import asks through the app's own confirm sheet, not window.confirm.
//  21. A backup holding only session notes is a valid backup.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp, waitFor } from "./helpers/boot.mjs";

function makeBackupFile(payload) {
  const json = JSON.stringify({ app: "box-log", version: 1, exportedAt: new Date().toISOString(), ...payload });
  return { size: json.length, text: async () => json };
}
const TWO_RECORDS = {
  customMovements: [{ id: "imp-m1", name: "Imported Curl", category: "Pull" }],
  entries: [
    { id: "imp-e1", exerciseId: "imp-m1", date: "2024-01-01", weight: 40, reps: 10, sets: 3 },
    { id: "imp-e2", exerciseId: "imp-m1", date: "2024-01-02", weight: 45, reps: 8, sets: 2 },
  ],
  sessionNotes: { "2024-01-01": "יום טוב" },
};
const settingsText = (window) => { window.openSettings(); window.render(); return window.document.getElementById("settingsBody").textContent; };

async function storePrototype(window) {
  const db = await window.openDB();
  return Object.getPrototypeOf(db.transaction("entries", "readonly").objectStore("entries"));
}

test("one record that fails to write rolls back the whole import", async () => {
  const window = await bootApp();
  window.console.error = () => {};
  await window.dbPut({ id: "existing-1", exerciseId: "back-squat", date: "2023-05-05", weight: 100, reps: 5, sets: 1, ts: 1 });
  const proto = await storePrototype(window);
  const realPut = proto.put;
  proto.put = function (rec, ...rest) {
    if (rec && rec.id === "imp-e2") throw new window.DOMException("simulated bad record", "DataError");
    return realPut.call(this, rec, ...rest);
  };
  await window.importDataFromFile(makeBackupFile(TWO_RECORDS));
  proto.put = realPut;

  const ids = (await window.dbLoadAll()).map((e) => e.id);
  assert.deepEqual(ids, ["existing-1"], "neither imported entry stayed; the existing one is untouched");
  assert.equal((await window.dbLoadMovements()).length, 0, "the movement written before the bad record was rolled back too");
  assert.equal(await window.dbGetSetting("sessionNote:2024-01-01"), null, "and the note");
  assert.match(settingsText(window), /הייבוא נכשל — לא יובא דבר/, "the member is told nothing was imported");
});

test("a transaction that aborts at commit (quota) imports nothing and says so", async () => {
  const window = await bootApp();
  window.console.error = () => {};
  const proto = await storePrototype(window);
  const realPut = proto.put;
  let aborted = false;
  proto.put = function (...args) {
    const req = realPut.apply(this, args);
    const tx = this.transaction;
    if (!aborted) req.addEventListener("success", () => { aborted = true; try { tx.abort(); } catch (e) {} });
    return req;
  };
  await window.importDataFromFile(makeBackupFile(TWO_RECORDS));
  proto.put = realPut;
  assert.equal((await window.dbLoadAll()).length, 0);
  assert.equal((await window.dbLoadMovements()).length, 0);
  assert.match(settingsText(window), /הייבוא נכשל — לא יובא דבר/);
});

test("a backup holding only session notes imports them instead of being rejected", async () => {
  const window = await bootApp();
  await window.importDataFromFile(makeBackupFile({ sessionNotes: { "2025-02-03": "הערה בלבד", "2025-02-04": "עוד אחת" } }));
  assert.equal(await window.dbGetSetting("sessionNote:2025-02-03"), "הערה בלבד");
  assert.equal(await window.dbGetSetting("sessionNote:2025-02-04"), "עוד אחת");
  const text = settingsText(window);
  assert.doesNotMatch(text, /לא נמצאו רישומים תקינים/);
  assert.match(text, /יובאו 2 הערות אימון/);
});

test("a backup with nothing usable in it is still rejected", async () => {
  const window = await bootApp();
  await window.importDataFromFile(makeBackupFile({ entries: [], sessionNotes: {} }));
  assert.match(settingsText(window), /לא נמצאו רישומים תקינים/);
});

test("import asks through the app's confirm sheet, and cancelling writes nothing", async () => {
  const window = await bootApp({ autoConfirmImport: false });
  window.confirm = () => { throw new Error("window.confirm must not be used"); };
  const done = window.importDataFromFile(makeBackupFile(TWO_RECORDS));
  const sheet = await waitFor(() => window.document.querySelector("#appConfirmOverlay[data-confirm-kind='import-backup']"), 2000, 5, "the import confirm sheet");
  assert.match(sheet.textContent, /לייבא 3 רישומים\?/);
  assert.match(sheet.textContent, /לייבא/);
  sheet.querySelector("[data-action='app-confirm-no']").click();
  await done;
  assert.equal((await window.dbLoadAll()).length, 0);
  assert.match(settingsText(window), /הייבוא בוטל/);
});

test("accepting the sheet imports everything in one go", async () => {
  const window = await bootApp({ autoConfirmImport: false });
  const done = window.importDataFromFile(makeBackupFile(TWO_RECORDS));
  const sheet = await waitFor(() => window.document.querySelector("#appConfirmOverlay[data-confirm-kind='import-backup']"));
  sheet.querySelector("[data-action='app-confirm-yes']").click();
  await done;
  assert.deepEqual((await window.dbLoadAll()).map((e) => e.id).sort(), ["imp-e1", "imp-e2"]);
  assert.equal(await window.dbGetSetting("sessionNote:2024-01-01"), "יום טוב");
  assert.match(settingsText(window), /יובאו 3 רישומים, יובאה הערת אימון אחת/);
});

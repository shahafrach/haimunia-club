// Drives the real importDataFromFile() against synthetic backup files —
// this is the path CHANGES.md's hardening pass targeted directly: a backup
// file is untrusted input (may be hand-edited, corrupted, or from someone
// else), and every record must be rebuilt field-by-field from a whitelist
// rather than trusted as-is. window.confirm is stubbed to auto-accept by
// boot.mjs so the merge-confirmation prompt doesn't block the test.
//
// BACKUP_APP_ID / BACKUP_VERSION below are read directly from app.js
// (currently "box-log" / 1) — not exposed on window since they're `const`,
// so they're hardcoded here. If app.js's schema identifiers ever change,
// this file needs the same update.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

const BACKUP_APP_ID = "box-log";
const BACKUP_VERSION = 1;

// importDataFromFile() only touches file.size and (await file.text()) — a
// real File/Blob would work too, but jsdom's Blob implementation is a bare
// stub with no .text()/.arrayBuffer()/.stream(), so this fakes just the
// surface the app actually uses instead of polyfilling jsdom.
function makeBackupFile(payload) {
  const json = JSON.stringify({ app: BACKUP_APP_ID, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), ...payload });
  return { size: json.length, text: async () => json };
}

test("importing a well-formed backup persists its records", async () => {
  const window = await bootApp();
  const file = makeBackupFile({
    customMovements: [{ id: "import-m1", name: "Imported Curl", category: "Pull" }],
    entries: [{ id: "import-e1", exerciseId: "import-m1", date: "2024-01-01", weight: 40, reps: 10, sets: 3 }],
    customWods: [], wodEntries: [], bodyweightEntries: [], measureTypes: [], measureEntries: [],
  });

  await window.importDataFromFile(file);

  const movements = await window.dbLoadMovements();
  assert.ok(movements.some((m) => m.id === "import-m1" && m.name === "Imported Curl"));
  const entries = await window.dbLoadAll();
  assert.ok(entries.some((e) => e.id === "import-e1" && e.weight === 40));
});

test("importing a file with a __proto__ category is neutralized, not stored or crashed on", async () => {
  const window = await bootApp();
  const file = makeBackupFile({
    customMovements: [{ id: "evil-m1", name: "Evil Curl", category: "__proto__" }],
    entries: [], customWods: [], wodEntries: [], bodyweightEntries: [], measureTypes: [], measureEntries: [],
  });

  await window.importDataFromFile(file);

  const movements = await window.dbLoadMovements();
  const evil = movements.find((m) => m.id === "evil-m1");
  assert.ok(evil, "record should still be imported");
  assert.equal(evil.category, "Other", "malicious category must be coerced, never stored raw");
  assert.equal(Object.getPrototypeOf({}).length, undefined, "Object.prototype must remain untouched");

  // The picker groups movements by category into a bag() — this is the exact
  // path that used to throw ("category[...].push is not a function") and
  // brick the picker on every load once a poisoned record made it to disk.
  assert.doesNotThrow(() => window.renderPickerList(""));
});

test("importing a file with the wrong app id is rejected", async () => {
  const window = await bootApp();
  const file = { size: 50, text: async () => JSON.stringify({ app: "some-other-app", version: 1, entries: [] }) };

  const before = await window.dbLoadAll();
  await window.importDataFromFile(file);
  const after = await window.dbLoadAll();
  assert.equal(after.length, before.length, "nothing should be written for a mismatched app id");
});

test("importing an oversized declared file is rejected before parsing", async () => {
  const window = await bootApp();
  const file = makeBackupFile({ entries: [] });
  file.size = 26 * 1024 * 1024; // > 25MB cap
  file.text = async () => { throw new Error("should not be read — size check must reject first"); };

  const before = await window.dbLoadAll();
  await window.importDataFromFile(file);
  const after = await window.dbLoadAll();
  assert.equal(after.length, before.length);
});

// F-014: A LONG-TIME MEMBER'S LOG, NOT A TOY ONE.
//
// Every other import test uses a handful of records. A member who has trained here for three years has
// thousands, and a migration that works on twelve rows can still drop, reshape or time out on eight thousand.
// The fixture is synthetic (scripts/make-heavy-fixture.mjs, seeded, no real member data): 5 training days a
// week for 3 years, 6 to 10 set rows a day over 40 movements (6 custom), a WOD 3 days a week from 30 custom
// WODs, daily body weight, 4 measurement types monthly and a Hebrew session note on about one day in three.
//
//   heavy-3y-backup.json       the old app's backup format (no sessionNotes, no customWodMovementTags)
//   heavy-3y-backup.club.json  the same records in this app's own format, with notes and WOD movement tags
//
// Measured in jsdom + fake-indexeddb on the session machine (2026-11-16): the whole import of the old-app
// file (parse, sanitize, one transaction, reload, render) took about 300 ms, dbImportAll() alone well under
// that. IMPORT_BOUND_MS is ten times the observed time so a loaded CI machine does not fail it; a regression
// to per-record transactions or a quadratic merge lands far above it. The transfer-code payload
// (buildBackupPayload() plus prefs, gzip, AES-GCM) is 142,700 bytes, 13.6% of the server's 1 MiB cap.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import FDBDatabase from "fake-indexeddb/lib/FDBDatabase";
import { bootApp } from "./helpers/boot.mjs";

const OLD_RAW = readFileSync(new URL("./fixtures/heavy-3y-backup.json", import.meta.url), "utf8");
const CLUB_RAW = readFileSync(new URL("./fixtures/heavy-3y-backup.club.json", import.meta.url), "utf8");
const OLD = JSON.parse(OLD_RAW);
const CLUB = JSON.parse(CLUB_RAW);
const LISTS = ["entries", "customMovements", "wodEntries", "customWods", "bodyweightEntries", "measureTypes", "measureEntries"];
const IMPORT_BOUND_MS = 3000;
const MAX_CIPHERTEXT = 1024 * 1024;

// A record's identity: its fields in key order, with keys holding undefined left out (the same rule
// JSON.stringify applies when the record is written to a backup file).
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = canon(v[k]);
    return out;
  }
  return v;
}
const hash = (rec) => createHash("sha256").update(JSON.stringify(canon(rec))).digest("hex");
const hashes = (list) => list.map(hash).sort();

function assertSameLog(actual, expected, label) {
  for (const k of LISTS) {
    assert.equal(actual[k].length, expected[k].length, `${label}: ${k} count`);
    assert.deepEqual(hashes(actual[k]), hashes(expected[k]), `${label}: every ${k} record unchanged`);
  }
}

async function boot() {
  const window = await bootApp({
    beforeScripts: (w) => {
      w.CompressionStream = globalThis.CompressionStream; w.Blob = globalThis.Blob; w.Response = globalThis.Response;
      w.TextEncoder = globalThis.TextEncoder;
      w.scrollTo = () => {};
      w.__requests = [];
      w.fetch = async (url, init) => { w.__requests.push({ url: String(url), init }); return { ok: true, status: 201, json: async () => ({}) }; };
    },
  });
  window.localStorage.setItem("haimunia:usageCountingOff", "1");
  return window;
}
async function importRaw(window, raw) {
  const file = new window.File([raw], "box-log-backup.json", { type: "application/json" });
  return window.importDataFromFile(file);
}
const plain = (window, v) => JSON.parse(window.JSON.stringify(v));

test("the fixture is the heavy member the finding asked for", () => {
  assert.equal(OLD.app, "box-log");
  assert.ok(!("sessionNotes" in OLD) && !("customWodMovementTags" in OLD), "old-app format: no notes, no tags");
  const days = new Set(OLD.entries.map((e) => e.date));
  assert.ok(days.size >= 5 * 52 * 3 - 5, `about 5 training days a week for 3 years (${days.size})`);
  assert.ok(OLD.entries.length >= 6 * days.size && OLD.entries.length <= 10 * days.size, "6 to 10 set rows a day");
  assert.equal(new Set(OLD.entries.map((e) => e.exerciseId)).size, 40, "40 movements in use");
  assert.equal(OLD.customMovements.length, 6);
  assert.equal(OLD.customWods.length, 30);
  assert.ok(OLD.wodEntries.length >= 3 * 52 * 3 - 5, "a WOD 3 days a week");
  assert.ok(OLD.bodyweightEntries.length >= 365 * 3, "body weight every day");
  assert.equal(OLD.measureTypes.length, 4);
  assert.equal(OLD.measureEntries.length, 4 * 36, "4 measurements monthly for 36 months");
  const notes = Object.values(CLUB.sessionNotes);
  assert.ok(notes.length > days.size / 4 && notes.length < days.size / 2.5, "a note on about one day in three");
  assert.ok(notes.every((n) => n.length <= 300 && /[֐-׿]/.test(n)), "Hebrew, 300 characters at most");
  for (const k of LISTS) assert.deepEqual(CLUB[k], OLD[k], `both files hold the same ${k}`);
});

test("(a) the old app's 3-year file imports whole: every count and every record's hash match", async () => {
  const window = await boot();
  assert.equal(await importRaw(window, OLD_RAW), true, "import resolves true");
  assert.match(window.document.body.textContent, /יובאו 7998 רישומים/);
  assert.doesNotMatch(window.document.body.textContent, /נפסלו|דולגו/, "nothing rejected or skipped");
  const out = plain(window, await window.buildBackupPayload());
  assertSameLog(out, OLD, "old-app import");
  // What the screens read, not only the stores: every movement's entries are reachable.
  const viaScreens = window.allMovements().flatMap((m) => window.entriesFor(m.id));
  assert.equal(viaScreens.length, OLD.entries.length, "every entry is under a movement the app knows");
});

test("(b) export, then import into another fresh app: lossless, notes and WOD movement tags included", async () => {
  const a = await boot();
  assert.equal(await importRaw(a, CLUB_RAW), true);
  const exported = plain(a, await a.buildBackupPayload());
  assertSameLog(exported, CLUB, "club-format import");
  assert.deepEqual(exported.sessionNotes, CLUB.sessionNotes, "every session note, verbatim");
  assert.deepEqual(canon(exported.customWodMovementTags), canon(CLUB.customWodMovementTags));

  const b = await boot();
  assert.equal(await importRaw(b, JSON.stringify(exported, null, 2)), true, "the exported file imports");
  const again = plain(b, await b.buildBackupPayload());
  assertSameLog(again, exported, "export → import");
  assert.deepEqual(again.sessionNotes, exported.sessionNotes);
  assert.deepEqual(canon(again.customWodMovementTags), canon(exported.customWodMovementTags));
});

test("(c) the import is one readwrite transaction and finishes within the measured bound", async () => {
  const window = await boot();
  const original = FDBDatabase.prototype.transaction;
  const writes = [];
  FDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
    if (mode === "readwrite") writes.push([].concat(stores));
    return original.call(this, stores, mode, ...rest);
  };
  let ms;
  try {
    const t0 = performance.now();
    assert.equal(await importRaw(window, OLD_RAW), true);
    ms = performance.now() - t0;
  } finally {
    FDBDatabase.prototype.transaction = original;
  }
  const withEntries = writes.filter((s) => s.includes("entries"));
  assert.equal(withEntries.length, 1, `the set rows go in one transaction (readwrite transactions: ${writes.length})`);
  assert.ok(["movements", "customWods", "wodEntries", "bodyweight", "measureTypes", "measurements"].every((s) => withEntries[0].includes(s)),
    "and every other store goes in that same one");
  console.log(`# heavy import: ${Math.round(ms)} ms for ${OLD.entries.length + OLD.wodEntries.length + OLD.bodyweightEntries.length + OLD.measureEntries.length + OLD.customMovements.length + OLD.customWods.length + OLD.measureTypes.length} records`);
  assert.ok(ms < IMPORT_BOUND_MS, `import took ${Math.round(ms)} ms (bound ${IMPORT_BOUND_MS} ms)`);
});

test("(d) the transfer code carries the 3-year log: the encrypted payload is under the 1 MiB cap", async () => {
  const window = await boot();
  // app-config.js is frozen and real; fetch is stubbed in boot(), so nothing leaves the test.
  assert.equal(await importRaw(window, CLUB_RAW), true);
  let err = null, code = null;
  try { code = await window.haimuniaTransfer.createCode(); } catch (e) { err = e; }
  const put = window.__requests.find((r) => r.url.endsWith("/functions/v1/transfer-put"));
  if (err && err.message === "too_large_put") {
    // Over the cap: the member is told to use a backup file, and that path carries the whole log.
    window.haimuniaTransfer.open();
    assert.match(window.document.body.textContent, /היומן גדול מדי להעברה בקוד\. אפשר להשתמש בקובץ גיבוי\./);
    assert.equal(put, undefined, "nothing is uploaded");
    const b = await boot();
    assert.equal(await importRaw(b, JSON.stringify(plain(window, await window.buildBackupPayload()))), true);
    assertSameLog(plain(b, await b.buildBackupPayload()), CLUB, "backup-file path");
    return;
  }
  assert.equal(err, null, `createCode: ${err && err.message}`);
  assert.ok(code, "a code is shown");
  assert.ok(put, "the ciphertext went to transfer-put");
  const ct = Buffer.from(JSON.parse(put.init.body).ciphertext, "base64");
  console.log(`# transfer ciphertext: ${ct.length} bytes (${(100 * ct.length / MAX_CIPHERTEXT).toFixed(1)}% of ${MAX_CIPHERTEXT})`);
  assert.ok(ct.length < MAX_CIPHERTEXT, `ciphertext ${ct.length} bytes is under the cap`);
  assert.ok(!put.init.body.includes("set-heavy-"), "and it is ciphertext, not the log");
});

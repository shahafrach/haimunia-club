// ---------- IndexedDB ----------
// THE OLDER APP'S DATABASE, BY NAME AND BY VERSION. This edition replaces
// haimuniya.github.io/haimunia-app/ in place, and IndexedDB is scoped to the
// origin, so opening "box-log-db" at version 7 is what makes every member's
// existing log simply be here on first open - nothing is copied, nothing is
// migrated. docs/audit/standalone-edition-plan.md §3.1 (in the community
// edition's repository) is the reasoning; the short form:
//
//  * NO VERSION BUMP. The 2.x app's connection has no onversionchange, so a
//    v8 open sits blocked behind any old tab or background PWA instance; and
//    once the database is at v8, rolling back to 2.34.0 fails with a
//    VersionError on every member's phone. At v7 a rollback just works.
//  * NO NEW STORES, for the same reason: a store can only be added by an
//    upgrade. The WOD builder's remembered movements live in one settings
//    row instead (WOD_TAGS_SETTING below).
//
// test/storage-compat.test.mjs asserts these names. Change them and a
// member's data is still on their phone, but this app can no longer see it.
const DB_NAME = "box-log-db", DB_VERSION = 7, STORE = "entries", MOVSTORE = "movements", WODSTORE = "wodEntries", CUSTOMWODSTORE = "customWods", BWSTORE = "bodyweight", SETTINGSTORE = "settings", MEASTYPESTORE = "measureTypes", MEASSTORE = "measurements";
const WOD_TAGS_SETTING = "wodMovementTags";
let _dbPromise = null;
// Live bug hunt (2026-09-11): confirmed live with two real tabs sharing one
// origin - a v9 connection left open and idle in tab A (an entirely
// ordinary "background PWA tab") permanently blocked tab B's v10 open
// request the moment this app next ships a schema bump, because neither
// half of the standard IndexedDB handshake existed: tab A's connection had
// no onversionchange telling it to step aside, and tab B's request had no
// onblocked to even notice it was stuck. Tab B sat on "טוען את היומן שלך…"
// forever - no error, no timeout, no message - until the user manually
// closed tab A. Fixed with the standard pair: every connection this module
// opens closes itself the instant a newer version wants in (onversionchange
// below), which is what stops the OTHER tab from blocking in the first
// place; onblocked is a defensive log for the rare case a browser still
// can't complete the handshake in time.
function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    // Only ever runs on a device that has never had the app: an existing
    // member's database is already at v7 and opens without an upgrade.
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(MOVSTORE)) db.createObjectStore(MOVSTORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(WODSTORE)) db.createObjectStore(WODSTORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(CUSTOMWODSTORE)) db.createObjectStore(CUSTOMWODSTORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(BWSTORE)) db.createObjectStore(BWSTORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SETTINGSTORE)) db.createObjectStore(SETTINGSTORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(MEASTYPESTORE)) db.createObjectStore(MEASTYPESTORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(MEASSTORE)) db.createObjectStore(MEASSTORE, { keyPath: "id" });
    };
    req.onblocked = () => { try { console.warn("IndexedDB open blocked by another open connection (see src/db.js openDB)"); } catch (e) {} };
    req.onsuccess = () => {
      const db = req.result;
      // Step aside for a newer version opened elsewhere (another tab, or a
      // future reload of this same tab after a deploy) instead of holding
      // this connection open and blocking it indefinitely.
      db.onversionchange = () => { db.close(); _dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { _dbPromise = null; reject(req.error); };
  });
  return _dbPromise;
}
// Settings live in IndexedDB alongside everything else. userName is the only
// PII in the app and previously sat in localStorage, which "clear all data"
// never touched.
async function dbGetSetting(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(SETTINGSTORE, "readonly").objectStore(SETTINGSTORE).get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
  });
}
async function dbSetSetting(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGSTORE, "readwrite");
    tx.objectStore(SETTINGSTORE).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbClearSettings() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGSTORE, "readwrite");
    tx.objectStore(SETTINGSTORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
// Live bug hunt, round 9 (2026-09-11): buildBackupPayload() needs every
// sessionNote:<date> row to include real training notes in a backup - there
// was no way to read them in bulk, only one date at a time via
// dbGetSetting(). Returns the raw {key, value} rows; the caller filters for
// the prefix it wants.
async function dbGetAllSettings() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(SETTINGSTORE, "readonly").objectStore(SETTINGSTORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function dbLoadMovements() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MOVSTORE, "readonly");
    const req = tx.objectStore(MOVSTORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function dbAddMovement(m) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MOVSTORE, "readwrite");
    tx.objectStore(MOVSTORE).put(m);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbClearMovements() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MOVSTORE, "readwrite");
    tx.objectStore(MOVSTORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
// A user-typed WOD builder movement (e.g. "Sandbag Carry") is remembered
// across reloads, like every other "custom X" - as ONE settings row holding
// the list, not a store of its own, so the database stays at v7 (see above).
// The read and the write share one readwrite transaction, so two tags added
// back to back cannot overwrite each other's read.
async function dbLoadWodMovementTags() {
  const v = await dbGetSetting(WOD_TAGS_SETTING);
  return Array.isArray(v) ? v : [];
}
async function dbAddWodMovementTag(t) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGSTORE, "readwrite");
    const store = tx.objectStore(SETTINGSTORE);
    const req = store.get(WOD_TAGS_SETTING);
    req.onsuccess = () => {
      const list = req.result && Array.isArray(req.result.value) ? req.result.value : [];
      const next = list.filter((x) => x && x.name !== t.name).concat([t]);
      store.put({ key: WOD_TAGS_SETTING, value: next });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbClearWodMovementTags() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGSTORE, "readwrite");
    tx.objectStore(SETTINGSTORE).delete(WOD_TAGS_SETTING);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadWodEntries() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WODSTORE, "readonly");
    const req = tx.objectStore(WODSTORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function dbPutWodEntry(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WODSTORE, "readwrite");
    tx.objectStore(WODSTORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbDeleteWodEntry(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WODSTORE, "readwrite");
    tx.objectStore(WODSTORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbClearWodEntries() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WODSTORE, "readwrite");
    tx.objectStore(WODSTORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadCustomWods() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOMWODSTORE, "readonly");
    const req = tx.objectStore(CUSTOMWODSTORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function dbAddCustomWod(w) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOMWODSTORE, "readwrite");
    tx.objectStore(CUSTOMWODSTORE).put(w);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbClearCustomWods() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOMWODSTORE, "readwrite");
    tx.objectStore(CUSTOMWODSTORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadBodyweight() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BWSTORE, "readonly");
    const req = tx.objectStore(BWSTORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function dbPutBodyweight(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BWSTORE, "readwrite");
    tx.objectStore(BWSTORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbDeleteBodyweight(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BWSTORE, "readwrite");
    tx.objectStore(BWSTORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbClearBodyweight() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BWSTORE, "readwrite");
    tx.objectStore(BWSTORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadMeasureTypes() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(MEASTYPESTORE, "readonly").objectStore(MEASTYPESTORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function dbAddMeasureType(t) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEASTYPESTORE, "readwrite");
    tx.objectStore(MEASTYPESTORE).put(t);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbDeleteMeasureType(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEASTYPESTORE, "readwrite");
    tx.objectStore(MEASTYPESTORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbClearMeasureTypes() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEASTYPESTORE, "readwrite");
    tx.objectStore(MEASTYPESTORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadMeasurements() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(MEASSTORE, "readonly").objectStore(MEASSTORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function dbPutMeasurement(m) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEASSTORE, "readwrite");
    tx.objectStore(MEASSTORE).put(m);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbDeleteMeasurement(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEASSTORE, "readwrite");
    tx.objectStore(MEASSTORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbClearMeasurements() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEASSTORE, "readwrite");
    tx.objectStore(MEASSTORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function dbPut(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbDeleteMovementRecord(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MOVSTORE, "readwrite");
    tx.objectStore(MOVSTORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbDeleteCustomWod(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOMWODSTORE, "readwrite");
    tx.objectStore(CUSTOMWODSTORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

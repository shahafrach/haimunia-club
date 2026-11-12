// A MEMBER'S PHONE, THE MORNING AFTER THE UPDATE.
//
// test/fixtures/v2.34.0-device.json is what the 2.34.0 app - the one members
// have today - leaves on a device: every IndexedDB store of "box-log-db" v7
// and every localStorage key, produced by driving that app's own code (see
// scripts/v2-device-snapshot.mjs), not written by hand. It holds PRs, a
// ladder, a superset, a timed hold on a custom movement, Fran, Cindy, a
// custom EMOM with a rest minute and a timed station, bodyweight, a custom
// measurement, a per-day note, the name, box start date, bar weight, theme,
// text size and seen medals.
//
// Each test seeds a fresh IndexedDB with exactly that, then boots THIS
// edition on it - the same thing that happens on a phone when the new
// service worker takes over at the same URL. Nothing is imported and
// nothing is copied: the edition has to find it all where 2.34.0 left it.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { bootApp } from "./helpers/boot.mjs";

const snap = JSON.parse(readFileSync(new URL("./fixtures/v2.34.0-device.json", import.meta.url), "utf8"));
const S = snap.stores;
const setting = (key) => (S.settings.find((r) => r.key === key) || {}).value;

function seedV2(idb) {
  return new Promise((resolve, reject) => {
    const req = idb.open(snap.dbName, snap.dbVersion);
    req.onupgradeneeded = () => {
      for (const [name, keyPath] of Object.entries(snap.keyPaths)) req.result.createObjectStore(name, { keyPath });
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(Object.keys(S), "readwrite");
      for (const [name, rows] of Object.entries(S)) for (const r of rows) tx.objectStore(name).put(r);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}
const bootUpgraded = () => bootApp({ localStorage: snap.localStorage, seed: seedV2 });

function readAll(window) {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(snap.dbName);
    req.onsuccess = async () => {
      const db = req.result;
      const out = { version: db.version, stores: [...db.objectStoreNames].sort(), rows: {} };
      for (const name of db.objectStoreNames) {
        out.rows[name] = await new Promise((res) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); });
      }
      db.close();
      resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}

test("the fixture really is a 2.34.0 device", () => {
  assert.equal(snap.appVersion, "2.34.0");
  assert.equal(snap.dbName, "box-log-db");
  assert.equal(snap.dbVersion, 7);
  assert.ok(S.entries.length >= 5 && S.wodEntries.length >= 3 && S.customWods.length >= 1);
});

test("every workout, WOD result, custom movement, custom WOD, bodyweight and measurement is there", async () => {
  const window = await bootUpgraded();
  const ids = (list) => list.map((r) => r.id).sort();
  const strength = window.allMovements().flatMap((m) => window.entriesFor(m.id));
  assert.deepEqual(ids(strength), ids(S.entries), "strength entries");
  const wods = window.allWods().flatMap((w) => window.wodEntriesFor(w.id));
  assert.deepEqual(ids(wods), ids(S.wodEntries), "WOD results");
  const customMovements = window.allMovements().filter((m) => S.movements.some((x) => x.id === m.id));
  assert.equal(customMovements.length, S.movements.length, "custom movements");
  const mem = await window.dbLoadAll();
  assert.equal(mem.length, S.entries.length);

  // Details that a lossy read would drop.
  for (const old of S.entries) {
    const now = strength.find((e) => e.id === old.id);
    for (const k of ["exerciseId", "date", "type", "weight", "reps", "sets", "durationSeconds", "isPR", "groupId", "blockLabel", "ts"]) {
      assert.deepEqual(now[k] ?? null, old[k] ?? null, `entry ${old.id}: ${k}`);
    }
  }
  const emomWod = window.allWods().find((w) => w.id === S.customWods[0].id);
  for (const k of ["emomMovements", "emomMovementTypes", "emomTargetReps", "emomTargetDurations", "emomTargetWeights", "emomMinutes"]) {
    assert.deepEqual(emomWod[k], S.customWods[0][k], `custom EMOM WOD: ${k}`);
  }
  assert.deepEqual(window.wodEntriesFor(emomWod.id)[0].emomReps, S.wodEntries.find((e) => e.wodId === emomWod.id).emomReps);

  assert.deepEqual((await window.dbLoadBodyweight()).map((b) => b.weight), S.bodyweight.map((b) => b.weight));
  assert.deepEqual((await window.dbLoadMeasureTypes()).map((t) => t.name), S.measureTypes.map((t) => t.name));
  assert.deepEqual((await window.dbLoadMeasurements()).map((m) => m.value), S.measurements.map((m) => m.value));
});

test("settings come across: name, box start date, bar weight, theme, text size, last export, the day's note", async () => {
  const window = await bootUpgraded();
  const doc = window.document;
  assert.ok(doc.getElementById("userGreeting").textContent.includes(setting("haimunia:userName")), "the member's name is on screen");
  assert.equal(doc.documentElement.getAttribute("data-theme"), "light", "the theme they chose");
  assert.equal(doc.documentElement.getAttribute("data-text-scale"), "large", "the large-text mode they chose");
  assert.equal(await window.dbGetSetting("haimunia:boxStartDate"), setting("haimunia:boxStartDate"));
  assert.equal(await window.dbGetSetting("haimunia:barWeight"), 15);
  assert.equal(await window.dbGetSetting("boxlog:lastExportAt"), setting("boxlog:lastExportAt"));
  const noteRow = S.settings.find((r) => r.key.startsWith("sessionNote:"));
  doc.querySelector("[data-action='switch-tab'][data-tab='calendar']").click();
  await new Promise((r) => setTimeout(r, 50));
  // Tap that day the way a member does (the note may be from any date).
  const day = noteRow.key.slice("sessionNote:".length);
  const cell = doc.querySelector(`[data-action='cal-select-day'][data-date='${day}']`);
  assert.ok(cell, `the calendar shows ${day}`);
  cell.click();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(doc.getElementById("sessionNoteInput").value, noteRow.value, "the per-day note reads back");
});

test("no first-run treatment for a member who already has a history", async () => {
  const window = await bootUpgraded();
  const doc = window.document;
  assert.ok(!doc.getElementById("welcomeOverlay")?.classList.contains("open"), "no welcome sheet asking their name again");
  assert.ok(!doc.querySelector(".tour-offer"), "no first-run tour card");
});

test("medals and streak: a PR bronze the old app awarded at its one-PR threshold stays earned", async () => {
  const window = await bootUpgraded();
  const seen = setting("haimunia:seenAchievements");
  assert.ok(seen.includes("pr-Press-bronze"), "precondition: 2.34.0 awarded Press bronze for a single PR");
  window.openAchievements();
  await new Promise((r) => setTimeout(r, 50));
  const badge = (name) => [...window.document.querySelectorAll("#achievementsOverlay .medal-badge")]
    .find((b) => b.querySelector(".medal-name")?.textContent === name);
  const pressBronze = badge("Press — ברונזה");
  assert.ok(pressBronze, "the Press bronze medal is on the achievements screen");
  assert.ok(pressBronze.classList.contains("earned"), "and it is still earned, although one PR is below the new threshold of three");
  const earnedNames = [...window.document.querySelectorAll("#achievementsOverlay .medal-badge.earned")].length;
  assert.ok(earnedNames >= seen.length, `every medal 2.34.0 showed is earned here (${earnedNames} earned, ${seen.length} seen)`);
  assert.deepEqual(window.newlyEarnedAchievements().map((a) => a.id), [], "nothing the old app already showed pops again");
  assert.ok(window.document.getElementById("streakLabel"), "the streak label exists");
});

test("what's new opens on first boot with what came after 2.34.0, and nothing about a community", async () => {
  const window = await bootUpgraded();
  const overlay = window.document.getElementById("notificationsOverlay");
  assert.ok(overlay.classList.contains("open"), "the sheet opens by itself: lastSeenVersion was 2.34.0");
  const text = window.document.getElementById("notificationsList").textContent;
  assert.ok(text.includes("3.0.0"), "the new entry is shown");
  assert.ok(!text.includes("2.34.0"), "entries the member already saw are not repeated");
  assert.ok(!/קהילה|פיד|פרופיל/.test(text), text);
  const appVersion = readFileSync(new URL("../app.js", import.meta.url), "utf8").match(/const APP_VERSION = "([^"]+)";/)[1];
  assert.equal(await window.dbGetSetting("haimunia:lastSeenVersion"), appVersion, "and it is marked seen, so it shows once");
});

test("booting rewrites no record, adds no store and keeps the database at version 7 - so rolling back to 2.34.0 still opens it", async () => {
  const window = await bootUpgraded();
  await new Promise((r) => setTimeout(r, 200));
  const after = await readAll(window);
  assert.equal(after.version, 7, "no version bump: 2.34.0 opens box-log-db at 7 and would hit a VersionError above it");
  assert.deepEqual(after.stores, Object.keys(snap.keyPaths).sort(), "no store added or dropped");
  for (const name of ["entries", "movements", "wodEntries", "customWods", "bodyweight", "measureTypes", "measurements"]) {
    assert.deepEqual(after.rows[name], S[name], `${name} is byte-for-byte what 2.34.0 wrote`);
  }
  for (const old of S.settings) {
    const now = after.rows.settings.find((r) => r.key === old.key);
    assert.ok(now, `setting ${old.key} is still there`);
    // The two the app is meant to move: the what's-new sheet marks 3.0.0 seen,
    // and seenAchievements only ever grows.
    if (old.key === "haimunia:lastSeenVersion") continue;
    if (old.key === "haimunia:seenAchievements") {
      for (const id of old.value) assert.ok(now.value.includes(id), `seen medal ${id} kept`);
      continue;
    }
    assert.deepEqual(now.value, old.value, `setting ${old.key} unchanged`);
  }
  // And the rollback's own open succeeds.
  await new Promise((resolve, reject) => {
    const req = window.indexedDB.open("box-log-db", 7);
    req.onsuccess = () => { req.result.close(); resolve(); };
    req.onerror = () => reject(req.error);
  });
});

test("the one-time backup offer: shown once to an upgraded member, then the edition marker is written", async () => {
  const window = await bootUpgraded();
  const doc = window.document;
  assert.ok(doc.querySelector("[data-action='upgrade-backup-download']"), "the offer is on the log screen");
  assert.equal(await window.dbGetSetting("haimunia:schemaEdition"), null, "not marked until answered");
  doc.querySelector("[data-action='upgrade-backup-dismiss']").click();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(doc.querySelector("[data-action='upgrade-backup-download']"), null);
  assert.equal(await window.dbGetSetting("haimunia:schemaEdition"), "standalone-1");
});

test("a fresh install gets the marker straight away and no backup offer", async () => {
  const window = await bootApp();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(window.document.querySelector("[data-action='upgrade-backup-download']"), null);
  assert.equal(await window.dbGetSetting("haimunia:schemaEdition"), "standalone-1");
});

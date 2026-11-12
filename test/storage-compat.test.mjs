// THE NAMES ARE THE MIGRATION.
//
// This edition replaces the 2.x app at the same URL and reads each member's
// data where 2.x left it. There is no copy step, so a single wrong name - a
// "haimunia-demo:" left over from the community edition this was built from,
// a "haimunia:lastExportAt" where 2.x wrote "boxlog:lastExportAt" - reads as
// "no value": the name disappears, the welcome sheet comes back, the data is
// still on the phone and this app cannot see it. This is the inverse of the
// community edition's storage-isolation test, and deliberately so.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootApp, SCRIPT_FILES } from "./helpers/boot.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => readFileSync(path.join(root, f), "utf8");
const SHIPPED = [...SCRIPT_FILES, "theme-init.js", "frame-guard.js", "sw.js", "index.html"];

// Every persistent key 2.34.0 wrote (settings rows and localStorage), taken
// from its source at the tag rollback-2.34.0.
const V2_KEYS = [
  "haimunia:userName", "haimunia:boxStartDate", "haimunia:barWeight", "haimunia:seenAchievements",
  "haimunia:lastSeenVersion", "haimunia:hasOnboarded", "boxlog:lastExportAt", "haimunia:theme", "haimunia:textScale",
];

test("the database is 2.x's own: box-log-db at version 7, with exactly its eight stores", async () => {
  const window = await bootApp();
  const dbs = (await window.indexedDB.databases()).map((d) => [d.name, d.version]);
  assert.deepEqual(dbs, [["box-log-db", 7]]);
  const stores = await new Promise((resolve) => {
    const req = window.indexedDB.open("box-log-db");
    req.onsuccess = () => { const names = [...req.result.objectStoreNames].sort(); req.result.close(); resolve(names); };
  });
  assert.deepEqual(stores, ["bodyweight", "customWods", "entries", "measureTypes", "measurements", "movements", "settings", "wodEntries"]);
});

test("every key 2.x wrote is read under the same name", () => {
  const src = read("app.js") + read("theme-init.js");
  for (const key of V2_KEYS) assert.ok(src.includes(`"${key}"`), `${key} is still read`);
  assert.ok(src.includes("`sessionNote:${"), "per-day notes keep their unprefixed sessionNote:<date> keys");
});

test("no shipped file names a community-edition storage identifier", () => {
  for (const f of SHIPPED) {
    const src = read(f);
    assert.ok(!src.includes("haimunia-demo"), `${f} mentions haimunia-demo`);
    assert.ok(!/["']haimunia:lastExportAt["']/.test(src), `${f}: the export marker is boxlog:lastExportAt in 2.x`);
  }
});

test("everything the app writes goes under a 2.x-compatible name", async () => {
  const window = await bootApp();
  window.setThemePref("light");
  window.setTextScalePref("large");
  window.saveWelcomeForm("בודק");
  await new Promise((r) => setTimeout(r, 50));
  for (const k of Object.keys(window.localStorage)) assert.match(k, /^haimunia:/, `localStorage key ${k}`);
  const settings = await new Promise((resolve) => {
    const req = window.indexedDB.open("box-log-db");
    req.onsuccess = () => {
      const r = req.result.transaction("settings").objectStore("settings").getAllKeys();
      r.onsuccess = () => { req.result.close(); resolve(r.result); };
    };
  });
  for (const k of settings) assert.match(k, /^(haimunia:|boxlog:lastExportAt$|sessionNote:|wodMovementTags$)/, `settings key ${k}`);
});

test("the service worker keeps 2.x's cache prefix and deletes only its own older caches", () => {
  const src = read("sw.js");
  assert.match(src, /const CACHE_PREFIX = "haimunia-v";/);
  assert.match(src, /keys\.filter\(\(k\) => k\.startsWith\(CACHE_PREFIX\) && k !== CACHE\)/,
    "never the 2.x worker's delete-everything: the github.io origin is shared");
});

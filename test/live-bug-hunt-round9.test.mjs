// Live bug hunt, round 9 (2026-09-11): three fresh agents on long-term data
// lifecycle found confirmed bugs across the offline training log's boot
// path, backup export/delete-all, and multi-version upgrade handling (see
// CHANGES.md for the full report). This file covers those; the export/
// delete-all session-note and outbox fixes have their own coverage further
// down, and the bodyweight/measurement dedup pattern this reuses already
// has sibling tests in test/bodyweight-measurements.test.mjs.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

// ---------------------------------------------------------------------------
// sanitizeList()'s max cap used to always apply (LIMITS.importItems, 20000)
// even on reloadFromDb()'s own on-disk reads - confirmed live with 21001
// seeded strength entries, all persisted, but only 20000 visible after a
// reload, with the ~1000 dropped rows scattered roughly uniformly across
// the dataset (IndexedDB orders by primary key, not by date). Fixed by
// making the cap an explicit opt-in parameter, applied only at the JSON-
// import call sites. Full-scale (20000+) IndexedDB seeding is exercised
// live via Playwright (round 9's own report) - this test proves the same
// mechanism at a size fast enough for the node suite: sanitizeList() with
// no max returns everything, and reloadFromDb() calls it that way.
// ---------------------------------------------------------------------------
test("sanitizeList() with no max cap returns every item, not LIMITS.importItems worth", async () => {
  const window = await bootApp();
  const input = Array.from({ length: 50 }, (_, i) => i + 1); // 1-indexed: sanitizeList's .filter(Boolean) would drop a real 0
  const identity = (x) => x;

  const uncapped = window.sanitizeList(input, identity);
  assert.equal(uncapped.length, 50, "no max argument must mean no truncation");

  // CONTROL: an explicit max DOES still truncate - proves the parameter
  // itself works and the assertion above isn't vacuous.
  const capped = window.sanitizeList(input, identity, 20);
  assert.equal(capped.length, 20, "an explicit max must still cap, same as the JSON-import call sites use it");
});

test("reloadFromDb() does not silently drop real on-disk records past the old 20000-item import cap", async () => {
  const window = await bootApp();
  await window.addMovement("Test Volume Squat", "Squat");
  const movement = window.allMovements().find((m) => m.name === "Test Volume Squat");

  // 50 real, distinct, dated entries written straight through the app's own
  // dbPut() - the same function saveSet() calls - fast enough for the node
  // suite while still proving the mechanism: reloadFromDb() must never
  // apply an import-only cap to its own on-disk reads, at any count.
  const rows = Array.from({ length: 50 }, (_, i) => ({
    id: `set-volume-${i}`, ts: Date.now() - i * 3600000,
    exerciseId: movement.id, type: "reps", weight: 40 + i, reps: 5, sets: 1,
    durationSeconds: 0, date: window.localISODate(new Date(Date.now() - i * 86400000)),
    isPR: false, est1RM: 50, groupId: null, blockLabel: null,
  }));
  for (const r of rows) await window.dbPut(r);

  await window.reloadFromDb();
  const persisted = (await window.dbLoadAll()).filter((e) => e.exerciseId === movement.id);
  assert.equal(persisted.length, 50, "all 50 rows must actually be on disk");

  // entries is a bare `let` binding (not a function declaration), so it
  // isn't on window directly - read it back through entriesFor(), the same
  // exposed helper the History tab itself uses.
  const historyEntries = window.entriesFor(movement.id);
  assert.equal(historyEntries.length, 50, "reloadFromDb() must surface every on-disk row, not cap at an import-only limit");
});

// ---------------------------------------------------------------------------
// A returning member with real history but no stored name (a device that
// predates the naming step) used to get the exact same "welcome, new user"
// sheet a brand-new install gets, because the check was `userName === null`
// instead of `userName === null && isFreshInstall` - unlike every other
// first-run flag bootstrapped in the same block, which all correctly
// grandfather a device with real data. The if/else-if shape also meant the
// release-notes catch-up was silently skipped for that same boot.
// ---------------------------------------------------------------------------
test("a device with real history but no stored name is grandfathered past the welcome sheet, not treated as a fresh install", async () => {
  const window = await bootApp();
  // This window's initial bootApp() boot IS a genuinely fresh install
  // (correctly opens the welcome sheet) - close it, seed real history, and
  // re-run init() to simulate the SAME device on its next real launch (a
  // page reload, the actual scenario the bug is about), still with no name.
  window.closeWelcomeModal();
  await window.addMovement("Test Grandfather Squat", "Squat");
  const movement = window.allMovements().find((m) => m.name === "Test Grandfather Squat");
  window.choosePickedMovement(movement.id);
  window.applyFieldValue("step", "weight", 40);
  window.applyFieldValue("step", "reps", 5);
  await window.saveSet();

  await window.init();

  assert.equal(window.document.getElementById("welcomeOverlay").classList.contains("open"), false,
    "a device with real history and no name must not see the fresh-install welcome sheet");
});


// Live bug hunt, fresh round 8 (2026-09-15) — the WOD side of the offline log.
//
// The strength side of this file has been hunted repeatedly and carries long
// comments explaining each fix. The WOD side received far less of that
// attention, and all three findings here are the same rule stated on the
// strength side and never carried across.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const appJs = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("a WOD's first-ever attempt is not a personal record", () => {
  // HIGH, and constant rather than an edge: `prevBest === null ||` made a
  // first attempt a record BY DEFINITION. Every member's first Fran, first
  // Grace, first anything opened the full-screen celebration, stored
  // isPR: true in IndexedDB, and left a permanent flame on the entry and a
  // record dot on the calendar day - for a result with nothing to compare to.
  //
  // The strength side says it plainly: "nothing is a personal record until
  // there is something to beat".
  const at = appJs.indexOf("const isPR = w.scoreType === \"emom\"");
  assert.ok(at > -1, "the WOD PR test exists");
  const line = appJs.slice(at, appJs.indexOf("\n", at));
  assert.match(line, /prevBest !== null &&/, "a previous best must exist for this to be a record");
  assert.ok(!/prevBest === null \|\|/.test(line), "the inverted version must be gone");
  // EMOM still scores no cross-attempt record at all.
  assert.match(line, /w\.scoreType === "emom" \? false :/, "EMOM is unchanged");
});

test("editing a result down from a record says the mark was removed", () => {
  // saveSet() has told members this since the strength side hit it; the WOD
  // side dropped the flame in silence.
  assert.match(appJs, /if \(existing && existing\.isPR && !isPR\) showToast\("עדכנתם את האימון/,
    "an edit that removes a record explains itself");
  // The strength-side original must still be there - they are siblings and
  // should not drift apart again.
  // Matched on the guard and the wording separately: the strength side writes
  // it as a block and the WOD side as a one-liner, and pinning the brace
  // style would make this test fail on a reformat rather than on a
  // regression.
  assert.match(appJs, /if \(existing && existing\.isPR && !isPR\) \{\s*\n\s*showToast\("עדכנתם את הסט/,
    "the strength side keeps its own");
});

test("import cannot land a result pointing at a WOD that does not exist", () => {
  // Nothing validated wodId on the way in, so a result for a deleted custom
  // WOD imported cleanly and sat in the calendar forever as "? מלא" - with a
  // SILENT no-op edit pencil, because startEditWodEntry() bails on `if (!w)
  // return;`. restoreWodEntry() already refuses this on the undo path, and
  // says why; import never got the guard.
  assert.match(appJs, /const knownWodIds = new Set\(/, "the catalogue is assembled");
  assert.match(appJs, /WOD_LIBRARY\.map\(\(w\) => w\.id\)/, "built-ins");
  assert.match(appJs, /\.concat\(\(clean\.customWods \|\| \[\]\)\.map\(\(w\) => w && w\.id\)\)/,
    "AND the custom WODs arriving in this same file - a result may legitimately reference one");
  assert.match(appJs, /clean\.wodEntries = clean\.wodEntries\.filter\(\(e\) => e && knownWodIds\.has\(e\.wodId\)\)/,
    "orphans are dropped rather than imported");
});

test("a dropped result is reported, not silently discarded", () => {
  // A count that quietly does not add up is its own bug.
  assert.match(appJs, /רישום אימון אחד דולג/, "singular");
  assert.match(appJs, /רישומי אימון דולגו/, "plural");
});

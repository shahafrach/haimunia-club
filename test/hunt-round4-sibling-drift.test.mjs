// Live bug hunt, fresh round 4 (2026-09-15) — hunting a SHAPE, not a feature.
//
// The previous three rounds' most productive finding was repeatedly the same
// one: a pair of near-identical code paths where one was fixed and the other
// was never revisited. saveSet vs saveWod. Event list vs event detail. The
// report button vs the follow button. The ladder toast vs the ladder status
// line. The invite field vs the credential fields.
//
// So round 4 went looking for the shape directly, diffing pairs guard by
// guard. This is what it found.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const appJs = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("a bodyweight of zero cannot be saved, exactly as a measurement of zero cannot", () => {
  // saveMeasurement() refused `value <= 0` AND rendered its button disabled
  // until the value was positive. saveBodyweight() checked only isFinite(),
  // and zero is perfectly finite - so holding the minus stepper to its floor
  // and tapping save wrote a real row of 0 ק״ג for today, showed "0 ק״ג" as
  // the member's latest weight, and baked a zero point into the trend chart.
  const at = appJs.indexOf("async function saveBodyweight()");
  assert.ok(at > -1, "saveBodyweight exists");
  const body = appJs.slice(at, at + 1400);
  assert.match(body, /if \(!isFinite\(bwWeight\) \|\| bwWeight <= 0\) return;/,
    "the function refuses a non-positive weight");
  assert.ok(!/async function saveBodyweight\(\) \{\s*\n\s*if \(!isFinite\(bwWeight\)\) return;/.test(appJs),
    "the isFinite-only version must be gone");

  // The sibling it now matches must still carry its own guard - they should
  // not drift apart again in the other direction.
  const meas = appJs.slice(appJs.indexOf("async function saveMeasurement("), appJs.indexOf("async function saveMeasurement(") + 400);
  assert.match(meas, /value <= 0\) return;/, "saveMeasurement keeps its guard");
});

test("the bodyweight save button is disabled at zero, and un-disabled when you step back up", () => {
  // Both halves, because the button's attribute is decided at render time and
  // the stepper patches the DOM in place without ever calling render(). The
  // measurement sibling's own sync() spells this out at length - an attribute
  // set once would go stale the moment the stepper moved, and would then stay
  // stuck disabled after the member raised the value again.
  assert.match(appJs, /data-action="save-bw"[^>]*\$\{bwWeight > 0 \? "" : " disabled"\}/,
    "the button renders disabled at zero");
  const at = appJs.indexOf('"bw-step": {');
  const sync = appJs.slice(at, appJs.indexOf('"measure-step"', at) || at + 2000);
  assert.match(sync, /const bwBtn = document\.querySelector\(`\[data-action="save-bw"\]`\);/,
    "the stepper finds the button");
  assert.match(sync, /if \(bwBtn\) bwBtn\.disabled = !\(bwWeight > 0\);/,
    "and keeps its disabled state in step with the value");
});

// The percentage table under the 1RM estimate on the log screen.
//
// WHAT THIS APP IS, and why the feature looks like this. Haimunia is
// POST-WORKOUT management: you open it to record what you did and to work out
// what to aim for next time. It is not a bar-side calculator, so there is no
// warmup ladder and no plate breakdown here - those answer "what do I do in
// the next ninety seconds", which is a question this app is not in the room
// for. The percentages are framed as the NEXT session and live where a lift
// is being reviewed.
//
// The reference is bestEst1RM() - an Epley estimate from real logged sets,
// not a tested single. Deliberate trade: it works for every member on day one
// with nothing to fill in, at the cost of being an estimate. A number derived
// from a 5-rep set can sit a few kg either side of a true max, so the panel
// says that plainly instead of presenting the figures as measured.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

// app.js is a classic script, not a module - it cannot be imported here, and
// re-declaring the helper in the test would only prove the copy. So the
// rounding rule is pinned at source, and the arithmetic it implies is checked
// against the same rule.
test("percentage weights are rounded to a step a barbell can actually hold", () => {
  assert.match(src, /function roundToPlate\(kg\) \{ return Math\.round\(kg \/ 2\.5\) \* 2\.5; \}/,
    "2.5 kg is the smallest real jump - 1.25 kg a side. An unrounded 77.3 is a number nobody can load.");
  const roundToPlate = (kg) => Math.round(kg / 2.5) * 2.5;
  for (const est of [42.5, 60, 82.5, 100, 137.5]) {
    for (const pct of [95, 90, 85, 80, 75, 70, 65, 60]) {
      const v = roundToPlate(est * pct / 100);
      assert.equal((v * 10) % 25, 0, `${est} kg @ ${pct}% gave ${v}, which is not a 2.5 kg multiple`);
    }
  }
});

test("the panel names its basis and never presents the estimate as a tested max", () => {
  assert.match(src, /הערכה מהסטים שרשמתם, לא מקס שנבדק/,
    "a member has to be able to tell an estimate from a measurement before loading a bar to it");
  assert.match(src, /const PCT_STEPS = \[95, 90, 85, 80, 75, 70, 65, 60\];/,
    "descending, so the heaviest - the one being planned around - is read first");
});

test("the percentage table is offered only where it means something", () => {
  // Duration entries carry est1RM: 0 by construction (sanitizeEntry), so a
  // percentage of a hold is meaningless; the panel is gated on both a real
  // estimate and a reps-type lift.
  assert.match(src, /\$\{est && !isDuration \? `/,
    "no percentage table for holds and carries, which have no 1RM to take a percentage of");
});

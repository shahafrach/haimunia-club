// Live bug hunt, round 10 (2026-09-11): three fresh agents on the
// feature-interaction matrix, a throttled-network walkthrough, and a final
// fresh-eyes sweep found confirmed bugs across the app (see CHANGES.md for
// the full report). This is the FINAL round of the 10-round bug hunt. This
// file covers app.js/src/format.js findings; the Community-layer fixes
// (achievement offline-claim retry, the challenge-join race, the stalled
// anonymous sign-in) have their own regression tests next to their
// siblings in test/community-achievement-engine.test.mjs,
// test/community-challenges.test.mjs, and test/community-gate-order.test.mjs.
// The medal-icon-color rendering fix (a CSS/SVG <use> issue jsdom cannot
// see) has its own browser-check script,
// scripts/browser-check/medal-icon-colors.mjs.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

// ---------------------------------------------------------------------------
// fmtDate() never showed the year, so two same-day-of-month entries logged
// years apart rendered as the exact same label - confirmed live, a chart
// plotting a 3-years-apart 1RM gain showed two identical "11.03" x-axis
// points with no way to tell the gain happened over years rather than
// weeks. Fixed to append the year, but only when it differs from the
// current one, so the common (this-year) case is unchanged.
// ---------------------------------------------------------------------------
test("fmtDate() appends the year only when it differs from the current year", async () => {
  const window = await bootApp();
  const thisYear = new Date().getFullYear();
  const sameMonthDayThisYear = `${thisYear}-03-11`;
  const sameMonthDayThreeYearsAgo = `${thisYear - 3}-03-11`;

  const labelThisYear = window.fmtDate(sameMonthDayThisYear);
  const labelYearsAgo = window.fmtDate(sameMonthDayThreeYearsAgo);

  assert.notEqual(labelThisYear, labelYearsAgo,
    "two same-day-of-month dates from different years must not render as the identical label");
  assert.doesNotMatch(labelThisYear, new RegExp(String(thisYear)), "the current year is not appended - the common case stays uncluttered");
  assert.match(labelYearsAgo, new RegExp(String(thisYear - 3)), "a date from a different year must include that year");
});

// 3.17.0: THE MONTHLY SUMMARY CARD on the progress screen.
//
// The last full month and the current month so far, by the date in Asia/Jerusalem: workouts (days with a
// lift or a WOD), PRs (the app's own celebratablePrEntryIds(), the same count as "שיאים החודש"), the best
// lift (the month's PR with the largest gain by the PR card's rule, clubPrPercent; else its heaviest set),
// and the weekly streak. Computed at render; nothing stored, nothing sent.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

let n = 0;
const epley = (w, r) => (r === 1 ? w : Math.round(w * (1 + r / 30) * 10) / 10);
const set = (date, exerciseId, weight, reps, hour = 8) => ({ id: `s-${++n}`, ts: Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`), exerciseId, type: "reps", weight, reps, sets: 1, date, isPR: false, est1RM: epley(weight, reps), durationSeconds: 0, groupId: null, blockLabel: null });
const wod = (date) => ({ id: `w-${++n}`, ts: Date.parse(date + "T09:00:00Z"), date, wodId: "fran", scoreType: "time", rx: true, timeSeconds: 300, notes: null, isPR: false });
async function withLog(sets, wods = []) {
  const window = await bootApp();
  if (sets.length || wods.length) assert.equal(await window.importBackupData({ app: "box-log", version: 1, entries: sets, wodEntries: wods.map(wod) }), true);
  return window;
}
const at = (iso) => new Date(iso);
const plain = (o) => JSON.parse(JSON.stringify(o));

// Three squat sessions in September build the history a PR needs (MIN_ENTRIES_BEFORE_PR), then October
// beats it twice: a rep record (100 → 110 × 5, +10%) and a smaller 1RM gain on the deadlift.
const HISTORY = [
  set("2026-09-02", "back-squat", 90, 5), set("2026-09-09", "back-squat", 95, 5), set("2026-09-16", "back-squat", 100, 5),
  set("2026-09-03", "deadlift", 140, 3), set("2026-09-10", "deadlift", 145, 3), set("2026-09-17", "deadlift", 150, 3),
];
const OCTOBER = [
  set("2026-10-06", "back-squat", 110, 5), set("2026-10-06", "back-squat", 80, 8, 9),
  set("2026-10-13", "deadlift", 155, 3), set("2026-10-20", "deadlift", 120, 5),
];

test("last full month and this month so far: workouts, PRs by the app's own rule, and the best lift by the PR card's rule", async () => {
  const window = await withLog([...HISTORY, ...OCTOBER, set("2026-11-03", "back-squat", 100, 3)], ["2026-10-27", "2026-11-10"]);
  const s = plain(window.monthlySummaries(at("2026-11-16T10:00:00Z")));
  assert.equal(s.last.key, "2026-10");
  assert.equal(s.current.key, "2026-11");
  assert.equal(s.last.workouts, 4, "days with a lift or a WOD: 10/6, 10/13, 10/20, 10/27 (two sets on 10/6 are one workout)");
  const prIds = window.celebratablePrEntryIds();
  const octPrs = window.entriesFor("back-squat").concat(window.entriesFor("deadlift")).filter((e) => e.date.startsWith("2026-10") && prIds.has(e.id));
  assert.equal(s.last.prs, octPrs.length, "the same PRs the app celebrates");
  assert.equal(s.last.prs, 2);
  assert.equal(s.last.best.kind, "pr");
  assert.equal(s.last.best.entry.exerciseId, "back-squat", "+10% beats the deadlift's +3.3%");
  assert.equal(s.last.best.pct, 10);
  assert.equal(s.current.workouts, 2);
  assert.equal(s.current.prs, 0);
  assert.equal(s.current.best.kind, "heaviest", "no PR this month: the heaviest set");
  assert.equal(s.current.best.entry.weight, 100);

  window.document.getElementById("tabHistoryBtn").click();
  const card = window.document.getElementById("monthlySummary");
  assert.ok(card, "on the progress screen");
  const oct = card.querySelector('[data-month="2026-10"]');
  assert.match(oct.textContent, /אוקטובר 2026/);
  assert.equal(oct.querySelector(".month-workouts").textContent, "4");
  assert.equal(oct.querySelector(".month-prs").textContent, "2");
  assert.match(oct.querySelector(".month-best").textContent, /השיא הבולט:.*Back Squat.*\+10%.*110 ק״ג × 5/);
  assert.doesNotMatch(card.textContent, /רצף/, "Q-43: one streak card; the weekly streak is not repeated here");
  assert.ok(window.document.getElementById("weeklyStreak"), "it is on its own card");
  const pct = oct.querySelector(".month-best-pct");
  assert.equal(pct.getAttribute("dir"), "ltr", "+10% is isolated left to right, so the sign stays in front in the RTL line");
  assert.equal(pct.textContent, "+10%");
});

test("an empty month says so in one line", async () => {
  const window = await withLog([set("2026-11-03", "back-squat", 100, 3)]);
  window.document.getElementById("tabHistoryBtn").click();
  const card = window.document.getElementById("monthlySummary");
  // Rendered against the real clock: the last full month has nothing in this log unless today is in December.
  const s = plain(window.monthlySummaries());
  const lastBlock = card.querySelector(`[data-month="${s.last.key}"]`);
  if (s.last.workouts === 0) {
    assert.match(lastBlock.textContent, /לא נרשמו אימונים ב/);
    assert.equal(lastBlock.querySelector(".month-workouts"), null, "no zero counters");
  }
  const none = await withLog([]);
  none.document.getElementById("tabHistoryBtn").click();
  const c2 = none.document.getElementById("monthlySummary");
  assert.match(c2.textContent, /עדיין לא נרשמו אימונים החודש\./);
  assert.match(c2.textContent, /לא נרשמו אימונים ב/);
  assert.match(none.document.getElementById("weeklyStreak").textContent, /אין עדיין רצף/, "the streak card says it, once");
  assert.equal(plain(none.monthlySummaries(at("2026-11-16T10:00:00Z"))).last.best, null);
});

test("Hebrew month names; January's last full month is December of the year before; months by the date in Jerusalem", async () => {
  const window = await withLog([set("2025-12-30", "back-squat", 100, 5), set("2026-01-02", "back-squat", 100, 5)]);
  const jan = plain(window.monthlySummaries(at("2026-01-05T10:00:00Z")));
  assert.equal(jan.last.key, "2025-12");
  assert.equal(window.monthLabel("2025-12"), "דצמבר 2025");
  assert.equal(window.monthLabel("2026-01"), "ינואר 2026");
  // 31 Oct 23:30 in Jerusalem is still October; 00:30 on 1 Nov (still 31 Oct in UTC) is November.
  assert.equal(plain(window.monthlySummaries(at("2026-10-31T21:30:00Z"))).current.key, "2026-10");
  assert.equal(plain(window.monthlySummaries(at("2026-10-31T22:30:00Z"))).current.key, "2026-11");
});

test("a month's first sets are not PRs until there is something to beat, as everywhere else", async () => {
  const window = await withLog([set("2026-10-01", "back-squat", 60, 5), set("2026-10-08", "back-squat", 70, 5)]);
  const s = plain(window.monthlySummaries(at("2026-11-16T10:00:00Z")));
  assert.equal(s.last.prs, 0);
  assert.equal(s.last.best.kind, "heaviest");
  assert.equal(s.last.best.entry.weight, 70);
});

test("nothing is stored or sent, and the club code never reads it", async () => {
  const window = await withLog([...HISTORY, ...OCTOBER]);
  window.document.getElementById("tabHistoryBtn").click();
  const settings = await window.dbGetAllSettings();
  assert.ok(!settings.some((r) => /summary|monthly/i.test(r.key)));
  assert.ok(!Object.keys(window.localStorage).some((k) => /summary|monthly/i.test(k)));
  const { readFileSync } = await import("node:fs");
  const club = readFileSync(new URL("../src/club.js", import.meta.url), "utf8") + readFileSync(new URL("../src/connect.js", import.meta.url), "utf8");
  assert.ok(!/monthlySummar|סיכום חודשי/.test(club));
});

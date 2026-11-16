#!/usr/bin/env node
// F-014: a synthetic heavy member, three years long. No real member data: every value is drawn from a seeded
// PRNG (mulberry32), so the same run always writes the same bytes.
//
//   - 5 training days a week, 2023-11-15 .. 2026-11-14
//   - 6 to 10 set rows a day across about 40 movements (34 built in + 6 custom), a few timed holds
//   - a WOD on 3 of those days a week, from 30 custom WODs (time, amrap, load and emom)
//   - body weight every day; 4 measurement types, once a month each
//   - a Hebrew session note on about one training day in three, up to 300 characters (this app's format only)
//
// Writes, from the same data:
//   test/fixtures/heavy-3y-backup.json       the old app's format, as test/old-app-backup-imports reads it
//                                            (box-log v1, no sessionNotes, no customWodMovementTags)
//   test/fixtures/heavy-3y-backup.club.json  this app's own export format (buildBackupPayload in app.js), with both
//
// Usage: node scripts/make-heavy-fixture.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SEED = 20261115;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const roundTo = (x, step) => Math.round(x / step) * step;
let idN = 0;
const id = (prefix) => `${prefix}-heavy-${(++idN).toString(36).padStart(6, "0")}`;

// ---- movements -------------------------------------------------------------------------------------------
const BUILT_IN = [
  ["back-squat", 120], ["front-squat", 100], ["overhead-squat", 60], ["pause-squat", 100], ["deadlift", 160],
  ["sumo-deadlift", 150], ["romanian-deadlift", 110], ["rack-pull", 170], ["strict-press", 55], ["push-press", 75],
  ["bench-press", 95], ["push-jerk", 80], ["split-jerk", 85], ["incline-bench-press", 80], ["close-grip-bench-press", 85],
  ["clean", 90], ["power-clean", 85], ["hang-clean", 80], ["hang-power-clean", 75], ["clean-and-jerk", 85],
  ["snatch", 65], ["power-snatch", 60], ["hang-snatch", 55], ["snatch-balance", 65], ["snatch-pull", 90],
  ["clean-pull", 120], ["weighted-pullup", 25], ["weighted-chinup", 25], ["bent-over-row", 80], ["pendlay-row", 80],
  ["barbell-row", 80], ["thruster", 60], ["sumo-deadlift-high-pull", 50], ["muscle-snatch", 45],
];
const CUSTOM = [
  { id: "custom-heavy-ring-row", name: "Ring Row", category: "Pull", base: 0 },
  { id: "custom-heavy-sled-push", name: "Sled Push", category: "Other", base: 100 },
  { id: "custom-heavy-farmer", name: "Farmer Carry", category: "Other", base: 60 },
  { id: "custom-heavy-ghd", name: "GHD Back Extension", category: "Other", base: 10 },
  { id: "custom-heavy-plank", name: "Plank Hold", category: "Other", base: 0, hold: true },
  { id: "custom-heavy-lsit", name: "L-Sit Hold", category: "Other", base: 0, hold: true },
];
const customMovements = CUSTOM.map(({ id: i, name, category }) => ({ id: i, name, category }));
const MOVES = BUILT_IN.map(([i, base]) => ({ id: i, base })).concat(CUSTOM.map((c) => ({ id: c.id, base: c.base, hold: !!c.hold })));

// ---- custom WODs -----------------------------------------------------------------------------------------
const WOD_WORDS = ["Wall Balls", "Box Jumps", "Burpees", "Pull-Ups", "Toes-to-Bar", "Kettlebell Swings", "Row (Calories)", "Double Unders", "Thrusters", "Push-Ups", "Sit-Ups", "Lunges"];
const customWods = [];
for (let i = 0; i < 30; i++) {
  const scoreType = ["time", "time", "amrap", "amrap", "load", "emom"][i % 6];
  const moves = [pick(WOD_WORDS), pick(WOD_WORDS), pick(WOD_WORDS)];
  const w = { id: `customwod-heavy-${i + 1}`, name: `WOD ${i + 1}`, category: "Custom", scoreType,
    desc: moves.map((m) => `${int(10, 50)} ${m}`).join(", ") };
  if (scoreType === "time") w.timeCapSeconds = 60 * int(10, 25);
  if (scoreType === "amrap") w.timeCapSeconds = 60 * int(8, 20);
  if (scoreType === "load" || scoreType === "emom") w.timeCapSeconds = null;
  if (scoreType === "emom") {
    w.emomMinutes = 12; w.emomMovements = [moves[0], "Plank Hold", "Rest", moves[1]];
    w.emomMovementTypes = ["reps", "duration", "rest", "reps"];
    w.emomTargetReps = [12, 0, 0, 10]; w.emomTargetDurations = [0, 40, 0, 0]; w.emomTargetWeights = [9, 0, 0, 0];
  }
  customWods.push(w);
}

// ---- notes -----------------------------------------------------------------------------------------------
const NOTE_BITS = ["הרגשתי חזק היום", "הגב התחתון קצת תפוס", "ישנתי רע, האימון היה כבד", "שיפור יפה בטכניקה",
  "לעבוד על עומק הסקוואט", "המאמן אמר להאט את הירידה", "יום מצוין, הכל זרם", "כאב קל בכתף, הורדתי משקל",
  "חזרתי אחרי שבוע חופש", "אימון קבוצתי עם החבר'ה", "חם מאוד במכון", "לשתות יותר מים לפני האימון"];
function hebrewNote() {
  let s = "";
  while (s.length < int(40, 290)) s += (s ? ". " : "") + pick(NOTE_BITS);
  return s.slice(0, 300);
}

// ---- three years -----------------------------------------------------------------------------------------
const START = Date.UTC(2023, 10, 15);
const END = Date.UTC(2026, 10, 14);
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const entries = [], wodEntries = [], bodyweightEntries = [], measureEntries = [];
const sessionNotes = {};
const measureTypes = [["מותניים", 86], ["חזה", 102], ["ירך", 58], ["זרוע", 36]].map(([name, base], i) => ({ id: `meas-type-heavy-${i + 1}`, name, base }));
let weekIdx = 0, bw = 82;
for (let t = START; t <= END; t += DAY) {
  const date = iso(t);
  const dow = new Date(t).getUTCDay();
  const progress = (t - START) / (END - START);   // 0 .. 1 over the three years: loads creep up
  bw = Math.round((bw + (rnd() - 0.5) * 0.4) * 10) / 10;
  bodyweightEntries.push({ id: id("bw"), date, weight: bw, ts: t + 6 * 3600000 });
  if (new Date(t).getUTCDate() === 1) {
    for (const mt of measureTypes) measureEntries.push({ id: id("meas"), typeId: mt.id, date, value: Math.round((mt.base + (rnd() - 0.5) * 3) * 10) / 10, ts: t + 6.5 * 3600000 });
  }
  if (dow === 6 || dow === 5) continue;                   // 5 training days: Sunday .. Thursday
  if (dow === 0) weekIdx++;
  let ts = t + 7 * 3600000;
  const rows = int(6, 10);
  const dayMoves = [pick(MOVES), pick(MOVES), pick(MOVES)];
  for (let r = 0; r < rows; r++) {
    const m = dayMoves[r % dayMoves.length];
    ts += int(60, 240) * 1000;
    if (m.hold) {
      entries.push({ id: id("set"), ts, exerciseId: m.id, type: "duration", weight: 0, reps: 0, sets: 1, date, isPR: false, est1RM: 0, durationSeconds: int(30, 120), groupId: null, blockLabel: null });
      continue;
    }
    const reps = pick([1, 2, 3, 3, 5, 5, 5, 8, 10]);
    const pct = 0.6 + rnd() * 0.3;
    const weight = Math.max(m.base ? 20 : 0, roundTo(m.base * (0.85 + 0.3 * progress) * pct, 2.5));
    const est = Math.round(weight * (1 + reps / 30) * 10) / 10;
    entries.push({ id: id("set"), ts, exerciseId: m.id, type: "reps", weight, reps, sets: pick([1, 1, 1, 2, 3]), date, isPR: rnd() < 0.03, est1RM: est, durationSeconds: 0, groupId: null, blockLabel: null });
  }
  if (dow === 0 || dow === 2 || dow === 4) {              // a WOD 3 days a week
    const w = customWods[(weekIdx * 3 + dow) % customWods.length];
    const e = { id: id("wod"), ts: ts + 1800000, date, wodId: w.id, scoreType: w.scoreType, rx: rnd() < 0.7 };
    if (w.scoreType === "time") e.timeSeconds = int(300, w.timeCapSeconds);
    else if (w.scoreType === "amrap") { e.rounds = int(3, 20); e.reps = int(0, 15); }
    else if (w.scoreType === "emom") e.emomReps = [int(8, 12), int(25, 40), int(6, 10)];
    else e.weight = roundTo(60 + 40 * rnd(), 2.5);
    e.notes = null; e.partnerTag = null; e.isPR = false;
    wodEntries.push(e);
  }
  if (rnd() < 1 / 3) sessionNotes[date] = hebrewNote();
}

const common = { app: "box-log", version: 1, exportedAt: "2026-11-15T09:00:00.000Z",
  entries, customMovements, wodEntries, customWods, bodyweightEntries,
  measureTypes: measureTypes.map(({ id: i, name }) => ({ id: i, name })), measureEntries };
const oldApp = { ...common };
const club = { ...common, sessionNotes, customWodMovementTags: [{ name: "Sled Push", category: "Gymnastics" }, { name: "Farmer Carry", category: "Weightlifting" }] };

const out = (name, obj) => {
  const file = path.join(root, "test/fixtures", name);
  writeFileSync(file, JSON.stringify(obj) + "\n");
  return file;
};
out("heavy-3y-backup.json", oldApp);
out("heavy-3y-backup.club.json", club);
console.log(JSON.stringify({
  entries: entries.length, customMovements: customMovements.length, wodEntries: wodEntries.length,
  customWods: customWods.length, bodyweightEntries: bodyweightEntries.length, measureTypes: measureTypes.length,
  measureEntries: measureEntries.length, sessionNotes: Object.keys(sessionNotes).length,
  movementsUsed: new Set(entries.map((e) => e.exerciseId)).size,
}));

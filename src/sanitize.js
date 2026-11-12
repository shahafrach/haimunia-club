// ---------- Untrusted value cleaners ----------
// cleanStr/cleanNum/cleanId/cleanISODate/cleanTs and uid moved to
// src/shared/safe-helpers.js in COMM-368 - they are the generic, low-level
// half of this file and the half the sibling Box Log client had a
// byte-identical fork of. They are bound as bare identifiers at the top of
// src/constants.js, which loads before this file, so every call site below
// (and in app.js) is unchanged.
//
// What stays here is the half that is NOT shareable: the per-record
// sanitizers, which are specific to this app's own schema (entries, WODs,
// bodyweight, measurements) and to this repo's LIMITS/MOVEMENT_CATEGORIES.
// ---------- Record sanitizers ----------
// Applied to every record that comes off disk or out of an imported file.
// Nothing else in the app is allowed to trust these shapes.
function sanitizeMovement(m) {
  if (!m || typeof m !== "object") return null;
  const id = cleanId(m.id), name = cleanStr(m.name, LIMITS.nameLen);
  if (!id || !name) return null;
  return { id, name, category: MOVEMENT_CATEGORIES.includes(m.category) ? m.category : "Other" };
}
function sanitizeWodMovementTag(t) {
  if (!t || typeof t !== "object") return null;
  const name = cleanStr(t.name, LIMITS.nameLen);
  if (!name) return null;
  return { name, category: WOD_MOVE_CATEGORIES.includes(t.category) ? t.category : "Gymnastics" };
}
// The category is never read off the input: every custom WOD is "Custom",
// whatever a hand-edited backup file says.
function sanitizeCustomWod(w) { return sanitizeWodShape(w, "Custom"); }
function sanitizeWodShape(w, category) {
  if (!w || typeof w !== "object") return null;
  const id = cleanId(w.id), name = cleanStr(w.name, LIMITS.nameLen);
  if (!id || !name) return null;
  const scoreType = WOD_SCORE_TYPES.includes(w.scoreType) ? w.scoreType : "time";
  const out = { id, name, category, scoreType, desc: cleanStr(w.desc, LIMITS.notesLen) };
  // EMOM structure lives on the WOD itself (unlike every other format, whose
  // per-movement fields are only ever baked into free text) — the log form
  // needs to know the movement rotation to render one reps field per
  // movement each time this WOD is attempted. See renderWodLogSection.
  //
  // Each station has a type ("reps" | "duration" | "rest"), a target reps, a
  // target duration and a target weight. This is the older app's model
  // (its 2.28.0/2.29.0), which members already have on disk: dropping the
  // three extra arrays here made every rest station a reps station and every
  // duration station lose its seconds - in memory on load, and permanently
  // on the first re-save or on file import (docs/audit/
  // standalone-edition-plan.md §4.1). A WOD with none of the extra arrays
  // (club WODs, anything built before) reads as all-"reps", which is exactly
  // what it meant.
  if (scoreType === "emom") {
    const rawMovements = Array.isArray(w.emomMovements) ? w.emomMovements : [];
    const rawTypes = Array.isArray(w.emomMovementTypes) ? w.emomMovementTypes : [];
    const rawReps = Array.isArray(w.emomTargetReps) ? w.emomTargetReps : [];
    const rawDurations = Array.isArray(w.emomTargetDurations) ? w.emomTargetDurations : [];
    const rawWeights = Array.isArray(w.emomTargetWeights) ? w.emomTargetWeights : [];
    // Pair every per-station array to its original index BEFORE dropping
    // empty names - filtering the names first and then indexing the other
    // arrays by the new, shifted position would give every station after a
    // dropped one its neighbour's type and targets.
    const kept = rawMovements.slice(0, LIMITS.emomMovements)
      .map((n, i) => ({ i, name: cleanStr(n, LIMITS.nameLen) }))
      .filter((m) => m.name);
    out.emomMovements = kept.map((m) => m.name);
    out.emomMovementTypes = kept.map((m) => {
      const t = rawTypes[m.i];
      return t === "duration" || t === "rest" ? t : "reps";
    });
    out.emomTargetReps = kept.map((m) => Math.round(cleanNum(rawReps[m.i], 0, LIMITS.reps, 0)));
    out.emomTargetDurations = kept.map((m) => Math.round(cleanNum(rawDurations[m.i], 0, LIMITS.duration, 0)));
    out.emomTargetWeights = kept.map((m) => cleanNum(rawWeights[m.i], 0, LIMITS.weight, 0));
    out.emomMinutes = Math.round(cleanNum(w.emomMinutes, 1, LIMITS.minutes, 10));
    if (out.emomMovements.length === 0) return null;
  }
  // Optional reference-only time cap (e.g. "For Time, 20 min cap") — shown
  // in the log form, never enforced or scored against.
  const cap = cleanNum(w.timeCapSeconds, 0, LIMITS.minutes * 60 + 59, 0);
  out.timeCapSeconds = cap || null;
  return out;
}
function sanitizeEntry(e) {
  if (!e || typeof e !== "object") return null;
  const id = cleanId(e.id), exerciseId = cleanId(e.exerciseId), date = cleanISODate(e.date);
  if (!id || !exerciseId || !date) return null;
  const sets = cleanNum(e.sets, 0, LIMITS.sets, null);
  if (sets === null) return null;
  // "duration" entries (holds/carries) skip reps/est1RM entirely — a hold has
  // no rep count, and est1RM extrapolation is meaningless for time-under-load.
  // Weight stays optional (0 for a bodyweight hold, >0 for a weighted carry).
  const type = e.type === "duration" ? "duration" : "reps";
  const groupId = cleanId(e.groupId) || null;
  // Optional free tag ("A"/"B"/"C"/"D") for real A/B/C session-block
  // programming — set once per ladder/superset group, see ladderBlockLabel.
  const blockLabel = cleanStr(e.blockLabel, 8) || null;
  if (type === "duration") {
    const durationSeconds = cleanNum(e.durationSeconds, 1, LIMITS.duration, null);
    if (durationSeconds === null) return null;
    const weight = cleanNum(e.weight, 0, LIMITS.weight, 0);
    return {
      id, exerciseId, date, type, weight, reps: 0, sets: Math.round(sets),
      durationSeconds: Math.round(durationSeconds),
      ts: cleanTs(e.ts, date), updatedAt: modTs(e, date),
      isPR: e.isPR === true, groupId, blockLabel, est1RM: 0,
    };
  }
  const weight = cleanNum(e.weight, 0, LIMITS.weight, null);
  const reps = cleanNum(e.reps, 0, LIMITS.reps, null);
  if (weight === null || reps === null) return null;
  return {
    id, exerciseId, date, type, weight, reps, sets: Math.round(sets),
    durationSeconds: 0,
    ts: cleanTs(e.ts, date), updatedAt: modTs(e, date), isPR: e.isPR === true,
    // Links several rows saved as one working-set ladder or superset (same
    // groupId, one or two exerciseIds, same day) so the calendar day view
    // can group them — see renderCalDetail. null for an ordinary single set.
    groupId, blockLabel,
    est1RM: cleanNum(e.est1RM, 0, LIMITS.weight * 2, estimate1RM(weight, reps)),
  };
}
// The last-modified stamp, kept apart from ts (first saved, and the History
// sort key — bumping ts on an edit would jump an old workout to the top of the
// list). Returns undefined when the record has never carried one, so
// shouldApplyRemote can fall back to ts rather than compare against a
// fabricated time. See sanitizeWodEntry for the same rule.
function modTs(e, date) {
  if (e && e.updatedAt != null && isFinite(Number(e.updatedAt))) {
    const u = cleanTs(e.updatedAt, date);
    if (u) return u;
  }
  return undefined;
}
function sanitizeWodEntry(e) {
  if (!e || typeof e !== "object") return null;
  const id = cleanId(e.id), wodId = cleanId(e.wodId), date = cleanISODate(e.date);
  if (!id || !wodId || !date) return null;
  const scoreType = WOD_SCORE_TYPES.includes(e.scoreType) ? e.scoreType : "time";
  // EMOM has no cross-attempt scoring (yet) — never let a hand-edited import
  // claim a PR flame for it.
  // rx is THREE-VALUED (see WOD_EFFORT_PLUS in app.js): true Rx, false Scaled,
  // "plus" Rx+. `e.rx !== false` alone flattened Rx+ into plain Rx on the next
  // reload - every stored row goes back through here via reloadFromDb() and
  // applyRemotePrivateRecord(), so an unlisted third value is not merely
  // unvalidated, it is erased. The string is matched exactly and anything else
  // still collapses to Rx, which is the pre-existing default for a row that
  // never carried the field at all.
  const rx = e.rx === "plus" ? "plus" : e.rx !== false;
  const out = { id, wodId, date, scoreType, ts: cleanTs(e.ts, date), rx, isPR: scoreType === "emom" ? false : e.isPR === true };
  if (scoreType === "time") out.timeSeconds = cleanNum(e.timeSeconds, 0, LIMITS.minutes * 60 + 59, 0);
  else if (scoreType === "amrap") {
    out.rounds = Math.round(cleanNum(e.rounds, 0, LIMITS.rounds, 0));
    out.reps = Math.round(cleanNum(e.reps, 0, LIMITS.reps, 0));
  } else if (scoreType === "emom") {
    // No fixed movement count to validate against here (the WOD record that
    // defines it may not even be loaded yet during import) — just clamp
    // whatever array of rep counts came in; renderWodLogSection resizes it
    // to match the WOD's own movement count whenever it's actually shown.
    // It holds only the loggable (non-rest) stations, in rotation order, so
    // it is one shorter than emomMovements for each rest station - see
    // saveWod() and openWodEntryForEdit() for the compact/expand pair.
    const reps = Array.isArray(e.emomReps) ? e.emomReps : [];
    out.emomReps = reps.slice(0, LIMITS.emomMovements).map((r) => Math.round(cleanNum(r, 0, LIMITS.reps, 0)));
  } else out.weight = cleanNum(e.weight, 0, LIMITS.weight, 0);
  if (!out.rx) {
    const sw = cleanNum(e.scaledWeight, 0, LIMITS.weight, 0);
    if (sw) out.scaledWeight = sw;
  }
  // Notes apply regardless of Rx, because saveWod() WRITES them regardless of
  // Rx — and nothing clears the notes field when a member switches back to Rx.
  // Gating this on !out.rx silently destroyed hand-typed text on the next
  // reload (every stored row is re-sanitized by reloadFromDb and by
  // applyRemotePrivateRecord), which is the one kind of loss a training log
  // must never have: the member typed a sentence and the app ate it.
  // scaledWeight above stays gated — an Rx entry has no scaled weight by
  // definition — so the difference is deliberate, not an oversight.
  const notes = cleanStr(e.notes, LIMITS.notesLen);
  out.notes = notes || null;
  // updatedAt is the LAST-MODIFIED stamp, distinct from ts (first saved).
  // Preserved only when genuinely present: cleanTs() would invent one from the
  // date or the clock, and a fabricated modification time is worse than none.
  const wodMod = modTs(e, date);
  if (wodMod !== undefined) out.updatedAt = wodMod;
  // Applies regardless of Rx/Scaled — a partner WOD is a partner WOD either way.
  out.partnerTag = cleanStr(e.partnerTag, LIMITS.partnerTag) || null;
  return out;
}
function sanitizeBodyweight(e) {
  if (!e || typeof e !== "object") return null;
  const id = cleanId(e.id), date = cleanISODate(e.date);
  const weight = cleanNum(e.weight, 0, LIMITS.bodyweight, null);
  if (!id || !date || weight === null) return null;
  return { id, date, weight, ts: cleanTs(e.ts, date) };
}
function sanitizeMeasureType(t) {
  if (!t || typeof t !== "object") return null;
  const id = cleanId(t.id), name = cleanStr(t.name, LIMITS.nameLen);
  if (!id || !name) return null;
  return { id, name };
}
function sanitizeMeasurement(e) {
  if (!e || typeof e !== "object") return null;
  const id = cleanId(e.id), typeId = cleanId(e.typeId), date = cleanISODate(e.date);
  const value = cleanNum(e.value, 0, LIMITS.measurement, null);
  if (!id || !typeId || !date || value === null) return null;
  return { id, typeId, date, value, ts: cleanTs(e.ts, date) };
}
// Live bug hunt, round 9 (2026-09-11): `max` used to always default to
// LIMITS.importItems (20000) inside this function, so reloadFromDb() - which
// calls sanitizeList() on every ordinary boot, not just the explicit JSON
// import flow the cap was designed for - silently truncated any store past
// 20000 real rows. Confirmed live: 21001 seeded strength entries all
// persisted correctly to IndexedDB, but after a reload only 20000 were ever
// visible to the running app (no error, no warning) - and because
// IndexedDB's getAll() orders by primary key (a random uuid), the ~1000
// dropped rows were scattered roughly uniformly across the whole dataset,
// not a clean "oldest N" trim. A years-active member logging multiple sets
// a session is a realistic way to cross that count. `max` is now required
// at the one call site (the JSON-import path) that actually needs to bound
// untrusted input size; reloadFromDb()'s own on-disk reads - already
// validated data this app wrote itself - pass no cap at all.
function sanitizeList(list, fn, max) {
  if (!Array.isArray(list)) return [];
  const bounded = typeof max === "number" ? list.slice(0, max) : list;
  return bounded.map(fn).filter(Boolean);
}

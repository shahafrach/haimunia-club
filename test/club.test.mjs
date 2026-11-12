// CONNECTED MODE, PHASE 2: the club tab. Feed, reactions, announcements (read-only for members),
// and the coach's tools. The Supabase client is a fake that records every call; the backend does
// the real authorising, so these tests pin what is shown to whom and what is sent.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootApp } from "./helpers/boot.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label) { for (let i = 0; i < 150; i++) { if (fn()) return; await wait(10); } assert.fail("timed out: " + label); }

const ME = "u-me", OWNER = "u-owner", COACH = "u-coach", OTHER = "u-other";
function post(i, extra = {}) {
  return { post_id: "p" + i, author_id: OTHER, author_name: "נועה " + i, author_emoji: "🔥", post_type: "POST_WORKOUT", title: "אימון " + i,
    result_text: "20 דקות", body: null, metadata: {}, occurred_on: "2026-11-10", published_at: `2026-11-${String(30 - i).padStart(2, "0")}T10:00:00Z`,
    reaction_counts: { fire: 1 }, my_reactions: [], unreacted_pr: false, ...extra };
}
function backend({ role = "member", feed = [post(1), post(2)], rpcFail = {}, shareDefaults = {}, upsertFail = null } = {}) {
  const calls = [];
  const members = [
    { user_id: OWNER, role: "owner", joined_at: "2026-11-01", profiles: { display_name: "בעלים", emoji: "👑" } },
    { user_id: COACH, role: "coach", joined_at: "2026-11-02", profiles: { display_name: "מאמן", emoji: "🏋️" } },
    { user_id: OTHER, role: "member", joined_at: "2026-11-03", profiles: { display_name: "נועה", emoji: "🔥" } },
    { user_id: ME, role: role, joined_at: "2026-11-04", profiles: { display_name: "אני", emoji: "💪" } },
  ].filter((m) => m.user_id !== ME || role === "member" || false);
  const state = { posts: [], removed: [], announcements: [{ id: "a1", body: "אימון חג בשישי", pinned: true, created_at: "2026-11-09T08:00:00Z" }, { id: "a2", body: "הודעה ישנה", pinned: false, created_at: "2026-11-01T08:00:00Z" }] };
  const meId = role === "member" ? ME : role === "coach" ? COACH : OWNER;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: meId, is_anonymous: false } } } }),
      signOut: async () => {},
    },
    rpc: async (n, a) => {
      calls.push([n, a]);
      if (rpcFail[n]) return { data: null, error: { message: rpcFail[n] } };
      if (n === "circle_feed") return { data: a.p_cursor ? [] : feed, error: null };
      if (n === "toggle_reaction") return { data: true, error: null };
      if (n === "rotate_club_link") return { data: "cd".repeat(32), error: null };
      if (n === "post_delete") {
        const p = state.posts.find((x) => x.id === a.post_id);
        if (p) { state.posts = state.posts.filter((x) => x !== p); state.removed.push(p.source_record_id); }
        return { data: null, error: null };
      }
      if (n === "pr_share") return { data: "pr-post", error: null };
      return { data: null, error: null };
    },
    from: (t) => {
      const q = {
        select: () => q, eq: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: t === "clubs" ? { name: "האימוניה" } : { display_name: "אני", emoji: "💪" }, error: null }),
        then: (res) => {
          if (t === "circle_members") return res({ data: q._members ? members : [{ club_id: "c1", role, share_defaults: shareDefaults, clubs: { type: "club", name: "האימוניה" } }], error: null });
          if (t === "club_announcements") return res({ data: state.announcements, error: null });
          if (t === "workout_posts") return res({ data: state.posts.filter((p) => p.source_record_id === q._src), error: null });
          return res({ data: [], error: null });
        },
      };
      // The same table answers two questions: "which club am I in" (own row) and "who is in it" (the roster).
      const sel = q.select; q.select = (cols) => { q._members = /profiles/.test(cols || ""); return sel(); };
      q.upsert = async (row, opts) => {
        calls.push(["upsert:" + t, row, opts]);
        if (upsertFail) return { data: null, error: { message: upsertFail } };
        if (t === "workout_posts") {
          if (state.removed.includes(row.source_record_id)) return { data: null, error: { message: "new row violates row-level security policy for table \"workout_posts\"" } };
          if (!state.posts.some((p) => p.source_record_id === row.source_record_id)) state.posts.push({ id: "wp" + (state.posts.length + 1), source_record_id: row.source_record_id });
        }
        return { data: null, error: null };
      };
      const eq = q.eq; q.eq = (col, val) => { if (col === "source_record_id") q._src = val; return eq(); };
      return q;
    },
  };
  return { client, calls, state };
}

async function boot(opts = {}) {
  const be = backend(opts);
  const window = await bootApp({ beforeScripts: (w) => { w.supabase = { createClient: () => be.client }; w.scrollTo = () => {}; } });
  if (opts.connected !== false) {
    await window.dbSetSetting("haimunia:connectChoice", "connected");
    await window.haimuniaConnect.init();
  }
  return { window, ...be };
}
const $ = (w, s) => w.document.querySelector(s);
const $$ = (w, s) => [...w.document.querySelectorAll(s)];
async function openClub(window) {
  await until(() => $(window, "[data-action='switch-tab'][data-tab='club']"), "club tab");
  $(window, "[data-action='switch-tab'][data-tab='club']").click();
  await until(() => $$(window, "#content article").length > 0, "feed");
}
const rpcs = (calls, name) => calls.filter(([n]) => n === name);

test("offline, or not in the club: there is no club tab", async () => {
  const { window } = await boot({ connected: false });
  await wait(50);
  assert.equal($(window, "[data-tab='club']"), null);
});

test("a member sees the feed and announcements, read-only: no coach tools anywhere", async () => {
  const { window, calls } = await boot();
  await openClub(window);
  const html = $(window, "#content").textContent;
  assert.match(html, /אימון חג בשישי/);
  assert.match(html, /נעוץ/);
  assert.equal($$(window, "#content article").length, 2);
  assert.equal($(window, "[data-club-form='ann']"), null, "no announcement form");
  assert.equal($(window, "[data-club='pin']"), null);
  assert.equal($(window, "[data-club='del-ann']"), null);
  assert.equal($(window, "[data-club='del-post']"), null);
  assert.equal($(window, "[data-club='rotate']"), null);
  assert.deepEqual(rpcs(calls, "circle_feed")[0][1], { p_club_id: "c1", p_cursor: null, p_limit: 30 });
});

test("reactions: three kinds, toggled with the post id and kind, shown at once, undone if the server refuses", async () => {
  const { window, calls } = await boot();
  await openClub(window);
  const kinds = $$(window, "#content article:first-of-type [data-club='react']").map((b) => b.dataset.kind);
  assert.deepEqual(kinds, ["fist_bump", "fire", "clap"]);
  $(window, "#content article:first-of-type [data-kind='clap']").click();
  await until(() => rpcs(calls, "toggle_reaction").length === 1, "rpc");
  const [, args] = rpcs(calls, "toggle_reaction")[0];
  assert.equal(args.p_post_id, "p1"); assert.equal(args.p_kind, "clap");
  assert.equal($(window, "#content article:first-of-type [data-kind='clap']").getAttribute("aria-pressed"), "true");
  // Tap again: taken back.
  $(window, "#content article:first-of-type [data-kind='clap']").click();
  await until(() => rpcs(calls, "toggle_reaction").length === 2, "rpc 2");
  assert.equal($(window, "#content article:first-of-type [data-kind='clap']").getAttribute("aria-pressed"), "false");
});

test("a refused reaction is rolled back", async () => {
  const { window } = await boot({ rpcFail: { toggle_reaction: "rate_limited" } });
  await openClub(window);
  const btn = () => $(window, "#content article:first-of-type [data-kind='fire']");
  btn().click();
  await until(() => btn().getAttribute("aria-pressed") === "false" && /1/.test(btn().textContent), "rolled back");
});

test("a coach sees the tools; members' roster hides remove for the owner, and the call carries the right ids", async () => {
  const { window, calls } = await boot({ role: "coach" });
  await openClub(window);
  assert.ok($(window, "[data-club-form='ann']"));
  assert.ok($(window, "[data-club='pin']"));
  // Post an announcement, pinned.
  $(window, "#clubAnnBody").value = "מחר אימון בחוץ";
  $(window, "[data-club-form='ann'] [name='pinned']").checked = true;
  $(window, "[data-club-form='ann']").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await until(() => rpcs(calls, "club_announcement_post").length === 1, "post");
  assert.deepEqual(rpcs(calls, "club_announcement_post")[0][1], { p_club_id: "c1", p_body: "מחר אימון בחוץ", p_pinned: true });
  // Pin toggles.
  $(window, "[data-club='pin'][data-id='a2']").click();
  await until(() => rpcs(calls, "club_announcement_set_pinned").length === 1, "pin");
  assert.deepEqual(rpcs(calls, "club_announcement_set_pinned")[0][1], { p_id: "a2", p_pinned: true });
  // Delete a post: asks first, then calls post_delete.
  $(window, "[data-club='del-post'][data-id='p1']").click();
  assert.equal(rpcs(calls, "post_delete").length, 0, "nothing before the confirmation");
  $(window, "[data-action='app-confirm-yes']").click();
  await until(() => rpcs(calls, "post_delete").length === 1, "post_delete");
  assert.deepEqual(rpcs(calls, "post_delete")[0][1], { post_id: "p1" });
  await until(() => $$(window, "#content article").length === 1, "post gone");
  // Roster: no remove on the owner or on myself; one on the plain member.
  $(window, "[data-club='members']").click();
  await until(() => $$(window, "[data-club='rm-member']").length > 0, "roster");
  assert.deepEqual($$(window, "[data-club='rm-member']").map((b) => b.dataset.id), [OTHER]);
  $(window, "[data-club='rm-member']").click();
  $(window, "[data-action='app-confirm-yes']").click();
  await until(() => rpcs(calls, "remove_member").length === 1, "remove");
  assert.deepEqual(rpcs(calls, "remove_member")[0][1], { p_club_id: "c1", p_user_id: OTHER });
});

test("rotating the link asks first, then shows the new link once", async () => {
  const { window, calls } = await boot({ role: "coach" });
  await openClub(window);
  $(window, "[data-club='rotate']").click();
  assert.equal(rpcs(calls, "rotate_club_link").length, 0);
  $(window, "[data-action='app-confirm-yes']").click();
  await until(() => /#join=/.test($(window, "#content").textContent), "link shown");
  assert.match($(window, "#content").textContent, /#join=(cd){32}/);
  assert.deepEqual(rpcs(calls, "rotate_club_link")[0][1], { p_club_id: "c1" });
  $(window, "[data-club='hide-link']").click();
  assert.doesNotMatch($(window, "#content").textContent, /#join=/);
});

test("an empty announcement never reaches the server", async () => {
  const { window, calls } = await boot({ role: "owner" });
  await openClub(window);
  const submit = () => $(window, "[data-club-form='ann']").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  $(window, "#clubAnnBody").value = "   "; submit();
  await until(() => /כתבו משהו/.test($(window, "#content").textContent), "empty message");
  assert.equal(rpcs(calls, "club_announcement_post").length, 0);
});

test("the club source never touches the private log or any other table", async () => {
  const src = readFileSync(path.join(root, "src/club.js"), "utf8");
  assert.doesNotMatch(src, /private_records|bodyweight|dbGet|dbPut|entries\b/i);
  const tables = [...src.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(tables)], ["circle_members", "club_announcements", "workout_posts"]);
  assert.doesNotMatch(src, /\.from\("workout_posts"\)\.(delete|update|insert)/, "workout_posts is upserted or read; removal goes through post_delete");
});

// ---- Sharing workouts (owner decision 2026-11-11: feed and reactions; club default: every workout, no weights) ----
test("a logged lift posts the day to the club: names and results, never kilograms or body weight", async () => {
  const { window, calls } = await boot();
  await until(() => window.haimuniaClub.available(), "in club");
  window.choosePickedMovement("back-squat");
  window.applyFieldValue("step", "weight", 100);
  window.applyFieldValue("step", "reps", 5);
  await window.saveSet();
  await until(() => calls.some(([n]) => n === "upsert:workout_posts"), "upsert");
  const [, row, opts] = calls.find(([n]) => n === "upsert:workout_posts");
  assert.equal(opts.onConflict, "author_id,club_id,source_type,source_record_id");
  assert.deepEqual(Object.keys(row).sort(), ["author_id", "club_id", "occurred_on", "result_text", "rx", "source_record_id", "source_type", "title", "visibility"]);
  assert.equal(row.club_id, "c1"); assert.equal(row.author_id, ME); assert.equal(row.visibility, "club");
  assert.match(row.source_record_id, /^day:\d{4}-\d{2}-\d{2}$/);
  assert.doesNotMatch(JSON.stringify(row), /ק״ג|100|weight|משקל/, "no kilograms, no body weight");
  assert.match(row.result_text, /5 × /);
});

test("a member who turned sharing off posts nothing, and the switch is saved through set_share_defaults", async () => {
  const off = await boot({ shareDefaults: { share_workouts: false } });
  await until(() => off.window.haimuniaClub.available(), "in club");
  off.window.choosePickedMovement("back-squat");
  off.window.applyFieldValue("step", "weight", 80);
  off.window.applyFieldValue("step", "reps", 3);
  await off.window.saveSet();
  await wait(80);
  assert.equal(off.calls.filter(([n]) => n === "upsert:workout_posts").length, 0);

  const on = await boot();
  await openClub(on.window);
  $(on.window, "[data-club='share']").click();
  await until(() => rpcs(on.calls, "set_share_defaults").length === 1, "rpc");
  assert.deepEqual(rpcs(on.calls, "set_share_defaults")[0][1], { p_club_id: "c1", p_defaults: { share_workouts: false, show_weights: false } });
  assert.equal(on.window.haimuniaClub.sharingOn(), false);
});

test("a failed share never touches the log", async () => {
  const { window } = await boot({ upsertFail: "network" });
  await until(() => window.haimuniaClub.available(), "in club");
  window.choosePickedMovement("back-squat");
  window.applyFieldValue("step", "weight", 60);
  window.applyFieldValue("step", "reps", 8);
  await window.saveSet();
  await wait(80);
  const backup = await window.buildBackupPayload();
  assert.equal(backup.entries.length, 1, "the lift is saved on the phone");
});

test("dayPostRow: nothing without consent or without lines; weights only when the member chose them", () => {
  return boot({ connected: false }).then(({ window }) => {
    const f = window.haimuniaClub.dayPostRow;
    const sum = { day: "2026-11-12", lines: [{ title: "סקוואט", text: "100 ק״ג × 5 × 1", textNoWeight: "5 × 1", rx: null }] };
    assert.equal(f(sum, "c1", ME, { share_workouts: false }), null);
    assert.equal(f({ day: "2026-11-12", lines: [] }, "c1", ME, { share_workouts: true }), null);
    assert.equal(f(sum, "c1", ME, { share_workouts: true, show_weights: false }).result_text, "סקוואט 5 × 1");
    assert.equal(f(sum, "c1", ME, { share_workouts: true, show_weights: true }).result_text, "סקוואט 100 ק״ג × 5 × 1");
  });
});

test("deleting the day's last entry removes the day's post; logging again that day starts a new one", async () => {
  const { window, calls, state } = await boot();
  await until(() => window.haimuniaClub.available(), "in club");
  window.choosePickedMovement("back-squat");
  window.applyFieldValue("step", "weight", 100);
  window.applyFieldValue("step", "reps", 5);
  await window.saveSet();
  await until(() => state.posts.length === 1, "posted");
  const day = state.posts[0].source_record_id;
  const id = (await window.buildBackupPayload()).entries[0].id;
  await window.deleteEntry(id);
  await until(() => rpcs(calls, "post_delete").length === 1, "post_delete");
  assert.equal(rpcs(calls, "post_delete")[0][1].post_id, "wp1");
  assert.equal(state.posts.length, 0);
  window.choosePickedMovement("back-squat");
  window.applyFieldValue("step", "weight", 90);
  window.applyFieldValue("step", "reps", 5);
  await window.saveSet();
  await until(() => state.posts.length === 1, "posted again");
  assert.equal(state.posts[0].source_record_id, day + ":2", "a new key, not the removed one");
});

test("a day whose post the coach removed is written under the next key", async () => {
  const { window, state } = await boot();
  await until(() => window.haimuniaClub.available(), "in club");
  const today = window.todayISO();
  state.removed.push("day:" + today);
  window.choosePickedMovement("back-squat");
  window.applyFieldValue("step", "weight", 70);
  window.applyFieldValue("step", "reps", 5);
  await window.saveSet();
  await until(() => state.posts.length === 1, "posted");
  assert.equal(state.posts[0].source_record_id, "day:" + today + ":2");
});

test("a PR goes to the club as a percent, never kilograms; its post goes when the entry is deleted", async () => {
  const { window, calls, state } = await boot();
  await until(() => window.haimuniaClub.available(), "in club");
  assert.equal(window.clubPrPercent({ type: "reps" }, { repRecordPR: true, weight: 105, prevRepRecord: 100 }), 5);
  assert.equal(window.clubPrPercent({ type: "reps" }, { repRecordPR: false, est1rmPR: true, est: 110, prevEst1RM: 100 }), 10);
  assert.equal(window.clubPrPercent({ type: "reps" }, { repRecordPR: true, weight: 100, prevRepRecord: 0 }), null, "no history, no percent");
  await window.haimuniaClub.postPr("e1", "סקוואט", 5);
  const [, args] = rpcs(calls, "pr_share")[0];
  assert.equal(args.p_club_id, "c1"); assert.equal(args.record_id, "pr:e1");
  assert.equal(args.note, "שיא אישי בסקוואט: +5%");
  assert.equal("p_weight" in args, false, "no absolute weight");
  state.posts.push({ id: "wp-pr", source_record_id: "pr:e1" });
  await window.haimuniaClub.removePr("e1");
  assert.equal(rpcs(calls, "post_delete").at(-1)[1].post_id, "wp-pr");
  const off = await boot({ shareDefaults: { share_workouts: false } });
  await until(() => off.window.haimuniaClub.available(), "in club");
  assert.equal(await off.window.haimuniaClub.postPr("e2", "סקוואט", 5), false, "sharing off: no PR either");
});

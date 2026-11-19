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
function backend({ role = "member", feed = [post(1), post(2)], rpcFail = {}, shareDefaults = {}, upsertFail = null, inviteMissing = false } = {}) {
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
      if (n === "rotate_club_invite") {
        if (inviteMissing) return { data: null, error: { code: "PGRST202", message: "Could not find the function public.rotate_club_invite(p_club_id) in the schema cache" } };
        return { data: { token: "cd".repeat(32), code: "ABCD2345" }, error: null };
      }
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
  const window = await bootApp({ beforeScripts: (w) => {
    w.supabase = { createClient: () => be.client }; w.scrollTo = () => {};
    // jsdom loads no injected <script>; the QR encoder club.js would load on demand is put in place here.
    if (opts.qr) w.eval(readFileSync(path.join(root, "vendor/qrcode.js"), "utf8"));
  } });
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
// Every new workout asks "share to the club?" (owner decision 2026-11-14). A first entry's or a PR's
// card shows first, and the question waits for it to close.
async function answerShare(window, yes) {
  if (window.document.getElementById("celebrationOverlay").classList.contains("open")) window.closeCelebration();
  await until(() => $(window, "#appConfirmOverlay[data-confirm-kind='club-share-entry']"), "share question");
  $(window, yes ? "[data-action='app-confirm-yes']" : "[data-action='app-confirm-no']").click();
}
async function logLift(window, weight, reps, share = true) {
  window.choosePickedMovement("back-squat");
  window.applyFieldValue("step", "weight", weight);
  window.applyFieldValue("step", "reps", reps);
  await window.saveSet();
  if (share !== null) await answerShare(window, share);
}

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

test("rotating the link asks first, then shows the short link, its QR and the code once (Q-37)", async () => {
  const { window, calls } = await boot({ role: "coach", qr: true });
  await openClub(window);
  $(window, "[data-club='rotate']").click();
  assert.equal(rpcs(calls, "rotate_club_invite").length, 0);
  $(window, "[data-action='app-confirm-yes']").click();
  await until(() => $(window, "#clubInviteCode"), "code shown");
  assert.deepEqual(rpcs(calls, "rotate_club_invite")[0][1], { p_club_id: "c1" });
  assert.equal(rpcs(calls, "rotate_club_link").length, 0, "the new function, not the old one");
  const link = $(window, "#clubInviteLink").textContent;
  assert.match(link, /#j=ABCD2345$/, "the short link carries the code, never the long token");
  assert.doesNotMatch($(window, "#content").textContent, /(cd){32}/);
  assert.equal($(window, "#clubInviteCode").textContent, "ABCD 2345", "the code in two groups of four");
  assert.equal($(window, "#clubInviteCode").getAttribute("dir"), "ltr");
  await until(() => $(window, "#clubInvite svg.join-qr"), "QR");
  // The QR is the library's own matrix for the short link: one square per dark module, nothing else.
  const q = window.qrcode(0, "M"); q.addData(link); q.make();
  let dark = 0;
  for (let r = 0; r < q.getModuleCount(); r++) for (let c = 0; c < q.getModuleCount(); c++) if (q.isDark(r, c)) dark++;
  const d = $(window, "#clubInvite svg.join-qr path").getAttribute("d");
  assert.equal((d.match(/M/g) || []).length, dark);
  assert.equal($(window, "#clubInvite svg.join-qr").getAttribute("viewBox"), `0 0 ${q.getModuleCount() + 8} ${q.getModuleCount() + 8}`, "a four-module quiet zone");
  // The printed card: the QR, the steps, the link and the code.
  const card = $(window, "[data-invite-print]");
  assert.ok(card && card.querySelector("svg.join-qr"), "print card has the QR");
  assert.match(card.textContent, /ABCD 2345/);
  assert.match(card.textContent, /#j=ABCD2345/);
  let printed = 0; window.print = () => { printed++; };
  $(window, "[data-club='print-link']").click();
  assert.equal(printed, 1);
  let copied = ""; Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async (t) => { copied = t; } }, configurable: true });
  $(window, "[data-club='copy-code']").click();
  await until(() => copied === "ABCD2345", "code copied");
  $(window, "[data-club='hide-link']").click();
  assert.equal($(window, "#clubInvite"), null);
  assert.equal($(window, "[data-invite-print]"), null, "closing drops the card too");
});

test("before the backend has rotate_club_invite, the long link still works", async () => {
  const { window, calls } = await boot({ role: "owner", inviteMissing: true });
  await openClub(window);
  $(window, "[data-club='rotate']").click();
  $(window, "[data-action='app-confirm-yes']").click();
  await until(() => $(window, "#clubInviteLink"), "link shown");
  assert.match($(window, "#clubInviteLink").textContent, /#join=(cd){32}$/);
  assert.equal($(window, "#clubInviteCode"), null, "no code to show");
  assert.equal(rpcs(calls, "rotate_club_link").length, 1);
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

// ---- Sharing workouts (owner decisions 2026-11-11: feed and reactions; 2026-11-14: the member chooses per workout) ----
test("a lift the member chose to share posts the day: names and results, never kilograms or body weight", async () => {
  const { window, calls } = await boot();
  await until(() => window.haimuniaClub.available(), "in club");
  window.choosePickedMovement("back-squat");
  window.applyFieldValue("step", "weight", 100);
  window.applyFieldValue("step", "reps", 5);
  await window.saveSet();
  await wait(60);
  assert.equal(calls.filter(([n]) => n === "upsert:workout_posts").length, 0, "nothing is sent before the member answers");
  await answerShare(window, true);
  await until(() => calls.some(([n]) => n === "upsert:workout_posts"), "upsert");
  const [, row, opts] = calls.find(([n]) => n === "upsert:workout_posts");
  assert.equal(opts.onConflict, "author_id,club_id,source_type,source_record_id");
  assert.deepEqual(Object.keys(row).sort(), ["author_id", "club_id", "occurred_on", "result_text", "rx", "source_record_id", "source_type", "title", "visibility"]);
  assert.equal(row.club_id, "c1"); assert.equal(row.author_id, ME); assert.equal(row.visibility, "club");
  assert.match(row.source_record_id, /^day:\d{4}-\d{2}-\d{2}$/);
  assert.doesNotMatch(JSON.stringify(row), /ק״ג|100|weight|משקל/, "no kilograms, no body weight");
  assert.match(row.result_text, /5 × /);
});

test("not this time: the workout stays on the phone, and the next one asks again", async () => {
  const { window, calls } = await boot();
  await until(() => window.haimuniaClub.available(), "in club");
  await logLift(window, 80, 3, false);
  await wait(80);
  assert.equal(calls.filter(([n]) => n === "upsert:workout_posts").length, 0, "declined: nothing posted");
  const id = (await window.buildBackupPayload()).entries[0].id;
  assert.equal(window.haimuniaClub.isShared(id), false);
  await logLift(window, 85, 3, true);
  await until(() => calls.some(([n]) => n === "upsert:workout_posts"), "second one shared");
  const row = calls.find(([n]) => n === "upsert:workout_posts")[1];
  assert.doesNotMatch(row.title, /ועוד/, "only the shared lift is in the day post");
  assert.doesNotMatch(row.result_text, /·/, "one line, not two");
});

test("the club tab has no all-or-nothing switch any more; it explains the per-workout question", async () => {
  const { window } = await boot();
  await openClub(window);
  assert.equal($(window, "[data-club='share']"), null);
  assert.match($(window, "#content").textContent, /אחרי כל אימון שנרשם תישאלו אם לשתף אותו/);
});

test("an edit keeps the answer the workout already had: no second question", async () => {
  const { window, calls } = await boot();
  await until(() => window.haimuniaClub.available(), "in club");
  await logLift(window, 100, 5, true);
  await until(() => calls.some(([n]) => n === "upsert:workout_posts"), "shared");
  const id = (await window.buildBackupPayload()).entries[0].id;
  const before = calls.filter(([n]) => n === "upsert:workout_posts").length;
  await window.startEditEntry(id);
  window.applyFieldValue("step", "reps", 6);
  await window.saveSet();
  await until(() => calls.filter(([n]) => n === "upsert:workout_posts").length > before, "day updated");
  assert.equal($(window, "#appConfirmOverlay[data-confirm-kind='club-share-entry']"), null, "no question on an edit");
});

test("a failed share never touches the log", async () => {
  const { window } = await boot({ upsertFail: "network" });
  await until(() => window.haimuniaClub.available(), "in club");
  await logLift(window, 60, 8, true);
  await wait(80);
  const backup = await window.buildBackupPayload();
  assert.equal(backup.entries.length, 1, "the lift is saved on the phone");
});

test("dayPostRow: nothing without lines; weights only when the member chose them", () => {
  return boot({ connected: false }).then(({ window }) => {
    const f = window.haimuniaClub.dayPostRow;
    const sum = { day: "2026-11-12", lines: [{ title: "סקוואט", text: "100 ק״ג × 5 × 1", textNoWeight: "5 × 1", rx: null }] };
    assert.equal(f({ day: "2026-11-12", lines: [] }, "c1", ME, { share_workouts: true }), null);
    assert.equal(f(sum, "c1", ME, { share_workouts: true, show_weights: false }).result_text, "סקוואט 5 × 1");
    assert.equal(f(sum, "c1", ME, { share_workouts: true, show_weights: true }).result_text, "סקוואט 100 ק״ג × 5 × 1");
  });
});

test("deleting the day's last entry removes the day's post; logging again that day starts a new one", async () => {
  const { window, calls, state } = await boot();
  await until(() => window.haimuniaClub.available(), "in club");
  await logLift(window, 100, 5, true);
  await until(() => state.posts.length === 1, "posted");
  const day = state.posts[0].source_record_id;
  const id = (await window.buildBackupPayload()).entries[0].id;
  await window.deleteEntry(id);
  await until(() => rpcs(calls, "post_delete").length === 1, "post_delete");
  assert.equal(rpcs(calls, "post_delete")[0][1].post_id, "wp1");
  assert.equal(state.posts.length, 0);
  await logLift(window, 90, 5, true);
  await until(() => state.posts.length === 1, "posted again");
  assert.equal(state.posts[0].source_record_id, day + ":2", "a new key, not the removed one");
});

test("a day whose post the coach removed is written under the next key", async () => {
  const { window, state } = await boot();
  await until(() => window.haimuniaClub.available(), "in club");
  const today = window.todayISO();
  state.removed.push("day:" + today);
  await logLift(window, 70, 5, true);
  await until(() => state.posts.length === 1, "posted");
  assert.equal(state.posts[0].source_record_id, "day:" + today + ":2");
});

test("a PR goes to the club as a percent, never kilograms; its post goes when the entry is deleted", async () => {
  const { window, calls, state } = await boot();
  await until(() => window.haimuniaClub.available(), "in club");
  assert.equal(window.clubPrPercent({ type: "reps" }, { repRecordPR: true, weight: 105, prevRepRecord: 100 }), 5);
  assert.equal(window.clubPrPercent({ type: "reps" }, { repRecordPR: false, est1rmPR: true, est: 110, prevEst1RM: 100 }), 10);
  assert.equal(window.clubPrPercent({ type: "reps" }, { repRecordPR: true, weight: 100, prevRepRecord: 0 }), null, "no history, no percent");
  assert.equal(await window.haimuniaClub.postPr("e1", "סקוואט", 5), false, "a workout not answered yes sends no PR card");
  window.haimuniaClub.setShared("e1", true);
  await window.haimuniaClub.postPr("e1", "סקוואט", 5);
  const [, args] = rpcs(calls, "pr_share")[0];
  assert.equal(args.p_club_id, "c1"); assert.equal(args.record_id, "pr:e1");
  assert.equal(args.note, "שיא אישי בסקוואט: +5%");
  assert.equal("p_weight" in args, false, "no absolute weight");
  state.posts.push({ id: "wp-pr", source_record_id: "pr:e1" });
  await window.haimuniaClub.removePr("e1");
  assert.equal(rpcs(calls, "post_delete").at(-1)[1].post_id, "wp-pr");
  window.haimuniaClub.setShared("e2", false);
  assert.equal(await window.haimuniaClub.postPr("e2", "סקוואט", 5), false, "not this time: no PR card either");
});

test("undo of a deleted PR entry brings its PR card back, under a new key", async () => {
  const { window, calls, state } = await boot();
  await until(() => window.haimuniaClub.available(), "in club");
  window.haimuniaClub.setShared("e9", true);
  await window.haimuniaClub.postPr("e9", "דדליפט", 4);
  state.posts.push({ id: "wp-pr9", source_record_id: "pr:e9" });
  await window.haimuniaClub.removePr("e9");
  assert.equal(rpcs(calls, "post_delete").at(-1)[1].post_id, "wp-pr9");
  await window.haimuniaClub.restorePr("e9");
  const shares = rpcs(calls, "pr_share");
  assert.equal(shares.length, 2);
  assert.equal(shares[1][1].record_id, "pr:e9:2", "not the removed key, which pr_share would hand back as is");
  assert.equal(shares[1][1].note, "שיא אישי בדדליפט: +4%");
  assert.equal(await window.haimuniaClub.restorePr("never-shared"), false, "nothing to restore for an entry that had no PR card");
});

test("the club tab is a scene like the other tabs: scene chrome, app chevron, shared section headers", async () => {
  const { window } = await boot({ role: "coach" });
  await openClub(window);
  // Registered in PAGE_SCENES: body[data-scene] gives it the scene header, the dark nav and
  // #app's zero bottom padding (without it a lighter band sat between the last card and the nav).
  assert.equal(window.document.body.dataset.scene, "scene-page--community");
  // Members accordion: the app's ICONS.chevron, turned like every other accordion (180deg closed, 90deg open).
  const toggle = () => $(window, "[data-club='members']");
  const turn = () => toggle().querySelector("span[aria-hidden='true']").getAttribute("style");
  assert.doesNotMatch(toggle().textContent, /[▲▼]/);
  assert.ok(toggle().querySelector("svg"), "chevron icon");
  assert.match(turn(), /rotate\(180deg\)/);
  toggle().click();
  await until(() => toggle().getAttribute("aria-expanded") === "true", "members open");
  assert.match(turn(), /rotate\(90deg\)/);
  // Section headers use the app's .section-label, coach tools included.
  assert.deepEqual($$(window, "#content h2.section-label").map((h) => h.textContent), ["הודעות", "הפיד", "כלי מאמן"]);
  assert.equal($(window, "#content .settings-block-title"), null);
  // Publish is the app's primary button.
  assert.ok($(window, "[data-club-form='ann'] button[type='submit'].save-btn"));
  // Another tab stamps its own scene again.
  $(window, "[data-action='switch-tab'][data-tab='add']").click();
  await until(() => window.document.body.dataset.scene === "scene-page--add", "add scene");
});

// The welcome sheet is still open after boot in these tests; with it open behind the card, closing the
// card pops nothing. Answer it first, as a member does, so the card is the only dialog.
async function passWelcome(window) {
  const w = window.document.getElementById("welcomeOverlay");
  if (!w.classList.contains("open")) return;
  window.document.getElementById("welcomeNameInput").value = "דנה";
  $(window, "[data-action='save-user-name']").click();
  await until(() => !w.classList.contains("open"), "welcome closed");
  await wait(60);
}

// F-015 (3.9.0 verification, real Chromium): closing the first-entry card calls history.back() in the dialog
// history layer; its popstate can land after "לשתף במועדון?" has opened and pushed its own entry. That pop
// is the app's own, not the member's, so it must not close the question (and must not record "not shared").
// jsdom's own back() timing never shows the race, so back() is held here and its popstate fired by hand
// after the question is open, which is the order the real-Chromium trace showed.
test("F-015: the popstate from the card's own history.back() leaves the share question open; a real back still closes it", async () => {
  const { window } = await boot();
  await until(() => window.haimuniaClub.available(), "in club");
  await passWelcome(window);
  let backs = 0;
  window.history.back = () => { backs++; };
  const pop = () => window.dispatchEvent(new window.PopStateEvent("popstate", { state: window.history.state }));
  const question = () => $(window, "#appConfirmOverlay[data-confirm-kind='club-share-entry']");
  const choice = (id) => JSON.parse(window.localStorage.getItem("haimunia:clubShareChoice") || "{}")["c1|" + id];

  logLift(window, 80, 3, null);
  await until(() => window.document.getElementById("celebrationOverlay").classList.contains("open"), "first-entry card");
  window.closeCelebration();
  await until(question, "share question");
  assert.equal(backs, 1, "closing the card consumed its history entry with history.back()");
  const id = (await window.buildBackupPayload()).entries[0].id;

  pop(); // the card's own back() lands now
  await wait(60);
  assert.ok(question(), "the question is still open");
  assert.equal(choice(id), undefined, "and nothing was recorded for the workout");
  assert.ok(window.history.state && window.history.state.appDialog, "the question still holds a reserved history entry");

  pop(); // the member presses back
  await wait(60);
  assert.equal(question(), null, "a real back-press closes the question");
  assert.equal(choice(id), false, "and counts as not this time");
});

test("F-015: answering yes still works after the card's own popstate", async () => {
  const { window, calls } = await boot();
  await until(() => window.haimuniaClub.available(), "in club");
  await passWelcome(window);
  window.history.back = () => {};
  logLift(window, 80, 3, null);
  await until(() => window.document.getElementById("celebrationOverlay").classList.contains("open"), "first-entry card");
  window.closeCelebration();
  await until(() => $(window, "#appConfirmOverlay[data-confirm-kind='club-share-entry']"), "share question");
  window.dispatchEvent(new window.PopStateEvent("popstate", { state: window.history.state }));
  await wait(60);
  $(window, "[data-action='app-confirm-yes']").click();
  await until(() => calls.some(([n]) => n === "upsert:workout_posts"), "shared");
  const id = (await window.buildBackupPayload()).entries[0].id;
  assert.equal(window.haimuniaClub.isShared(id), true);
});

// F-018 (real Chromium, 3.9.0): toast() only queued the toast; nothing rendered after the async failure, so
// the member never saw it. The toast must be in the DOM with no further action: these tests only wait.
const dockText = (window) => (window.document.getElementById("appToastDock") || { textContent: "" }).textContent;
test("F-018: the upsert fails after 'לשתף', and its toast is painted with no further action", async () => {
  const { window } = await boot({ upsertFail: "network" });
  await until(() => window.haimuniaClub.available(), "in club");
  await logLift(window, 60, 8, true);
  await until(() => /השינוי נשמר בטלפון\. המועדון לא התעדכן הפעם\./.test(dockText(window)), "the failure toast in the dock");
});

test("F-018: a PR share that fails paints its toast too", async () => {
  const { window, calls } = await boot({ rpcFail: { pr_share: "network" } });
  await until(() => window.haimuniaClub.available(), "in club");
  window.haimuniaClub.setShared("e1", true);
  assert.equal(await window.haimuniaClub.postPr("e1", "סקוואט", 5), false, "the share failed");
  assert.equal(rpcs(calls, "pr_share").length, 1);
  await until(() => /השיא נשמר בטלפון\. השיתוף במועדון לא הצליח הפעם\./.test(dockText(window)), "the PR failure toast in the dock");
});

test("staff never reset a member's password (Q-38c): recovery is self-service only", () => {
  const src = readFileSync(path.join(root, "src/club.js"), "utf8");
  assert.doesNotMatch(src, /club_issue_reset_code|איפוס סיסמה/);
});

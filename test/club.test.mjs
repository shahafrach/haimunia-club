// CONNECTED MODE, PHASE 2: the club tab. Announcements (read-only for members), the roster, and the
// coach's tools. There is deliberately no feed, no posting and no reactions: no workout is ever posted
// from this app. The Supabase client is a fake that records every call; the backend does the real
// authorising, so these tests pin what is shown to whom and what is sent.
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
const ANNOUNCEMENTS = [
  { id: "a1", body: "אימון חג בשישי", pinned: true, created_at: "2026-11-09T08:00:00Z" },
  { id: "a2", body: "הודעה ישנה", pinned: false, created_at: "2026-11-01T08:00:00Z" },
];
function backend({ role = "member", rpcFail = {}, announcements = ANNOUNCEMENTS } = {}) {
  const calls = [];
  const members = [
    { user_id: OWNER, role: "owner", joined_at: "2026-11-01", profiles: { display_name: "בעלים", emoji: "👑" } },
    { user_id: COACH, role: "coach", joined_at: "2026-11-02", profiles: { display_name: "מאמן", emoji: "🏋️" } },
    { user_id: OTHER, role: "member", joined_at: "2026-11-03", profiles: { display_name: "נועה", emoji: "🔥" } },
    { user_id: ME, role: "member", joined_at: "2026-11-04", profiles: { display_name: "אני", emoji: "💪" } },
  ].filter((m) => m.user_id !== ME || role === "member");
  const meId = role === "member" ? ME : role === "coach" ? COACH : OWNER;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: meId, is_anonymous: false } } } }),
      signOut: async () => {},
    },
    rpc: async (n, a) => {
      calls.push([n, a]);
      if (rpcFail[n]) return { data: null, error: { message: rpcFail[n] } };
      if (n === "rotate_club_link") return { data: "cd".repeat(32), error: null };
      return { data: null, error: null };
    },
    from: (t) => {
      calls.push(["from", t]);
      const q = {
        select: () => q, eq: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: t === "clubs" ? { name: "האימוניה" } : { display_name: "אני", emoji: "💪" }, error: null }),
        then: (res) => {
          if (t === "circle_members") return res({ data: q._members ? members : [{ club_id: "c1", role }], error: null });
          if (t === "club_announcements") return res({ data: announcements, error: null });
          return res({ data: [], error: null });
        },
      };
      // The same table answers two questions: "which club am I in" (own row) and "who is in it" (the roster).
      const sel = q.select; q.select = (cols) => { q._members = /profiles/.test(cols || ""); return sel(); };
      return q;
    },
  };
  return { client, calls };
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
async function openClub(window, expect = /הודעות/) {
  await until(() => $(window, "[data-action='switch-tab'][data-tab='club']"), "club tab");
  $(window, "[data-action='switch-tab'][data-tab='club']").click();
  await until(() => expect.test($(window, "#content").textContent), "club tab content");
}
const rpcs = (calls, name) => calls.filter(([n]) => n === name);
const NEVER = ["circle_feed", "toggle_reaction", "post_create", "post_delete", "post_edit_caption"];

test("offline, or not in the club: there is no club tab", async () => {
  const { window } = await boot({ connected: false });
  await wait(50);
  assert.equal($(window, "[data-tab='club']"), null);
});

test("a member sees announcements read-only: no coach tools, and no feed, posts or reactions at all", async () => {
  const { window, calls } = await boot();
  await openClub(window);
  const text = $(window, "#content").textContent;
  assert.match(text, /אימון חג בשישי/);
  assert.match(text, /נעוץ/);
  for (const sel of ["[data-club-form='ann']", "[data-club='pin']", "[data-club='del-ann']", "[data-club='rotate']", "[data-club='react']", "[data-club='del-post']", "#content article"]) {
    assert.equal($(window, sel), null, sel);
  }
  assert.doesNotMatch(text, /הפיד|פוסטים/);
  for (const n of NEVER) assert.equal(rpcs(calls, n).length, 0, n);
});

test("with no announcements a member is told so", async () => {
  const { window } = await boot({ announcements: [] });
  await openClub(window, /אין הודעות כרגע/);
});

test("a coach sees the tools and every call carries the right ids", async () => {
  const { window, calls } = await boot({ role: "coach" });
  await openClub(window, /אימון חג בשישי/);
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
  // Delete an announcement: asks first, then calls the RPC.
  $(window, "[data-club='del-ann'][data-id='a2']").click();
  assert.equal(rpcs(calls, "club_announcement_delete").length, 0, "nothing before the confirmation");
  $(window, "[data-action='app-confirm-yes']").click();
  await until(() => rpcs(calls, "club_announcement_delete").length === 1, "delete");
  assert.deepEqual(rpcs(calls, "club_announcement_delete")[0][1], { p_id: "a2" });
  // Roster: no remove on the owner or on myself; one on the plain member.
  $(window, "[data-club='members']").click();
  await until(() => $$(window, "[data-club='rm-member']").length > 0, "roster");
  assert.deepEqual($$(window, "[data-club='rm-member']").map((b) => b.dataset.id), [OTHER]);
  $(window, "[data-club='rm-member']").click();
  $(window, "[data-action='app-confirm-yes']").click();
  await until(() => rpcs(calls, "remove_member").length === 1, "remove");
  assert.deepEqual(rpcs(calls, "remove_member")[0][1], { p_club_id: "c1", p_user_id: OTHER });
  for (const n of NEVER) assert.equal(rpcs(calls, n).length, 0, n);
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
  $(window, "#clubAnnBody").value = "   ";
  $(window, "[data-club-form='ann']").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await until(() => /כתבו משהו/.test($(window, "#content").textContent), "empty message");
  assert.equal(rpcs(calls, "club_announcement_post").length, 0);
});

test("the club source has no feed, posting or reaction code, and touches only two tables", async () => {
  const src = readFileSync(path.join(root, "src/club.js"), "utf8");
  assert.doesNotMatch(src, /private_records|bodyweight|dbGet|dbPut|entries\b/i);
  for (const n of NEVER) assert.equal(src.includes(n), false, n);
  const tables = [...src.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(tables)], ["circle_members", "club_announcements"]);
});

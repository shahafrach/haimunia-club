#!/usr/bin/env node
// Q-47: sharing a workout that is already logged. In לוח שנה's day detail and on the PR card in התקדמות, a
// connected member gets "שיתוף במועדון"; one tap posts it (and the PR card) through the save bar's own path,
// then shows "שותף במועדון" with הסרה. 375px phone, normal and 200% text (CSS zoom 2): no sideways scroll,
// nothing cut, controls >= 44px. Local only (fake client, lib/mockCloud.mjs).
import { chromium } from "playwright";
import { resolveLocalOnlyTarget } from "./lib/target.mjs";
import { consoleErrorCollector, dismissWelcomeModal } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`); if (!ok) failed = true; }
const SHOTS = "/tmp/claude-0/-home-user/2bd321ec-b56f-56fc-bbf9-9cf5d21706bb/scratchpad";
const target = await resolveLocalOnlyTarget();
console.log(`Target: ${target.url} (local static server)`);
const browser = await chromium.launch();

function fakeClubClient() {
  window.__clubCalls = [];
  const calls = window.__clubCalls;
  const posts = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u-me", is_anonymous: false } } } }), signOut: async () => {} },
    rpc: async (n, a) => { calls.push(n); if (n === "circle_feed") return { data: [], error: null }; if (n === "pr_share") return { data: "pr-post", error: null }; return { data: null, error: null }; },
    from: (t) => {
      const q = {
        select: () => q, eq: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: t === "clubs" ? { name: "האימוניה" } : { display_name: "אני", emoji: "💪" }, error: null }),
        then: (res) => {
          if (t === "circle_members") return res({ data: [{ club_id: "c1", role: "member", share_defaults: {}, clubs: { type: "club", name: "האימוניה" } }], error: null });
          if (t === "workout_posts") return res({ data: posts.filter((p) => p.source_record_id === q._src), error: null });
          return res({ data: [], error: null });
        },
      };
      q.upsert = async (row) => { calls.push("upsert:" + t); if (t === "workout_posts") posts.push({ id: "wp" + posts.length, source_record_id: row.source_record_id }); return { data: null, error: null }; };
      const eq = q.eq; q.eq = (col, val) => { if (col === "source_record_id") q._src = val; return eq(); };
      return q;
    },
  };
  window.supabase = { createClient: () => client };
}

const measure = (page, scope) => page.evaluate((s) => {
  const de = document.documentElement, root = document.querySelector(s);
  const ctrls = [...root.querySelectorAll(".club-share-line button")].filter((e) => e.offsetParent);
  return { page: de.scrollWidth <= de.clientWidth + 1, n: ctrls.length,
    small: ctrls.filter((b) => b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim()),
    cut: ctrls.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim()) };
}, scope);

for (const scale of [1, 2]) {
  const tag = scale === 1 ? "100%" : "200%";
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: "he-IL" });
  const page = await context.newPage();
  const errors = await consoleErrorCollector(page);
  await installMockCloud(page);
  await page.addInitScript(fakeClubClient);
  if (scale !== 1) await page.addInitScript((z) => { document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.zoom = String(z); }); }, scale);
  await page.goto(target.url, { waitUntil: "networkidle" });
  await dismissWelcomeModal(page);
  const d = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  await page.evaluate(async (d) => {
    for (let i = 1; i <= 3; i++) await window.dbPut({ id: "seed-" + i, exerciseId: "back-squat", date: d, type: "reps", weight: 60, reps: 5, sets: 1, durationSeconds: 0, ts: Date.now() - 86400000 * 2 + i, isPR: false, groupId: null, blockLabel: null, est1RM: 70 });
    await window.dbPut({ id: "pr-1", exerciseId: "back-squat", date: d, type: "reps", weight: 80, reps: 5, sets: 1, durationSeconds: 0, ts: Date.now() - 86400000 * 2 + 9, isPR: true, groupId: null, blockLabel: null, est1RM: 93.3 });
    await window.dbSetSetting("haimunia:connectChoice", "connected");
  }, d);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => window.haimuniaClub && window.haimuniaClub.available(), null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => document.querySelectorAll(".modal-overlay.open").forEach((o) => o.classList.remove("open")));

  // לוח שנה: list view of this month, the seeded day's rows.
  await page.click("#tabCalendarBtn");
  await page.evaluate((d) => { if (typeof calSelectedDate !== "undefined") { calSelectedDate = d; render(); } }, d);
  await page.waitForSelector("#calDetail .club-share-line", { timeout: 8000 });
  let f = await measure(page, "#calDetail");
  check(`[${tag}] לוח שנה: a share button under each logged lift, >= 44px, nothing cut, no sideways scroll`, f.n >= 1 && !f.small.length && !f.cut.length && f.page, JSON.stringify(f));
  if (scale === 1) await page.locator("#calDetail").screenshot({ path: `${SHOTS}/q47-cal-before.png` }).catch(() => {});
  await page.click("#calDetail [data-action='club-share-later'] >> nth=0");
  await page.waitForSelector("#calDetail .club-shared-tag", { timeout: 6000 });
  await page.waitForFunction(() => window.__clubCalls.includes("upsert:workout_posts"), null, { timeout: 6000 }).catch(() => {});
  f = await measure(page, "#calDetail");
  check(`[${tag}] לוח שנה: after the tap, 'שותף במועדון' and הסרה; the day was posted`, f.page && !f.small.length && !f.cut.length && (await page.evaluate(() => window.__clubCalls.includes("upsert:workout_posts"))), JSON.stringify(f));
  if (scale === 1) await page.locator("#calDetail").screenshot({ path: `${SHOTS}/q47-cal-after.png` }).catch(() => {});

  // התקדמות: the PR card.
  await page.click("#tabHistoryBtn");
  await page.click("[data-action='select-history'][data-id='back-squat']");
  await page.waitForSelector(".club-pr-share", { timeout: 6000 });
  f = await measure(page, ".club-pr-share");
  check(`[${tag}] התקדמות: the PR card has the share line, >= 44px, nothing cut`, f.n === 1 && !f.small.length && !f.cut.length && f.page, JSON.stringify(f));
  if (scale === 1) await page.locator(".club-pr-share").screenshot({ path: `${SHOTS}/q47-pr.png` }).catch(() => {});
  check(`[${tag}] no console errors, nothing left the origin`, errors.length === 0 && page.__foreignRequests.length === 0, errors.concat(page.__foreignRequests).join(" | "));
  await context.close();
}
await browser.close();
await target.close();
if (failed) { console.log("\nFAILED"); process.exit(1); }
console.log("\nAll share-later checks passed.");

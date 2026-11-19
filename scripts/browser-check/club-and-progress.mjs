#!/usr/bin/env node
// Q-43d: the club tab (pinned announcements, the feed, one members row, and the coach's "ניהול המועדון" fold,
// closed and open) and התקדמות (one streak card, the "מדדי גוף" fold) on a 375px phone, at normal and at 200%
// text (CSS zoom 2). No sideways scroll, nothing cut, every control at least 44px. Local only: the Supabase
// client is a fake set before the app loads (as in join-code-screens.mjs) and lib/mockCloud.mjs aborts
// anything that leaves the origin.
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

function fakeSupabase({ role }) {
  const member = [{ club_id: "c1", role, share_defaults: {}, clubs: { name: "האימוניה" } }];
  const ann = [
    { id: "a1", body: "אימון חג בשישי ב-8:00", pinned: true, created_at: new Date().toISOString() },
    { id: "a2", body: "הודעה ישנה", pinned: false, created_at: new Date(Date.now() - 86400000).toISOString() },
  ];
  window.supabase = {
    createClient: () => {
      const result = (table) => {
        if (table === "circle_members") return { data: member, error: null };
        if (table === "club_announcements") return { data: ann, error: null };
        return { data: [], error: null };
      };
      const query = (table) => {
        const q = {};
        for (const m of ["select", "eq", "order", "limit", "lt", "in", "is", "neq", "gte", "lte", "range", "update", "upsert", "insert", "delete"]) q[m] = () => q;
        q.maybeSingle = async () => ({ data: { display_name: "בדיקה", emoji: "💪" }, error: null });
        q.single = q.maybeSingle;
        q.then = (ok, no) => Promise.resolve(result(table)).then(ok, no);
        return q;
      };
      return {
        auth: {
          getSession: async () => ({ data: { session: { user: { id: "u1", is_anonymous: false } } } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signOut: async () => ({}),
        },
        rpc: async (n) => {
          if (n === "circle_feed") return { data: [{ post_id: "p1", author_name: "דנה", author_emoji: "🔥", published_at: new Date().toISOString(), title: "Fran", result_text: "4:12", reaction_counts: {}, my_reactions: [] }], error: null };
          return { data: [], error: null };
        },
        from: query,
        functions: { invoke: async () => ({ data: null, error: { message: "not in this check" } }) },
      };
    },
  };
}

async function newPage(scale, fake) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: "he-IL" });
  const page = await context.newPage();
  const errors = await consoleErrorCollector(page);
  await installMockCloud(page);
  if (fake) await page.addInitScript(fakeSupabase, fake);
  if (scale !== 1) await page.addInitScript((z) => { document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.zoom = String(z); }); }, scale);
  return { context, page, errors };
}
const measure = (page, scope) => page.evaluate((s) => {
  const de = document.documentElement, root = document.querySelector(s);
  const vis = (e) => e.offsetParent && e.getClientRects().length;
  const ctrls = [...root.querySelectorAll("button, summary, input:not([type=checkbox]), textarea")].filter(vis);
  return {
    page: de.scrollWidth <= de.clientWidth + 1,
    small: ctrls.filter((b) => b.getBoundingClientRect().height < 44).map((b) => (b.textContent || b.name || b.id).trim().slice(0, 24)),
    cut: ctrls.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => (b.textContent || b.id).trim().slice(0, 24)),
  };
}, scope);
const ok = (f) => f.page && !f.small.length && !f.cut.length;

for (const scale of [1, 2]) {
  const tag = scale === 1 ? "100%" : "200%";
  for (const role of ["member", "coach"]) {
    const { context, page, errors } = await newPage(scale, { role });
    await page.goto(target.url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#app", { state: "visible", timeout: 15000 });
    await page.evaluate(async () => {
      await window.dbSetSetting("haimunia:userName", "בדיקה");
      await window.dbSetSetting("haimunia:connectChoice", "connected");
      try { localStorage.setItem("haimunia:firstImportAnswered", "1"); } catch (e) {}
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-action='switch-tab'][data-tab='club']:visible", { timeout: 15000 });
    await page.evaluate(() => document.querySelectorAll(".modal-overlay.open").forEach((o) => o.classList.remove("open")));
    await page.click("[data-action='switch-tab'][data-tab='club']:visible");
    await page.waitForSelector("#content article", { timeout: 10000 });
    const order = await page.evaluate(() => {
      const c = document.getElementById("content");
      return { heads: [...c.querySelectorAll("h2.section-label")].map((h) => h.textContent), unpinned: /הודעה ישנה/.test([...c.querySelectorAll(".scene-sheet > .card")].map((x) => x.textContent).join(" ")),
        admin: !!document.getElementById("clubAdmin"), members: !!c.querySelector("[data-club='members']") };
    });
    const wantAdmin = role === "coach";
    check(`[${tag}] ${role}: pinned, then the feed, one members row${wantAdmin ? ", ניהול המועדון" : ", no coach tools"}`,
      order.heads.join("/") === "הודעות/הפיד" && !order.unpinned && order.members && order.admin === wantAdmin, JSON.stringify(order));
    let f = await measure(page, "#content");
    check(`[${tag}] ${role}: club tab fits, controls >= 44px, nothing cut`, ok(f), JSON.stringify(f));
    if (wantAdmin) {
      await page.click("#clubAdmin > summary");
      f = await measure(page, "#clubAdmin");
      check(`[${tag}] coach: ניהול המועדון open fits, controls >= 44px, nothing cut`, ok(f), JSON.stringify(f));
      if (scale === 1) await page.screenshot({ path: `${SHOTS}/q43d-club-admin.png`, fullPage: true }).catch(() => {});
    }
    check(`[${tag}] ${role}: no console errors, nothing left the origin`, errors.length === 0 && page.__foreignRequests.length === 0, errors.concat(page.__foreignRequests).join(" | "));
    await context.close();
  }
  {
    const { context, page, errors } = await newPage(scale, null);
    await page.goto(target.url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#app", { state: "visible", timeout: 15000 });
    await dismissWelcomeModal(page);
    await page.evaluate(() => { if (window.haimuniaConnect) window.haimuniaConnect.close(); document.querySelectorAll(".modal-overlay.open").forEach((o) => o.classList.remove("open")); });
    await page.click("#tabHistoryBtn");
    await page.waitForSelector("#measureFold");
    const p = await page.evaluate(() => ({ streakCards: document.querySelectorAll("#weeklyStreak").length, folded: !document.getElementById("measureFold").open }));
    check(`[${tag}] progress: one streak card, מדדי גוף folded`, p.streakCards === 1 && p.folded, JSON.stringify(p));
    let f = await measure(page, "#content");
    check(`[${tag}] progress fits, controls >= 44px, nothing cut`, ok(f), JSON.stringify(f));
    await page.click("#measureFold > summary");
    f = await measure(page, "#measureFold");
    check(`[${tag}] progress: מדדי גוף open fits, controls >= 44px, nothing cut`, ok(f) && (await page.evaluate(() => document.getElementById("measureFold").open)), JSON.stringify(f));
    check(`[${tag}] progress: no console errors`, errors.length === 0, errors.join(" | "));
    await context.close();
  }
}
await browser.close();
await target.close();
if (failed) { console.log("\nFAILED"); process.exit(1); }
console.log("\nAll club and progress checks passed.");

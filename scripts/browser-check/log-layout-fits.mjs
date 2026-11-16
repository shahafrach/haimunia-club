#!/usr/bin/env node
// Log screen layout A (3.13.0): the whole flow to log a set fits one screen, with no scroll.
//
// At 390x844 (iPhone) and 360x780 (Android), for a member with an earlier session of the exercise:
//   - after picking the exercise: the steppers (weight, reps, sets), the plate visualizer and the save
//     button are on screen and are what document.elementFromPoint() hits (nothing covers them), at scrollY 0;
//   - after a save: the same, plus "עוד סט זהה"; one tap on it logs the same set again;
//   - a PR still shows its card, and after it the club share question (connected mode, fake client);
//   - F-024: iPhone 13 in a Safari tab (390×664) with the iOS install banner showing: the same controls are on
//     screen and hit. Before picking the banner is one line; with an exercise picked it steps aside and a link
//     under the controls opens the full two steps.
//
// Usage:
//   node log-layout-fits.mjs                  # local working tree
//   TARGET_URL=<url> node log-layout-fits.mjs # a deployed site
import { chromium, devices } from "playwright";
import { resolveTarget } from "./lib/target.mjs";
import { consoleErrorCollector, dismissWelcomeModal } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

const target = await resolveTarget();
console.log(`Target: ${target.url}${target.local ? " (local static server)" : ""}`);
const browser = await chromium.launch();
const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();

// The club client, faked in the page the way test/club.test.mjs fakes it in jsdom. Nothing leaves the page.
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

async function openWithHistory(size, { connected = false, device = null } = {}) {
  const ctx = await browser.newContext(device ? { ...device } : { viewport: size, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = await consoleErrorCollector(page);
  await installMockCloud(page);
  if (connected) await page.addInitScript(fakeClubClient);
  await page.goto(target.url, { waitUntil: "networkidle" });
  await dismissWelcomeModal(page);
  await page.evaluate(async ({ d, connected }) => {
    for (let i = 1; i <= 3; i++) {
      await window.dbPut({ id: "seed-" + i, exerciseId: "back-squat", date: d, type: "reps", weight: 100, reps: 5, sets: 1, durationSeconds: 0, ts: Date.now() - 86400000 + i, isPR: false, groupId: null, blockLabel: null, est1RM: 116.7 });
    }
    if (connected) await window.dbSetSetting("haimunia:connectChoice", "connected");
  }, { d: yesterday, connected });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#app", { state: "visible" });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}

async function pickBackSquat(page) {
  await page.click("[data-action='open-picker']");
  await page.waitForSelector("#pickerOverlay.open");
  await page.click("[data-action='pick-movement'][data-id='back-squat']");
  await page.waitForFunction(() => !document.getElementById("pickerOverlay").classList.contains("open"));
  await page.waitForTimeout(300);
}

// Each target must be fully inside the viewport and be what a tap at its centre hits, with no scroll.
async function reachable(page, selectors) {
  return page.evaluate((sels) => {
    const out = { scrollY: Math.round(scrollY), missing: [], covered: [], offscreen: [] };
    for (const [name, sel] of Object.entries(sels)) {
      const el = document.querySelector(sel);
      if (!el) { out.missing.push(name); continue; }
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight || r.height === 0) { out.offscreen.push(`${name} ${Math.round(r.top)}-${Math.round(r.bottom)}`); continue; }
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === el || el.contains(hit))) out.covered.push(`${name} by ${hit ? (hit.id || hit.className || hit.tagName) : "nothing"}`);
    }
    return out;
  }, selectors);
}

const CONTROLS = {
  "weight +": ".log-controls [data-action='step'][data-field='weight'][data-dir='1']",
  "weight value": ".log-controls input[data-field='weight']",
  "reps +": ".log-controls [data-action='step'][data-field='reps'][data-dir='1']",
  "sets +": ".log-controls [data-action='step'][data-field='sets'][data-dir='1']",
  "sets −": ".log-controls [data-action='step'][data-field='sets'][data-dir='-1']",
  "plate visualizer": "#barbellVisual",
  "save": "#bottomBarBtn",
};
function report(label, r) {
  const ok = r.scrollY === 0 && !r.missing.length && !r.covered.length && !r.offscreen.length;
  check(label, ok, ok ? "" : JSON.stringify(r));
}

for (const [w, h, name] of [[390, 844, "390x844"], [360, 780, "360x780"]]) {
  const { ctx, page, errors } = await openWithHistory({ width: w, height: h });
  await pickBackSquat(page);
  const values = await page.$$eval(".log-controls input.stepper-val", (els) => els.map((e) => e.value));
  check(`${name}: picking prefills the last session (100×5×1)`, values.join(",") === "100,5,1", values.join(","));
  check(`${name}: the last session is on screen`, await page.$eval(".log-controls .log-last", (e) => /פעם קודמת/.test(e.textContent)).catch(() => false));
  report(`${name}: after picking, the steppers, plate visualizer and save are on screen and hit, no scroll`, await reachable(page, CONTROLS));

  await page.click("#bottomBarBtn");
  await page.waitForTimeout(600);
  const pop = await page.evaluate(() => document.querySelector(".modal-overlay.open")?.id || "");
  if (pop) { await page.click(`#${pop} [data-action='close-celebration'], #${pop} .save-btn`).catch(() => {}); await page.waitForTimeout(400); }
  report(`${name}: after a save, "עוד סט זהה", the steppers, plate visualizer and save are on screen and hit`, await reachable(page, { ...CONTROLS, "עוד סט זהה": "[data-action='repeat-last-set']" }));
  await page.click("[data-action='repeat-last-set']");
  await page.waitForTimeout(500);
  const today = await page.evaluate(async () => (await window.dbLoadAll()).filter((e) => !String(e.id).startsWith("seed-")).map((e) => `${e.weight}x${e.reps}x${e.sets}`));
  check(`${name}: one tap on "עוד סט זהה" logs the same set again`, today.join(",") === "100x5x1,100x5x1", today.join(","));
  check(`${name}: no horizontal scroll`, await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth));
  check(`${name}: no console errors`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// F-024: iPhone 13 in a Safari tab (390×664), first visit, so the two-step iOS install banner is showing.
// The banner must never sit over the log controls: they stay on screen and are what a tap hits.
{
  const { ctx, page, errors } = await openWithHistory(null, { device: devices["iPhone 13"] });
  const shown = await page.evaluate(() => getComputedStyle(document.getElementById("iosInstallBanner")).display !== "none");
  check("iPhone 13 Safari tab: the iOS install banner is showing", shown);
  report("iPhone 13 Safari tab, banner showing, before picking: the pick button is on screen and hit", await reachable(page, { "pick an exercise": ".pick-hero" }));
  const line = await page.evaluate(() => { const b = document.getElementById("iosInstallBanner"); return { compact: b.classList.contains("install-dock--compact"), how: !!b.querySelector(".install-dock-line [data-action='ios-install-expand']"), dismiss: !!b.querySelector(".install-dock-line [data-action='dismiss-ios-install-hint']") }; });
  check("iPhone 13: before picking, the banner is one line with 'איך מתקינים?' and its close button", line.compact && line.how && line.dismiss, JSON.stringify(line));
  await pickBackSquat(page);
  const vp = await page.evaluate(() => `${innerWidth}x${innerHeight}`);
  report(`iPhone 13 Safari tab (${vp}), banner showing: the steppers, plate visualizer and save are on screen and hit, no scroll`, await reachable(page, CONTROLS));
  const tucked = await page.evaluate(() => ({
    dockHidden: getComputedStyle(document.getElementById("iosInstallBanner")).display === "none",
    link: !!document.querySelector("#content #iosInstallInline [data-action='ios-install-expand']"),
  }));
  check("iPhone 13: with an exercise picked the dock steps aside and a link under the controls offers it", tucked.dockHidden && tucked.link, JSON.stringify(tucked));
  // Tapping the link shows the full two steps, both buttons included.
  await page.locator("#iosInstallInline [data-action='ios-install-expand']").click();
  const full = await page.evaluate(() => {
    const b = document.getElementById("iosInstallBanner");
    const vis = (sel) => { const e = b.querySelector(sel); return !!e && e.getClientRects().length > 0; };
    return { steps: vis("#iosInstallSteps"), transfer: vis("[data-action='open-transfer-create']"), backup: vis("[data-action='ios-install-backup']") };
  });
  check("iPhone 13: 'איך מתקינים?' opens the full two steps with both buttons", full.steps && full.transfer && full.backup, JSON.stringify(full));
  // On another tab the full card shows as before (F-001's first-visit message is not lost).
  await page.click("#tabHistoryBtn");
  await page.waitForTimeout(200);
  check("iPhone 13: on the progress tab the full card shows", await page.evaluate(() => !document.getElementById("iosInstallBanner").classList.contains("install-dock--compact")));
  check("iPhone 13: no horizontal scroll", await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth));
  check("iPhone 13: no console errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// A PR still shows its card, then the club share question.
{
  const { ctx, page, errors } = await openWithHistory({ width: 390, height: 844 }, { connected: true });
  await page.waitForFunction(() => window.haimuniaClub && window.haimuniaClub.available(), null, { timeout: 8000 }).catch(() => {});
  check("connected: the fake club is available", await page.evaluate(() => !!(window.haimuniaClub && window.haimuniaClub.available())));
  await pickBackSquat(page);
  for (let i = 0; i < 4; i++) await page.click(".log-controls [data-action='step'][data-field='weight'][data-dir='1']"); // 110 kg: a PR
  await page.click("#bottomBarBtn");
  const card = await page.waitForSelector("#celebrationOverlay.open", { timeout: 4000 }).then(() => true).catch(() => false);
  check("PR: the celebration card shows", card);
  if (card) {
    await page.click("#celebrationOverlay [data-action='close-celebration']").catch(async () => { await page.keyboard.press("Escape"); });
  }
  const asked = await page.waitForSelector("#appConfirmOverlay[data-confirm-kind='club-share-entry']", { timeout: 4000 }).then(() => true).catch(() => false);
  check("PR: then the club share question", asked);
  if (asked) {
    await page.click("[data-action='app-confirm-yes']");
    await page.waitForFunction(() => window.__clubCalls.includes("pr_share") || window.__clubCalls.includes("upsert:workout_posts"), null, { timeout: 4000 }).catch(() => {});
    check("PR: sharing sends the day post and the PR card", await page.evaluate(() => window.__clubCalls.includes("upsert:workout_posts") && window.__clubCalls.includes("pr_share")), await page.evaluate(() => window.__clubCalls.join(",")));
  }
  check("connected: no console errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

await browser.close();
await target.close();
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
// Q-37: the short join code, on a 375px iPhone viewport, at normal and at 200% text.
//
//   A. A short link (#j=CODE) opened in Safari: the code in large type, the copy button, the three install
//      steps with pictures and "open from the icon and type this code".
//   B. The installed app's first screen: one large code field, and a large error for a wrong-looking code.
//   C. The installed app's join screen (signed in, not in the club yet).
//   D. The coach's link card: the QR, the code in large type, the short link, and the printed sheet.
//
// 200% is CSS zoom 2 on <html>: every px in the app's inline styles doubles and the layout width halves to
// 187.5 CSS px, which is what Safari's 200% page zoom does. Each screen must fit with no sideways scroll, the
// code must not be cut, and every button must be at least 44px tall.
//
// Local only. The Supabase client is a fake set before the app loads (connect.js never loads the real
// library when window.supabase exists), and lib/mockCloud.mjs aborts anything that leaves the origin.
import { chromium } from "playwright";
import { resolveLocalOnlyTarget } from "./lib/target.mjs";
import { consoleErrorCollector } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const target = await resolveLocalOnlyTarget();
console.log(`Target: ${target.url} (local static server)`);
const browser = await chromium.launch();

// The fake backend: a signed-in coach in the club (staff: true), or a signed-in member in no club.
function fakeSupabase({ inClub, role }) {
  const member = inClub ? [{ club_id: "c1", role, share_defaults: {}, clubs: { name: "האימוניה" } }] : [];
  window.supabase = {
    createClient: () => {
      const result = (table) => {
        if (table === "circle_members") return { data: member, error: null };
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
          if (n === "rotate_club_invite") return { data: { token: "cd".repeat(32), code: "ABCD2345" }, error: null };
          if (n === "circle_feed") return { data: [], error: null };
          return { data: null, error: null };
        },
        from: query,
        functions: { invoke: async () => ({ data: null, error: { message: "not in this check" } }) },
      };
    },
  };
}

async function newPage(scale, { standalone = false, fake = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, locale: "he-IL" });
  const page = await context.newPage();
  const errors = await consoleErrorCollector(page);
  await installMockCloud(page);
  if (standalone) {
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/display-mode: standalone/.test(q) ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : real(q));
    });
  }
  if (fake) await page.addInitScript(fakeSupabase, fake);
  if (scale !== 1) await page.addInitScript((z) => { document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.zoom = String(z); }); }, scale);
  return { context, page, errors };
}

// No sideways scroll in the page or in the dialog, and the given element's content is not cut.
async function fits(page, sel) {
  return page.evaluate((s) => {
    const de = document.documentElement;
    const el = document.querySelector(s);
    const sheet = el && el.closest(".modal-sheet, .modal-content, .card, #content");
    return {
      page: de.scrollWidth <= de.clientWidth + 1,
      el: !!el && el.scrollWidth <= el.clientWidth + 1,
      sheet: !sheet || sheet.scrollWidth <= sheet.clientWidth + 1,
      w: el ? Math.round(el.getBoundingClientRect().width) : 0,
      font: el ? parseFloat(getComputedStyle(el).fontSize) : 0,
    };
  }, sel);
}
async function minButtonHeight(page, scope) {
  return page.evaluate((s) => Math.min(...[...document.querySelectorAll(s + " button, " + s + " input")].filter((b) => b.offsetParent && b.type !== "checkbox").map((b) => b.getBoundingClientRect().height)), scope);
}

for (const scale of [1, 2]) {
  const tag = scale === 1 ? "100%" : "200%";

  // ---- A. A short link in Safari ----------------------------------------------------------------------
  {
    const { context, page, errors } = await newPage(scale);
    await page.goto(target.url + "#j=abcd2345", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#connectJoinCode", { timeout: 15000 });
    await page.waitForTimeout(300);
    const top = await page.evaluate(() => {
      const c = document.getElementById("connectJoinCode").getBoundingClientRect();
      const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
      return { onTop: !!hit && !!hit.closest("#connectOverlay"), welcome: document.getElementById("welcomeOverlay").classList.contains("open") };
    });
    check(`[${tag}] A. the code screen is on top; the welcome sheet stays closed`, top.onTop && !top.welcome, JSON.stringify(top));
    const f = await fits(page, "#connectJoinCode");
    check(`[${tag}] A. Safari: no sideways scroll, the code is not cut`, f.page && f.el && f.sheet, JSON.stringify(f));
    check(`[${tag}] A. the code is the largest text (>= 40px CSS)`, f.font >= 40, `${f.font}px`);
    const shown = await page.evaluate(() => ({
      code: document.getElementById("connectJoinCode").textContent,
      steps: document.querySelectorAll("#connectInstallSteps li").length,
      pics: document.querySelectorAll("#connectInstallSteps .join-step-pic svg, #connectInstallSteps .join-step-pic img").length,
      after: document.getElementById("connectInstallAfter").textContent,
      hash: location.hash,
    }));
    check(`[${tag}] A. code, 3 steps with 3 pictures, "type this code", hash cleared`,
      shown.code === "ABCD 2345" && shown.steps === 3 && shown.pics === 3 && /מקלידים את הקוד/.test(shown.after) && shown.hash === "", JSON.stringify(shown));
    const img = await page.evaluate(() => { const i = document.querySelector("#connectInstallSteps img"); return i && i.complete && i.naturalWidth > 0; });
    check(`[${tag}] A. the app icon picture loads`, !!img);
    const h = await minButtonHeight(page, "#connectBody");
    check(`[${tag}] A. every button is at least 44px tall`, h >= 44, `${h}px`);
    const startsInside = await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest("#connectOverlay"));
    check(`[${tag}] A. the dialog opens with focus inside it`, startsInside);
    await page.keyboard.press("Tab");
    const focusable = await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest("#connectOverlay"));
    check(`[${tag}] A. keyboard focus stays in the dialog`, focusable);
    check(`[${tag}] A. no console errors`, errors.length === 0, errors.join(" | "));
    check(`[${tag}] A. nothing left the origin`, page.__foreignRequests.length === 0, page.__foreignRequests.join(" "));
    await page.screenshot({ path: `/tmp/claude-0/-home-user/2bd321ec-b56f-56fc-bbf9-9cf5d21706bb/scratchpad/join-A-${scale}.png`, fullPage: false }).catch(() => {});
    await context.close();
  }

  // ---- B. Installed app, first screen: the code field ---------------------------------------------------
  {
    const { context, page, errors } = await newPage(scale, { standalone: true });
    await page.goto(target.url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#app", { state: "visible", timeout: 15000 });
    await page.evaluate(() => { document.querySelectorAll(".modal-overlay.open").forEach((o) => o.classList.remove("open")); window.haimuniaConnect.open("choice", true); });
    await page.waitForSelector("#connect-link.join-field");
    const f = await fits(page, "#connect-link");
    const hgt = await page.evaluate(() => document.getElementById("connect-link").getBoundingClientRect().height);
    check(`[${tag}] B. installed first screen: no sideways scroll`, f.page && f.sheet, JSON.stringify(f));
    check(`[${tag}] B. one large field (>= 56px tall, >= 28px text)`, hgt >= 56 && f.font >= 28, `${Math.round(hgt)}px, ${f.font}px`);
    await page.fill("#connect-link", "ABC");
    await page.click("#connectBody button[type=submit]");
    await page.waitForSelector("#connect-link-err");
    const e = await fits(page, "#connect-link-err");
    check(`[${tag}] B. the error is large (>= 16px) and fits`, e.font >= 16 && e.page && e.el, JSON.stringify(e));
    await page.fill("#connect-link", "abcd - 2345");
    await page.click("#connectBody button[type=submit]");
    await page.waitForSelector("#connectBody [name='username']");
    check(`[${tag}] B. a code typed in lower case with spaces and a dash goes on to the account`, true);
    check(`[${tag}] B. no console errors`, errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // ---- C. Installed app, signed in, not in the club: the join screen ------------------------------------
  {
    const { context, page, errors } = await newPage(scale, { standalone: true, fake: { inClub: false, role: "member" } });
    await page.goto(target.url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#app", { state: "visible", timeout: 15000 });
    await page.evaluate(async () => {
      await window.dbSetSetting("haimunia:userName", "בדיקה");
      await window.dbSetSetting("haimunia:connectChoice", "connected");
      try { localStorage.setItem("haimunia:firstImportAnswered", "1"); } catch (e) {}
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#app", { state: "visible", timeout: 15000 });
    await page.evaluate(() => { document.querySelectorAll(".modal-overlay.open").forEach((o) => o.classList.remove("open")); window.haimuniaConnect.open("join"); });
    await page.waitForSelector("#connect-link.join-field");
    const f = await fits(page, "#connect-link");
    check(`[${tag}] C. join screen: no sideways scroll, large field`, f.page && f.sheet && f.font >= 28, JSON.stringify(f));
    const h = await minButtonHeight(page, "#connectBody");
    check(`[${tag}] C. every control is at least 44px tall`, h >= 44, `${h}px`);
    check(`[${tag}] C. no console errors`, errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // ---- D. The coach's link card -------------------------------------------------------------------------
  {
    const { context, page, errors } = await newPage(scale, { standalone: true, fake: { inClub: true, role: "coach" } });
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
    await page.click("[data-club='rotate']");
    await page.click("[data-action='app-confirm-yes']");
    await page.waitForSelector("#clubInvite svg.join-qr", { timeout: 10000 });
    await page.locator("#clubInvite").scrollIntoViewIfNeeded();
    const f = await fits(page, "#clubInviteCode");
    check(`[${tag}] D. coach card: no sideways scroll, the code is not cut, large`, f.page && f.el && f.sheet && f.font >= 40, JSON.stringify(f));
    const qr = await page.evaluate(() => {
      const r = document.querySelector("#clubInvite svg.join-qr").getBoundingClientRect();
      const fg = getComputedStyle(document.querySelector("#clubInvite .join-qr-fg")).fill;
      const bg = getComputedStyle(document.querySelector("#clubInvite .join-qr-bg")).fill;
      return { w: Math.round(r.width), h: Math.round(r.height), left: r.left, right: r.right, vw: document.documentElement.clientWidth, fg, bg };
    });
    check(`[${tag}] D. the QR is square, at least 150px, inside the screen`, qr.w >= 150 && Math.abs(qr.w - qr.h) <= 1 && qr.left >= 0 && qr.right <= qr.vw + 1, JSON.stringify(qr));
    check(`[${tag}] D. the QR is black on white`, qr.fg === "rgb(0, 0, 0)" && qr.bg === "rgb(255, 255, 255)", `${qr.fg} on ${qr.bg}`);
    const link = await page.textContent("#clubInviteLink");
    check(`[${tag}] D. the short link`, /#j=ABCD2345$/.test(link), link);
    const h = await minButtonHeight(page, "#clubInvite");
    check(`[${tag}] D. every button is at least 44px tall`, h >= 44, `${h}px`);
    if (scale === 1) {
      await page.screenshot({ path: "/tmp/claude-0/-home-user/2bd321ec-b56f-56fc-bbf9-9cf5d21706bb/scratchpad/join-D-1.png" }).catch(() => {});
      await page.emulateMedia({ media: "print" });
      const pr = await page.evaluate(() => {
        const c = document.querySelector("[data-invite-print]");
        const q = c && c.querySelector("svg.join-qr");
        const code = c && c.querySelector(".invite-print-code");
        return { vis: c ? getComputedStyle(c).visibility : "", qr: q ? Math.round(q.getBoundingClientRect().width) : 0,
          code: code ? code.textContent : "", codeFont: code ? parseFloat(getComputedStyle(code).fontSize) : 0 };
      });
      check("[print] D. the sheet shows the QR (about 78mm) and the code in large type", pr.vis === "visible" && pr.qr >= 250 && pr.code === "ABCD 2345" && pr.codeFont >= 40, JSON.stringify(pr));
      await page.emulateMedia({ media: "screen" });
    }
    check(`[${tag}] D. no console errors`, errors.length === 0, errors.join(" | "));
    check(`[${tag}] D. nothing left the origin`, page.__foreignRequests.length === 0, page.__foreignRequests.join(" "));
    await context.close();
  }
}

await browser.close();
await target.close();
if (failed) { console.log("\nFAILED"); process.exit(1); }
console.log("\nAll join-code checks passed.");

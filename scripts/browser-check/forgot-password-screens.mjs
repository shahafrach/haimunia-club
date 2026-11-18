#!/usr/bin/env node
// Q-38 / Q-38b: forgot password, on a 375px iPhone viewport, at normal and at 200% text (CSS zoom 2, as in
// join-code-screens.mjs).
//
//   A. The login screen's large "שכחתי סיסמה" link.
//   B. The forgot screen: one large code field and the new password twice; a malformed code's large error.
//   C. The self-service request's reference screen (the owner's way back).
//   D. The coach's reset card under a member in the roster.
//
// Each must fit with no sideways scroll, every control at least 44px tall, nothing cut. Local only: the
// Supabase client is a fake set before the app loads, and lib/mockCloud.mjs aborts anything that leaves
// the origin.
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

function fakeSupabase({ signedIn, role }) {
  const members = [
    { user_id: "u-owner", role: "owner", joined_at: "2026-11-01", profiles: { display_name: "בעלים", emoji: "👑" } },
    { user_id: "u-me", role, joined_at: "2026-11-02", profiles: { display_name: "בדיקה", emoji: "💪" } },
    { user_id: "u-other", role: "member", joined_at: "2026-11-03", profiles: { display_name: "חבר מועדון עם שם ארוך מאוד", emoji: "🔥" } },
  ];
  window.supabase = {
    createClient: () => {
      const query = (table) => {
        const q = { _members: false };
        for (const m of ["select", "eq", "order", "limit", "lt", "in", "is", "neq", "gte", "lte", "range", "update", "upsert", "insert", "delete"]) {
          q[m] = (...a) => { if (m === "select" && String(a[0] || "").includes("joined_at")) q._members = true; return q; };
        }
        q.maybeSingle = async () => ({ data: { display_name: "בדיקה", emoji: "💪" }, error: null });
        q.then = (ok, no) => Promise.resolve(table === "circle_members"
          ? { data: q._members ? members : [{ club_id: "c1", role, share_defaults: {}, clubs: { name: "האימוניה" } }], error: null }
          : { data: [], error: null }).then(ok, no);
        return q;
      };
      return {
        auth: {
          getSession: async () => ({ data: { session: signedIn ? { user: { id: "u-me", is_anonymous: false, email: "dana_k@members.haimuniya.invalid" } } : null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signOut: async () => ({}),
        },
        rpc: async (n) => {
          if (n === "club_issue_reset_code") return { data: "ABCD2345", error: null };
          if (n === "circle_feed") return { data: [], error: null };
          return { data: null, error: null };
        },
        from: query,
        functions: {
          invoke: async (n, o) => {
            const b = (o && o.body) || {};
            if (n === "request-reset" && b.action === "request") return { data: { ok: true, request_token: "ef".repeat(32), request_ref: "A1B2C3", ready_at: new Date(Date.now() + 3600e3).toISOString() }, error: null };
            return { data: null, error: { name: "FunctionsHttpError", message: "non-2xx" } };
          },
        },
      };
    },
  };
}

async function newPage(scale, fake) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, locale: "he-IL" });
  const page = await context.newPage();
  const errors = await consoleErrorCollector(page);
  await installMockCloud(page);
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/display-mode: standalone/.test(q) ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : real(q));
  });
  await page.addInitScript(fakeSupabase, fake);
  if (scale !== 1) await page.addInitScript((z) => { document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.zoom = String(z); }); }, scale);
  await page.goto(target.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#app", { state: "visible", timeout: 15000 });
  await page.evaluate(async () => {
    await window.dbSetSetting("haimunia:userName", "בדיקה");
    await window.dbSetSetting("haimunia:connectChoice", "connected");
    try { localStorage.setItem("haimunia:firstImportAnswered", "1"); } catch (e) {}
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#app", { state: "visible", timeout: 15000 });
  await page.evaluate(() => document.querySelectorAll(".modal-overlay.open").forEach((o) => o.classList.remove("open")));
  return { context, page, errors };
}
async function fits(page, sel) {
  return page.evaluate((s) => {
    const de = document.documentElement, el = document.querySelector(s);
    const box = el && el.closest(".modal-sheet, .modal-content, .card, #content");
    return { page: de.scrollWidth <= de.clientWidth + 1, el: !!el && el.scrollWidth <= el.clientWidth + 1,
      box: !box || box.scrollWidth <= box.clientWidth + 1, font: el ? parseFloat(getComputedStyle(el).fontSize) : 0 };
  }, sel);
}
async function minHeight(page, scope) {
  return page.evaluate((s) => Math.min(...[...document.querySelectorAll(s + " button, " + s + " input")]
    .filter((b) => b.offsetParent && b.type !== "checkbox").map((b) => b.getBoundingClientRect().height)), scope);
}

for (const scale of [1, 2]) {
  const tag = scale === 1 ? "100%" : "200%";

  // ---- A + B: signed out on this phone -> login -> forgot ----------------------------------------------
  {
    const { context, page, errors } = await newPage(scale, { signedIn: false, role: "member" });
    await page.evaluate(() => window.haimuniaConnect.open());
    await page.waitForSelector("#connectSignedOut");
    check(`[${tag}] the signed-out notice offers sign-in and forgot`, await page.isVisible("[data-connect='go-forgot']"));
    await page.click("#connectBody [data-connect='go-login']");
    await page.waitForSelector("button.join-forgot");
    const link = await page.evaluate(() => { const b = document.querySelector("button.join-forgot"); const r = b.getBoundingClientRect(); return { h: r.height, font: parseFloat(getComputedStyle(b).fontSize) }; });
    check(`[${tag}] A. login: "שכחתי סיסמה" is large (>= 17px, >= 44px tall)`, link.font >= 17 && link.h >= 44, JSON.stringify(link));
    await page.click("button.join-forgot");
    await page.waitForSelector("#connect-resetCode.join-field");
    const f = await fits(page, "#connect-resetCode");
    check(`[${tag}] B. forgot: no sideways scroll, one large code field`, f.page && f.box && f.font >= 28, JSON.stringify(f));
    const names = await page.evaluate(() => [...document.querySelectorAll("#connectBody form input")].map((i) => i.name + ":" + i.autocomplete));
    check(`[${tag}] B. the code and the new password twice (autocomplete new-password)`, names.join() === "resetCode:off,password:new-password,passwordConfirm:new-password", names.join());
    check(`[${tag}] B. every control at least 44px`, (await minHeight(page, "#connectBody")) >= 44);
    await page.fill("#connect-resetCode", "ABC");
    await page.click("#connectBody button[type=submit]");
    await page.waitForSelector("#connect-resetCode-err");
    const e = await fits(page, "#connect-resetCode-err");
    check(`[${tag}] B. a malformed code: a large error that fits`, e.font >= 16 && e.el && e.page, JSON.stringify(e));

    // ---- C: no coach -> request -> reference ---------------------------------------------------------
    await page.click("[data-connect='go-self']");
    await page.waitForSelector("#connect-username");
    await page.fill("#connect-username", "shahaf_x");
    await page.click("#connectBody button[type=submit]");
    await page.waitForSelector("#connectResetRef");
    const r = await fits(page, "#connectResetRef");
    check(`[${tag}] C. the request reference: large, fits`, r.page && r.el && r.font >= 40 && (await page.textContent("#connectResetRef")) === "A1B2C3", JSON.stringify(r));
    check(`[${tag}] C. every control at least 44px`, (await minHeight(page, "#connectBody")) >= 44);
    check(`[${tag}] A-C. no console errors`, errors.length === 0, errors.join(" | "));
    check(`[${tag}] A-C. nothing left the origin`, page.__foreignRequests.length === 0, page.__foreignRequests.join(" "));
    if (scale === 1) await page.screenshot({ path: "/tmp/claude-0/-home-user/2bd321ec-b56f-56fc-bbf9-9cf5d21706bb/scratchpad/forgot-C-1.png" }).catch(() => {});
    await context.close();
  }

  // ---- D: the coach's reset card ------------------------------------------------------------------------
  {
    const { context, page, errors } = await newPage(scale, { signedIn: true, role: "coach" });
    await page.waitForSelector("[data-action='switch-tab'][data-tab='club']:visible", { timeout: 15000 });
    await page.click("[data-action='switch-tab'][data-tab='club']:visible");
    await page.click("[data-club='members']");
    await page.waitForSelector("[data-club='reset-pw']");
    const ids = await page.evaluate(() => [...document.querySelectorAll("[data-club='reset-pw']")].map((b) => b.dataset.id));
    check(`[${tag}] D. reset only for the plain member (never the owner, never oneself)`, ids.join() === "u-other", ids.join());
    await page.click("[data-club='reset-pw']");
    await page.waitForSelector("#clubResetCode");
    await page.locator("#clubResetCard").scrollIntoViewIfNeeded();
    const f = await fits(page, "#clubResetCode");
    check(`[${tag}] D. the reset code: large, not cut, no sideways scroll`, f.page && f.el && f.box && f.font >= 40, JSON.stringify(f));
    check(`[${tag}] D. every button at least 44px`, (await minHeight(page, "#clubResetCard")) >= 44);
    check(`[${tag}] D. no console errors`, errors.length === 0, errors.join(" | "));
    if (scale === 1) await page.screenshot({ path: "/tmp/claude-0/-home-user/2bd321ec-b56f-56fc-bbf9-9cf5d21706bb/scratchpad/forgot-D-1.png" }).catch(() => {});
    await context.close();
  }
}

await browser.close();
await target.close();
if (failed) { console.log("\nFAILED"); process.exit(1); }
console.log("\nAll forgot-password checks passed.");

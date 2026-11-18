#!/usr/bin/env node
// Q-42: the guided first run on a 375px phone, at normal and at 200% text (CSS zoom 2, as in
// join-code-screens.mjs): the import sheet, the code-first screen with its "אפשרויות נוספות" fold, the install
// screen for iOS 26 Safari, WhatsApp's in-app browser and Samsung Internet, and the restore offer. Each must
// fit with no sideways scroll, every control at least 44px tall, nothing cut. Local only; nothing leaves the
// origin (lib/mockCloud.mjs).
import { chromium } from "playwright";
import { resolveLocalOnlyTarget } from "./lib/target.mjs";
import { consoleErrorCollector } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}
const UA = {
  ios26: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1",
  whatsapp: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/2.24.1",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36",
};
const SHOTS = "/tmp/claude-0/-home-user/2bd321ec-b56f-56fc-bbf9-9cf5d21706bb/scratchpad";
const target = await resolveLocalOnlyTarget();
console.log(`Target: ${target.url} (local static server)`);
const browser = await chromium.launch();

async function newPage(scale, ua, { standalone = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, userAgent: ua, locale: "he-IL" });
  const page = await context.newPage();
  const errors = await consoleErrorCollector(page);
  await installMockCloud(page);
  if (standalone) {
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/display-mode: standalone/.test(q) ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : real(q));
    });
  }
  if (scale !== 1) await page.addInitScript((z) => { document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.zoom = String(z); }); }, scale);
  return { context, page, errors };
}
async function screen(page, tag, name, scope) {
  const f = await page.evaluate((s) => {
    const de = document.documentElement, body = document.querySelector(s);
    const cut = [...body.querySelectorAll("button, input, label, summary, .join-lead, .join-err, .join-step")].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map((e) => (e.textContent || e.name || "").trim().slice(0, 24));
    const small = [...body.querySelectorAll("button, input, summary")].filter((b) => b.offsetParent && b.type !== "checkbox" && b.getBoundingClientRect().height < 44).map((b) => (b.textContent || b.name || "").trim().slice(0, 24));
    return { page: de.scrollWidth <= de.clientWidth + 1, body: body.scrollWidth <= body.clientWidth + 1, cut, small };
  }, scope);
  check(`[${tag}] ${name}: no sideways scroll, nothing cut, controls >= 44px`, f.page && f.body && !f.cut.length && !f.small.length, JSON.stringify(f));
}

for (const scale of [1, 2]) {
  const tag = scale === 1 ? "100%" : "200%";
  {
    // A + B: installed app, fresh: the import sheet, then (after "אני חדש/ה כאן" and the name) the code screen.
    const { context, page, errors } = await newPage(scale, UA.ios26, { standalone: true });
    await page.goto(target.url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.getElementById("firstImportOverlay")?.classList.contains("open"), null, { timeout: 15000 });
    await screen(page, tag, "A. import sheet", "#firstImportOverlay .modal-list");
    if (scale === 1) await page.screenshot({ path: `${SHOTS}/q42-A-import.png` }).catch(() => {});
    await page.click("[data-action='first-import-fresh']");
    await page.waitForFunction(() => document.getElementById("welcomeOverlay")?.classList.contains("open"));
    await page.fill("#welcomeNameInput", "בדיקה");
    await page.click("[data-action='save-user-name']");
    await page.waitForSelector("#connectMoreOptions");
    const primaries = await page.evaluate(() => document.querySelectorAll("#connectBody button.save-btn, #connectBody button[type=submit]").length);
    check(`[${tag}] B. code screen: one primary button`, primaries === 1, String(primaries));
    await screen(page, tag, "B. code screen, folded", "#connectBody");
    await page.click("#connectMoreOptions > summary");
    await screen(page, tag, "B. code screen, options open", "#connectBody");
    if (scale === 1) await page.screenshot({ path: `${SHOTS}/q42-B-code.png` }).catch(() => {});
    // D: the restore offer.
    await page.evaluate(() => window.haimuniaConnect.open("restore-offer"));
    await page.waitForSelector("[data-connect='restore-transfer']");
    await screen(page, tag, "D. restore offer", "#connectBody");
    check(`[${tag}] A-D. no console errors`, errors.length === 0, errors.join(" | "));
    await context.close();
  }
  for (const [kind, ua] of Object.entries(UA)) {
    const { context, page, errors } = await newPage(scale, ua);
    await page.goto(target.url + "#j=ABCD2345", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#connectJoinCode", { timeout: 15000 });
    const t = await page.textContent("#connectBody");
    const want = { ios26: /⋯/, whatsapp: /WhatsApp או Instagram/, samsung: /הוספת דף ל/ }[kind];
    check(`[${tag}] C. install (${kind}): its own steps`, want.test(t));
    await screen(page, tag, `C. install (${kind})`, "#connectBody");
    if (scale === 1) await page.screenshot({ path: `${SHOTS}/q42-C-${kind}.png` }).catch(() => {});
    check(`[${tag}] C. install (${kind}): no console errors, nothing left the origin`, errors.length === 0 && page.__foreignRequests.length === 0, errors.concat(page.__foreignRequests).join(" | "));
    await context.close();
  }
}

await browser.close();
await target.close();
if (failed) { console.log("\nFAILED"); process.exit(1); }
console.log("\nAll guided first-run checks passed.");

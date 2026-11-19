#!/usr/bin/env node
// Q-52: two screens on a 375px iPhone, at normal and at 200% text (CSS zoom 2). (1) Safari, not installed: the
// install banner opened, its step 2 the shared install-help steps for iOS 26. (2) The installed app's first
// screen: the note that the club sign-in did not carry over from Safari, with its button. No sideways scroll,
// nothing cut, controls >= 44px. Local only.
import { chromium } from "playwright";
import { resolveLocalOnlyTarget } from "./lib/target.mjs";
import { consoleErrorCollector } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`); if (!ok) failed = true; }
const SHOTS = "/tmp/claude-0/-home-user/2bd321ec-b56f-56fc-bbf9-9cf5d21706bb/scratchpad";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1";
const target = await resolveLocalOnlyTarget();
console.log(`Target: ${target.url} (local static server)`);
const browser = await chromium.launch();
async function newPage(scale, standalone) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, userAgent: UA, locale: "he-IL" });
  const page = await context.newPage();
  const errors = await consoleErrorCollector(page);
  await installMockCloud(page);
  if (standalone) await page.addInitScript(() => { const real = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode: standalone/.test(q) ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : real(q)); });
  if (scale !== 1) await page.addInitScript((z) => { document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.zoom = String(z); }); }, scale);
  return { context, page, errors };
}
const fit = (page, scope) => page.evaluate((s) => {
  const de = document.documentElement, r = document.querySelector(s);
  const vis = (e) => e.offsetParent && e.getClientRects().length;
  const c = [...r.querySelectorAll("button, summary")].filter(vis);
  return { page: de.scrollWidth <= de.clientWidth + 1, small: c.filter((b) => b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim().slice(0, 20)),
    cut: [...r.querySelectorAll("button, .join-step, .join-lead")].filter((e) => vis(e) && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 20)) };
}, scope);

for (const scale of [1, 2]) {
  const tag = scale === 1 ? "100%" : "200%";
  {
    const { context, page, errors } = await newPage(scale, false);
    await page.goto(target.url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#iosInstallBanner", { state: "visible", timeout: 15000 });
    await page.evaluate(() => { document.querySelectorAll(".modal-overlay.open").forEach((o) => o.classList.remove("open")); const b = document.getElementById("iosInstallBanner"); b.classList.remove("install-dock--compact"); });
    const has = await page.evaluate(() => { const h = document.getElementById("iosInstallHow"); return { steps: !!h.querySelector("ol.join-steps"), dots: /⋯/.test(h.textContent), dupIds: document.querySelectorAll("#connectInstallSteps").length }; });
    check(`[${tag}] Safari banner: step 2 is the shared iOS 26 steps, no duplicate ids`, has.steps && has.dots && has.dupIds <= 1, JSON.stringify(has));
    const f = await fit(page, "#iosInstallBanner");
    check(`[${tag}] Safari banner: fits, controls >= 44px, nothing cut`, f.page && !f.small.length && !f.cut.length, JSON.stringify(f));
    await page.screenshot({ path: `${SHOTS}/q52-banner-${scale}.png` }).catch(() => {});
    check(`[${tag}] banner: no console errors`, errors.length === 0, errors.join(" | "));
    await context.close();
  }
  {
    const { context, page, errors } = await newPage(scale, true);
    await page.goto(target.url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.getElementById("firstImportOverlay")?.classList.contains("open"), null, { timeout: 15000 });
    const note = await page.evaluate(() => { const b = document.getElementById("firstImportSignIn"); return { shown: !b.hidden, text: b.textContent.trim() }; });
    check(`[${tag}] installed app: the sign-in note is shown`, note.shown && /צריך להיכנס שוב/.test(note.text), JSON.stringify(note));
    const f = await fit(page, "#firstImportOverlay .modal-list");
    check(`[${tag}] installed app: the sheet fits, controls >= 44px, nothing cut`, f.page && !f.small.length && !f.cut.length, JSON.stringify(f));
    await page.screenshot({ path: `${SHOTS}/q52-firstrun-${scale}.png` }).catch(() => {});
    check(`[${tag}] installed app: no console errors, nothing left the origin`, errors.length === 0 && page.__foreignRequests.length === 0, errors.concat(page.__foreignRequests).join(" | "));
    await context.close();
  }
}
await browser.close();
await target.close();
if (failed) { console.log("\nFAILED"); process.exit(1); }
console.log("\nAll install and sign-in note checks passed.");

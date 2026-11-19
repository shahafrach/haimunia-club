#!/usr/bin/env node
// Q-38c / Q-38d / Q-38e: signing in and getting back in, self-service only, on a 375px iPhone viewport, at
// normal and at 200% text (CSS zoom 2, as in join-code-screens.mjs).
//
//   A. A device that lost its session: the notice, Face ID first, then the password and "שכחתי סיסמה".
//   B. The login screen: Face ID first, and the large "שכחתי סיסמה".
//   C. The forgot screen: Face ID, the recovery-code form, and "פתיחת חשבון חדש" with its one sentence.
//   D. The Face ID offer after the recovery code (opened directly).
//
// Each must fit with no sideways scroll, every control at least 44px tall, nothing cut. Local only: the
// Supabase client is a fake set before the app loads, and lib/mockCloud.mjs aborts anything that leaves
// the origin. Chromium has PublicKeyCredential, so the Face ID buttons render as on a phone.
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

function fakeSupabase() {
  window.supabase = {
    createClient: () => {
      const q = {};
      for (const m of ["select", "eq", "order", "limit", "update"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: null, error: null });
      q.then = (ok, no) => Promise.resolve({ data: [], error: null }).then(ok, no);
      return {
        auth: {
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signInWithPasskey: async () => ({ data: null, error: { code: "webauthn_credential_not_found" } }),
          registerPasskey: async () => ({ data: null, error: { name: "NotAllowedError" } }),
        },
        rpc: async () => ({ data: null, error: null }),
        from: () => q,
        functions: { invoke: async () => ({ data: null, error: { name: "FunctionsHttpError", message: "non-2xx" } }) },
      };
    },
  };
}

async function newPage(scale) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, locale: "he-IL" });
  const page = await context.newPage();
  const errors = await consoleErrorCollector(page);
  await installMockCloud(page);
  await page.addInitScript(fakeSupabase);
  if (scale !== 1) await page.addInitScript((z) => { document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.zoom = String(z); }); }, scale);
  await page.goto(target.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#app", { state: "visible", timeout: 15000 });
  await page.evaluate(async () => {
    await window.dbSetSetting("haimunia:userName", "בדיקה");
    await window.dbSetSetting("haimunia:connectChoice", "connected");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#app", { state: "visible", timeout: 15000 });
  await page.evaluate(() => document.querySelectorAll(".modal-overlay.open").forEach((o) => o.classList.remove("open")));
  return { context, page, errors };
}
async function fitsDialog(page) {
  return page.evaluate(() => {
    const de = document.documentElement, body = document.getElementById("connectBody");
    const cut = [...body.querySelectorAll("button, input, label, .join-lead, .join-after")].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 20) || e.name);
    return { page: de.scrollWidth <= de.clientWidth + 1, body: body.scrollWidth <= body.clientWidth + 1, cut };
  });
}
async function minHeight(page) {
  return page.evaluate(() => Math.min(...[...document.querySelectorAll("#connectBody button, #connectBody input")]
    .filter((b) => b.offsetParent && b.type !== "checkbox").map((b) => b.getBoundingClientRect().height)));
}
async function screen(page, tag, name) {
  const f = await fitsDialog(page);
  check(`[${tag}] ${name}: no sideways scroll, nothing cut`, f.page && f.body && f.cut.length === 0, JSON.stringify(f));
  const h = await minHeight(page);
  check(`[${tag}] ${name}: every control at least 44px`, h >= 44, `${h}px`);
}

for (const scale of [1, 2]) {
  const tag = scale === 1 ? "100%" : "200%";
  const { context, page, errors } = await newPage(scale);

  // A
  await page.evaluate(() => window.haimuniaConnect.open());
  await page.waitForSelector("#connectSignedOut");
  const first = await page.evaluate(() => document.querySelector("#connectBody button").getAttribute("data-connect"));
  check(`[${tag}] A. signed out: Face ID is the first button`, first === "passkey-signin", first);
  await screen(page, tag, "A. signed-out notice");

  // B
  await page.click("#connectBody [data-connect='go-login']");
  await page.waitForSelector("button.join-forgot");
  check(`[${tag}] B. login: Face ID before the password form`, await page.evaluate(() => {
    const b = document.querySelector("#connectBody [data-connect='passkey-signin']"), f = document.querySelector("#connectBody form");
    return !!b && !!f && !!(b.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING);
  }));
  await screen(page, tag, "B. login");
  await page.click("#connectBody [data-connect='passkey-signin']");
  await page.waitForFunction(() => /אין Face ID שמור/.test(document.getElementById("connectBody").textContent));
  check(`[${tag}] B. Face ID with nothing saved: a plain answer`, true);

  // C
  await page.click("button.join-forgot");
  await page.waitForSelector("#connectNewAccountNote");
  const names = await page.evaluate(() => [...document.querySelectorAll("#connectBody form input")].map((i) => i.name).join());
  check(`[${tag}] C. forgot: Face ID, the recovery-code form, and the new-account way`,
    names === "username,recoveryCode,password,passwordConfirm" && await page.isVisible("[data-connect='new-account']") && await page.isVisible("#connectBody [data-connect='passkey-signin']"), names);
  await screen(page, tag, "C. forgot");
  const note = await page.evaluate(() => { const n = document.getElementById("connectNewAccountNote"); return parseFloat(getComputedStyle(n).fontSize); });
  check(`[${tag}] C. the new-account sentence is large (>= 16px)`, note >= 16, `${note}px`);
  if (scale === 1) await page.screenshot({ path: "/tmp/claude-0/-home-user/2bd321ec-b56f-56fc-bbf9-9cf5d21706bb/scratchpad/forgot-C-1.png", fullPage: true }).catch(() => {});

  // D
  await page.evaluate(() => { window.haimuniaConnect.close(); window.haimuniaConnect.open("passkey"); });
  await page.waitForSelector("[data-connect='passkey-register']");
  await screen(page, tag, "D. Face ID offer");

  check(`[${tag}] no console errors`, errors.length === 0, errors.join(" | "));
  check(`[${tag}] nothing left the origin`, page.__foreignRequests.length === 0, page.__foreignRequests.join(" "));
  await context.close();
}

await browser.close();
await target.close();
if (failed) { console.log("\nFAILED"); process.exit(1); }
console.log("\nAll sign-in and recovery checks passed.");

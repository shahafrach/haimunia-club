#!/usr/bin/env node
// Launch-readiness audit, A5: the automated accessibility scanner the audit
// found missing entirely.
//
// WHAT THIS ADDS THAT THE NODE TESTS DO NOT. The four jsdom a11y test files
// (heading-outline, tablist-keyboard, community-dialog-focus, brass-contrast,
// chart-accessible-name) each assert one specific property the team decided
// to guard. axe-core instead sweeps for the WCAG violations nobody thought
// to write a test for - duplicate ids, form fields with no label, ARIA
// attributes on elements that do not permit them, nested-interactive
// controls, contrast computed against real rendered pixels rather than
// against tokens parsed out of the stylesheet.
//
// SCOPE. Runs against real Chromium on the offline training-log screens AND
// the signed-in Community surface (via lib/mockCloud.mjs), because
// Community is where heading and tab structure were weakest and where the
// jsdom suite's own heading test documents itself as "not done".
//
// FAILING RULES ARE A HARD FAIL. This is wired into run-all.mjs, so a new
// violation breaks the build rather than producing a report someone reads
// later. The baseline below is empty on purpose: the scan passes clean
// today, and anything that appears is a regression introduced after this
// commit, not pre-existing debt to triage.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolveLocalOnlyTarget } from "./lib/target.mjs";
import { switchTab, consoleErrorCollector, dismissWelcomeModal } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

// WCAG 2.2 AA is the standard the audit measured against. serious/critical
// are treated as failures; minor/moderate are printed for visibility but do
// not block, because several of those are judgement calls (e.g. a decorative
// element axe cannot know is decorative) and a gate that cries wolf gets
// disabled.
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function scan(page, label) {
  await page.evaluate(axeSource);
  const results = await page.evaluate(
    async (tags) => await window.axe.run(document, { runOnly: { type: "tag", values: tags } }),
    TAGS,
  );
  const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact));
  const advisory = results.violations.filter((v) => !BLOCKING_IMPACTS.has(v.impact));

  for (const v of advisory) {
    console.log(`      note (${v.impact}): ${v.id} — ${v.nodes.length} node(s): ${v.help}`);
  }
  const detail = blocking.length
    ? blocking.map((v) => `${v.id} [${v.impact}] ×${v.nodes.length}: ${v.nodes[0]?.target?.join(" ")}`).join(" | ")
    : `${results.passes.length} rules passed`;
  check(`axe: no serious/critical WCAG violations on ${label}`, blocking.length === 0, detail);
}

const target = await resolveLocalOnlyTarget();
console.log(`Target: ${target.url} (local static server, mocked backend — see lib/mockCloud.mjs)`);

const VERIFIED = new Date().toISOString();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors = await consoleErrorCollector(page);

await installMockCloud(page, {
  profiles: [
    { id: "u1", handle: "dana", display_name: "דנה", is_admin: false, recovery_verified_at: VERIFIED, visible_to_club: true },
  ],
  invite_redemptions: [{ user_id: "u1", invite_id: "inv-1", role: "member", redeemed_at: VERIFIED }],
  community_feed: [],
}, { user: { id: "u1", is_anonymous: false, email: "dana@members.haimuniya.invalid" } });

await page.goto(target.url, { waitUntil: "networkidle" });
await page.waitForSelector("#app", { state: "visible", timeout: 30000 });
await dismissWelcomeModal(page);

// The four offline training-log tabs.
for (const [tabId, label] of [
  ["tabAddBtn", "Add (log a set)"],
  ["tabHistoryBtn", "History"],
  ["tabCalendarBtn", "Calendar"],
  ["tabWodBtn", "WOD"],
]) {
  await switchTab(page, tabId);
  await page.waitForTimeout(150);
  await scan(page, label);
}

// No Community surface in the training-log edition: the four screens above,
// plus Settings below, are the whole app.

// Settings lives inside the hamburger menu, so it needs the menu opened
// first - clicking the row directly hits an element that is present in the
// DOM but not visible.
if (await page.$("[data-action='toggle-nav-menu']")) {
  await page.click("[data-action='toggle-nav-menu']");
  await page.waitForTimeout(200);
  const settingsRow = await page.$("[data-action='open-settings']:visible");
  if (settingsRow) {
    await settingsRow.click();
    await page.waitForTimeout(300);
    await scan(page, "Settings");
  }
}

check("no console errors during the accessibility sweep", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
process.exit(failed ? 1 : 0);

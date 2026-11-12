#!/usr/bin/env node
// The WOD tab's third sub-tab, בנצ'מרקים: a browsable list of the built-in
// Girls/Heroes benchmark WODs (WOD_LIBRARY), separate from custom ones —
// tap one to jump straight into logging it.
//
// Usage:
//   node benchmarks.mjs                 # local working tree
//   TARGET_URL=<url> node benchmarks.mjs # a deployed site
import { chromium } from "playwright";
import { resolveTarget } from "./lib/target.mjs";
import { switchTab, dismissWelcomeModal, consoleErrorCollector } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

const target = await resolveTarget();
console.log(`Target: ${target.url}${target.local ? " (local static server)" : ""}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
const errors = await consoleErrorCollector(page);

// COMM-333: cloud.js boots unconditionally regardless of which tab a
// script visits, and cloud-config.js points at the real, live production
// Supabase project - without this, an offline-only check like this one
// still fires real network calls (session restore, anonymous sign-in via
// the auto-backup bootstrap, etc.) against production in the background,
// which is both a safety risk (see lib/mockCloud.mjs's own comment) and
// the source of intermittent 401/409 console errors this suite saw.
await installMockCloud(page);
await page.goto(target.url, { waitUntil: "networkidle" });
await page.waitForSelector("#app", { state: "visible" });
await dismissWelcomeModal(page);

await switchTab(page, "tabWodBtn");
await page.waitForTimeout(200);

// COMM-360: selectedWodId now defaults to null (not WOD_LIBRARY[0]/"Fran")
// so a fresh load lands on the log subtab's empty state, not a pre-filled
// form - a user must explicitly pick a WOD before any log form appears.
//
// That empty state was rewritten (8afbc57) and this assertion moved with
// it. The old copy was "בחרו אימון כדי להתחיל" on a screen with ZERO
// interactive elements outside the three subtab pills - a dead end two
// audit personas escaped only by guessing that "benchmarks" must be where
// workouts live. The copy is now "בחרו אימון ונרשום אותו" and the state
// carries a real door out of it. Both halves are asserted below, because
// the copy alone was never the fix: an empty state that names itself but
// still offers no action is the same dead end with better wording.
const emptyState = await page.evaluate(() => {
  const c = document.getElementById("wodContent");
  return {
    text: c?.textContent || "",
    hasPicker: !!c?.querySelector("[data-action='open-wod-picker']"),
    hasBuilder: !!c?.querySelector("[data-action='open-wod-builder']"),
    // #wodLogDateInput is rendered only by the branch that dereferences a
    // selected WOD, so its absence is the load-bearing half: no form.
    hasLogForm: !!c?.querySelector("#wodLogDateInput"),
    ctaAction: document.getElementById("bottomBarBtn")?.dataset.action || "",
    ctaLabel: (document.getElementById("saveBtnLabel")?.textContent || "").trim(),
  };
});
check(
  "the log subtab shows the pick-a-WOD empty state on a fresh load, not a pre-filled form",
  emptyState.text.includes("בחרו אימון ונרשום אותו") && !emptyState.hasLogForm,
  emptyState.text.replace(/\s+/g, " ").trim().slice(0, 80),
);
check(
  "that empty state offers a way out (a wod-picker button), not just a sentence",
  emptyState.hasPicker,
);
// The builder is otherwise reachable only from inside the picker, so the
// empty state is the only screen that offers it directly.
check("the empty state also offers the build-your-own path", emptyState.hasBuilder);
// The same screen used to leave the fixed bottom CTA reading "רישום סט" —
// an action belonging to a different tab entirely — wired to save-wod.
check(
  "the bottom CTA on the empty state points at the picker, not a stale save",
  emptyState.ctaAction === "open-wod-picker" && emptyState.ctaLabel === "בחירת אימון",
  `${emptyState.ctaAction} / "${emptyState.ctaLabel}"`,
);

// ---- The door actually opens, and the words behind it are legible --------
//
// "The empty state offers the build-your-own path" (above) is a claim about
// markup. This is the claim that matters: the builder is the ONLY screen in
// the app carrying the AMRAP/EMOM glosses, they were written, then buried at
// 9.5px, then raised to 13px - and none of that reaches a member if the
// screen holding them cannot be opened. A design review reported the builder
// as still unreachable behind renderWodLogSection()'s early return; the empty
// state rewrite (8afbc57) had already given it a door, but nothing asserted
// that end to end, which is exactly why the report could neither be
// confirmed nor dismissed by reading the code.
await page.click("#content [data-action='open-wod-builder']");
await page.waitForFunction(() => document.getElementById("wodBuilderOverlay")?.classList.contains("open"), { timeout: 5000 });
check("the build-your-own door actually opens the builder", true);
const glosses = await page.evaluate(() => {
  const o = document.getElementById("wodBuilderOverlay");
  const subs = [...o.querySelectorAll(".format-chip-sub, .term-sub")];
  return {
    count: subs.length,
    minPx: Math.min(...subs.map((s) => parseFloat(getComputedStyle(s).fontSize))),
    text: subs.map((s) => s.textContent.trim()),
  };
});
check("every workout format carries its gloss", glosses.count >= 4, glosses.text.join(" / "));
// The one thing a gloss must never be is the smallest type on the screen -
// which is what 9.5px made the explanations of the two hardest words in the
// app (AMRAP, EMOM).
check("...at the spec's 13px, not buried under the body text", glosses.minPx >= 13, `${glosses.minPx}px`);
await page.evaluate(() => closeWodBuilder());
await page.waitForFunction(() => !document.getElementById("wodBuilderOverlay")?.classList.contains("open"), { timeout: 5000 });

// Reach the benchmarks subtab via its pill in the subtabbar.
await page.click("button.subtabbtn[data-subtab='benchmarks']");
await page.waitForTimeout(200);

const pillActive = await page.evaluate(() => document.querySelector(".subtabbtn[data-subtab='benchmarks']").classList.contains("active"));
check("benchmarks pill highlights on tap", pillActive);

// No search/filter input exists in renderWodBenchmarksSection() as of
// this app version — it lists the full WOD_LIBRARY directly with no
// wrapper id and no way to narrow it. That's a real behavior change from
// what this check originally covered (flagged separately, not rebuilt
// here) — this check now covers what actually exists: the full list.
const listText = await page.evaluate(() => document.getElementById("wodContent")?.textContent || "");
check("benchmarks list shows Girls and Heroes entries", listText.includes("Fran") && listText.includes("Murph"), listText.slice(0, 80));

await page.click("[data-action='select-benchmark'][data-id='grace']");
await page.waitForTimeout(200);
const logActive = await page.evaluate(() => document.querySelector(".subtabbtn[data-subtab='log']").classList.contains("active"));
check("picking a benchmark switches to the log subtab", logActive);
const wodName = await page.evaluate(() => document.querySelector(".exercise-select span")?.textContent || "");
check("log form shows the picked benchmark", wodName === "Grace", wodName);

// ---- Design spec 3.6: Rx is no longer the default -----------------------
// Asserted in a real browser because two thirds of this is rendered state:
// the dashed "nothing chosen yet" frame is a computed border, and the
// disabled CTA is a computed opacity. index.html shipped both rules ahead of
// time and they were inert until app.js emitted this markup.
const rx = await page.evaluate(() => {
  const t = document.querySelector(".rx-toggle");
  const full = document.querySelector('[data-action="set-rx"][data-rx="1"]');
  const scaled = document.querySelector('[data-action="set-rx"][data-rx="0"]');
  const cta = document.getElementById("bottomBarBtn");
  return {
    unset: t?.classList.contains("unset"),
    borderStyle: t ? getComputedStyle(t).borderTopStyle : "",
    fullChecked: full?.getAttribute("aria-checked"),
    scaledChecked: scaled?.getAttribute("aria-checked"),
    fullText: full?.innerText.replace(/\s+/g, " ").trim(),
    scaledText: scaled?.innerText.replace(/\s+/g, " ").trim(),
    glossPx: full ? parseFloat(getComputedStyle(full.querySelector(".term-sub")).fontSize) : 0,
    ctaDisabled: cta?.disabled,
    helper: document.getElementById("wodContent").textContent.includes("בחרו איך ביצעתם את האימון"),
  };
});
check("neither Rx nor Scaled is pre-selected", rx.fullChecked === "false" && rx.scaledChecked === "false",
  `Rx=${rx.fullChecked} Scaled=${rx.scaledChecked}`);
check("an unmade choice LOOKS unmade (dashed frame)", rx.unset === true && rx.borderStyle === "dashed", rx.borderStyle);
check("both options are Hebrew-first and keep the English", /^מלא \(Rx\)/.test(rx.fullText) && /^מותאם \(Scaled\)/.test(rx.scaledText),
  `${rx.fullText} | ${rx.scaledText}`);
check("each carries a readable gloss", rx.glossPx >= 12, `${rx.glossPx}px`);
check("the save CTA is disabled until the member answers", rx.ctaDisabled === true);
check("...and the screen says why", rx.helper === true);

await page.click('[data-action="set-rx"][data-rx="0"]');
await page.waitForTimeout(250);
const afterChoice = await page.evaluate(() => ({
  unset: document.querySelector(".rx-toggle")?.classList.contains("unset"),
  scaledChecked: document.querySelector('[data-action="set-rx"][data-rx="0"]')?.getAttribute("aria-checked"),
  ctaDisabled: document.getElementById("bottomBarBtn")?.disabled,
}));
check("answering selects the chip, clears the dashed frame and enables the CTA",
  afterChoice.scaledChecked === "true" && afterChoice.unset === false && afterChoice.ctaDisabled === false,
  JSON.stringify(afterChoice));

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\nbenchmarks: FAILED" : "\nbenchmarks: all checks passed");
process.exit(failed ? 1 : 0);

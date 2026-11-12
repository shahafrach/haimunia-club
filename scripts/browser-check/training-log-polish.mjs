#!/usr/bin/env node
// THIRTEEN FINDINGS FROM A REAL-PHONE PASS OVER THE TRAINING LOG, measured
// at 390x844 in both themes. (The fourteenth, the bidi one, has its own file:
// bidi-measurement-order.mjs, because it needs a different kind of
// measurement entirely.)
//
// WHY THESE ARE HERE AND NOT IN `npm test`. Every one of them is a geometry
// fact, a computed-style fact, or a colour contrast ratio. jsdom returns 0x0
// at (0,0) for every rect it is asked for, resolves neither svh nor clamp()
// nor a colour written as var(--energy), and has no notion of which of two
// same-specificity rules won. The markup was correct in all thirteen cases,
// which is why the node suite passed against every one of them and would pass
// again the day any of them comes back.
//
//   2. THE MEDAL CAPTION THAT COULD NOT WRAP. "אתלט שלם"'s rule ends in
//      "(סקוואט/דדליפט/לחיצה/אולימפי/משיכה)" - 38 characters with no space in
//      them - inside an .ach-grid cell of minmax(72px,1fr). There was no
//      break available, so it ran off the cell, off the sheet and off the
//      viewport.
//   3. AN EMPTY CHANGELOG OPENING BY ITSELF. The header bell falls back to
//      the release-notes sheet when the community notification centre cannot
//      open - so a badge counting real community notifications answered a tap
//      with a full-screen "אין עדכונים חדשים".
//   4. DAYS WITH A DOT SAT HIGHER THAN DAYS WITHOUT. .cal-cell centred its
//      children as a flex column, so a cell holding [number][dot] centred two
//      boxes and one holding [number] centred one.
//   5. RED ON A NORMAL TRAINING ROTATION. The category volume card painted
//      anything untrained for 14 days red, which on a block programme is an
//      ordinary fortnight - and labelled the two counts "סטים 0/1".
//   6. TODAY IN A SECOND RED. The selected day (which is today, on arrival)
//      was #d92f2b, a literal that is not the app's --energy accent.
//   7. THE PHOTO STILL TOOK HALF THE SCREEN on Library, Progress and
//      Calendar - the three scenes the Add screen's own reduction left out.
//   8. A CHART WITH ONE OR TWO POINTS drew the full 174px plot area and one
//      dot in it.
//   9. THE MEDALS SHEET OVER A PHOTO OF PLATES. It inherited the scene
//      sheet's translucency, so 11px --steel captions sat on a bronze/gold
//      photograph at no computable contrast ratio at all.
//  10. TWO ROW STYLES IN ONE MENU. The hamburger's own destinations carry
//      .tabbtn as a behavioural hook; its `flex-direction:column` was never
//      cancelled, so those rows rendered as centred icon-over-label cards
//      among chevron rows.
//  11. ONE CATEGORY, TWO NAMES: "בנות" in the catalogue, "GIRLS" in the
//      picker.
//  12. THE HISTORY TAB'S EMPTY STATE described the progress screen.
//  13. THE TERMS SHEET'S CLOSE BUTTON was a .chip-btn pill, not the app's
//      standard .icon-btn X.
//  14. THE SHARE EMOJI. 📤 among stroke icons.
//
// EVERY ASSERTION IS PAIRED WITH A CONTROL wherever the fix is a style that
// can be put back: the pre-fix declaration is restored on the live page and
// the same measurement is required to FAIL. That is the house rule from
// install-dock-hit-check.mjs and training-log-ux-fixes.mjs, and it is what
// separates "this screen is fine" from "this screen is fine BECAUSE of the
// change under test".
//
// Usage:
//   node training-log-polish.mjs                  # local working tree
//   TARGET_URL=<url> node training-log-polish.mjs # a deployed site
import { chromium } from "playwright";
import { resolveTarget } from "./lib/target.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";
import {
  dismissWelcomeModal,
  selectMovement,
  dismissFirstLogArrival,
  dismissCelebrationIfOpen,
  switchTab,
  consoleErrorCollector,
} from "./lib/actions.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

const VIEWPORT = { width: 390, height: 844 };

// A stylesheet override that can be put back, so a control is one call.
async function withPatchedCss(page, css, fn) {
  await page.evaluate((text) => {
    const el = document.createElement("style");
    el.id = "__controlPatch";
    el.textContent = text;
    document.head.appendChild(el);
  }, css);
  try {
    return await fn();
  } finally {
    await page.evaluate(() => document.getElementById("__controlPatch")?.remove());
  }
}

// WCAG relative luminance and contrast, over "rgb(r, g, b)" strings as
// getComputedStyle returns them. Computed from the RENDERED colours rather
// than from the token literals: what a member reads is the colour that won,
// which is the whole point of finding 9.
function contrastInPage(page, fgSel, bgSel) {
  return page.evaluate(({ fgSel, bgSel }) => {
    const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
    const lum = ([r, g, b]) => {
      const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const fgEl = document.querySelector(fgSel), bgEl = document.querySelector(bgSel);
    if (!fgEl || !bgEl) return null;
    const fg = parse(getComputedStyle(fgEl).color);
    const bgRaw = getComputedStyle(bgEl).backgroundColor;
    const bg = parse(bgRaw);
    const alpha = bg.length === 4 ? bg[3] : 1;
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    return { ratio: Math.round(ratio * 100) / 100, alpha, fg: getComputedStyle(fgEl).color, bg: bgRaw };
  }, { fgSel, bgSel });
}

// select-history TOGGLES. Clicking it a second time on a row that is already
// expanded closes the card and takes the chart with it, which is how an
// earlier draft of this file measured "no plot" and reported it as a
// regression. Idempotent: expand if, and only if, nothing is expanded yet.
async function openFirstHistoryDetail(page) {
  const alreadyOpen = await page.evaluate(() => !!document.querySelector("#historyListArea .exercise-row.active"));
  if (!alreadyOpen) await page.click("[data-action='select-history'] >> nth=0");
  await page.waitForTimeout(400);
}

const isoDaysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

async function logSet(page, { date, weight, reps }) {
  await page.fill("#logDateInput", date);
  await page.dispatchEvent("#logDateInput", "change");
  await page.evaluate(({ weight, reps }) => {
    applyFieldValue("step", "weight", weight);
    applyFieldValue("step", "reps", reps);
  }, { weight, reps });
  await page.click("[data-action='save-set']");
  await page.waitForTimeout(300);
  await dismissFirstLogArrival(page);
  await dismissCelebrationIfOpen(page);
}

const target = await resolveTarget();
console.log(`Target: ${target.url}${target.local ? " (local static server)" : ""}`);
console.log(`Viewport: ${VIEWPORT.width}x${VIEWPORT.height}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, locale: "he-IL" });
// Keeps the anonymous usage count off the real endpoint (see lib/mockCloud.mjs).
await installMockCloud(page);
const errors = await consoleErrorCollector(page);
await page.goto(target.url, { waitUntil: "networkidle" });

// ---------------------------------------------------------------------------
console.log("\n---- 3: the bell never answers with an empty changelog ----");
// Measured before anything is dismissed, because the boot gate is the other
// caller of the guard: a device with nothing unseen must arrive on the log
// screen with no sheet over it.
const bootSheet = await page.evaluate(() => ({
  open: document.getElementById("notificationsOverlay").classList.contains("open"),
  unseen: unseenReleaseNotes().length,
}));
check(
  "boot: the מה חדש sheet is not open when there is nothing unseen",
  bootSheet.unseen === 0 && bootSheet.open === false,
  JSON.stringify(bootSheet),
);
await dismissWelcomeModal(page);

// The reported path: a badge counting community notifications, and a
// community centre that cannot open.
const bellResult = await page.evaluate(() => {
  window.communityUnreadCount = () => 3;
  window.openCommunityNotifCenter = () => false;
  openHeaderNotifications();
  return {
    sheetOpen: document.getElementById("notificationsOverlay").classList.contains("open"),
    sheetText: (document.getElementById("notificationsList").textContent || "").trim(),
  };
});
check(
  "the bell does not open an empty מה חדש sheet",
  bellResult.sheetOpen === false,
  bellResult.sheetOpen ? `opened showing "${bellResult.sheetText}"` : "stayed closed",
);
const toastText = await page.evaluate(() => (document.getElementById("appToastDock")?.textContent || "").trim());
check("the tap is answered, not swallowed", /אין התראות/.test(toastText), JSON.stringify(toastText));
// CONTROL: the same sheet, opened the way Settings' own "מה חדש" row opens
// it, still opens - the guard is scoped to the app's own initiative, not to
// the member asking.
const controlOpen = await page.evaluate(() => {
  const opened = openNotifications();
  const state = document.getElementById("notificationsOverlay").classList.contains("open");
  closeNotifications();
  return { opened, state };
});
check(
  "CONTROL: a direct request still opens it, empty or not",
  controlOpen.opened === true && controlOpen.state === true,
  JSON.stringify(controlOpen),
);
await page.evaluate(() => { delete window.communityUnreadCount; delete window.openCommunityNotifCenter; });

// ---------------------------------------------------------------------------
console.log("\n---- 7: the scene photo on Library, Progress and Calendar ----");
const PRE_FIX_PHOTO = {
  "scene-page--library": "calc(42svh + 16px)",
  "scene-page--history": "calc(40svh + 16px)",
  "scene-page--progress": "calc(38svh + 16px)",
};
const sceneTabs = [
  { tab: "tabWodBtn", cls: "scene-page--library", name: "Library" },
  { tab: "tabHistoryBtn", cls: "scene-page--progress", name: "Progress" },
  { tab: "tabCalendarBtn", cls: "scene-page--history", name: "Calendar" },
];
const photoHeight = (page) =>
  page.evaluate(() => {
    const el = document.querySelector(".scene-page");
    if (!el) return null;
    const h = getComputedStyle(el).getPropertyValue("--scene-photo-height");
    // Resolved through a real element so svh and calc() are real numbers.
    const probe = document.createElement("div");
    probe.style.height = h;
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    el.appendChild(probe);
    const px = probe.getBoundingClientRect().height;
    probe.remove();
    return { px: Math.round(px * 10) / 10, pct: Math.round((px / window.innerHeight) * 1000) / 10 };
  });
for (const s of sceneTabs) {
  await switchTab(page, s.tab);
  await page.waitForTimeout(350);
  const now = await photoHeight(page);
  check(
    `${s.name}: the photo is no longer about half the screen`,
    now && now.pct <= 36,
    now ? `${now.px}px = ${now.pct}% of the viewport` : "no .scene-page",
  );
  const before = await withPatchedCss(page, `.${s.cls}{ --scene-photo-height:${PRE_FIX_PHOTO[s.cls]} !important; }`, () =>
    photoHeight(page));
  check(
    `${s.name}: CONTROL — the pre-fix value really was that tall`,
    before && before.pct >= 39,
    before ? `${before.px}px = ${before.pct}%` : "no .scene-page",
  );
  // The composition has to survive the reduction: the title block still sits
  // on the photo, above the sheet, not behind the header.
  const intro = await page.evaluate(() => {
    const i = document.querySelector(".scene-page__intro"), sheet = document.querySelector(".scene-sheet");
    if (!i || !sheet) return null;
    const ir = i.getBoundingClientRect(), sr = sheet.getBoundingClientRect();
    return { top: Math.round(ir.top), bottom: Math.round(ir.bottom), sheetTop: Math.round(sr.top) };
  });
  check(
    `${s.name}: the title still sits on the photo, clear of the header and the sheet`,
    intro && intro.top > 64 && intro.bottom <= intro.sheetTop + 8,
    JSON.stringify(intro),
  );
}

// ---------------------------------------------------------------------------
console.log("\n---- 11 + 12: one category name, and an empty state that fits ----");
await switchTab(page, "tabWodBtn");
await page.waitForTimeout(300);
await page.click("button.subtabbtn[data-subtab='history']");
await page.waitForTimeout(250);
const emptyHistory = await page.evaluate(() => (document.getElementById("wodHistoryListArea")?.textContent || "").trim());
check(
  "the empty history tab no longer borrows the progress screen's line",
  !/כדי להתחיל לראות התקדמות/.test(emptyHistory) && emptyHistory.length > 0,
  JSON.stringify(emptyHistory),
);
check(
  "it says what history will hold",
  /אימון/.test(emptyHistory) && /שיא/.test(emptyHistory),
  JSON.stringify(emptyHistory),
);
await page.click("button.subtabbtn[data-subtab='benchmarks']");
await page.waitForTimeout(250);
const catalogueNames = await page.evaluate(() =>
  [...document.querySelectorAll(".cat-group .cat-name")].map((e) => e.textContent.trim()));
await page.click("button.subtabbtn[data-subtab='log']");
await page.waitForTimeout(250);
await page.click("[data-action='open-wod-picker']");
await page.waitForTimeout(350);
const pickerNames = await page.evaluate(() =>
  [...document.querySelectorAll("#wodPickerList .cat-group .cat-name")].map((e) => e.textContent.trim()));
await page.click("#wodPickerOverlay button[data-action='close-wod-picker']").catch(() => {});
await page.waitForTimeout(200);
check(
  "the catalogue names the benchmark group in Hebrew",
  catalogueNames.includes("בנות") && catalogueNames.includes("גיבורים"),
  JSON.stringify(catalogueNames),
);
check(
  "the picker names it identically — one name, both screens",
  pickerNames.includes("בנות") && !pickerNames.some((n) => /girls/i.test(n)),
  JSON.stringify(pickerNames),
);

// ---------------------------------------------------------------------------
console.log("\n---- 10: one row style in the main menu ----");
await page.evaluate(() => { const o = document.getElementById("wodPickerOverlay"); if (o) o.classList.remove("open"); });
await page.click("#navMenuBtn");
await page.waitForSelector("#navMenuOverlay.open");
await page.waitForTimeout(250);
const navRows = await page.evaluate(() =>
  [...document.querySelectorAll("#navMenuOverlay .navrow")].map((el) => {
    const cs = getComputedStyle(el);
    const label = el.querySelector(".nav-label");
    const chip = el.querySelector(".icon-chip");
    const chevron = [...el.children].some((c) => c !== label && c !== chip && c.querySelector("svg, img"));
    return {
      text: (label?.textContent || "").trim(),
      direction: cs.flexDirection,
      justify: cs.justifyContent,
      chipLeft: chip ? Math.round(chip.getBoundingClientRect().left) : null,
      labelLeft: label ? Math.round(label.getBoundingClientRect().left) : null,
      chevron,
    };
  }));
// The four screens live in the bottom bar, so the menu holds only the rows
// that are not screens (settings, support) - two in this edition.
check("the nav menu has rows to measure", navRows.length >= 2, `${navRows.length} rows`);
check(
  "every row lays out as a row, not a centred column",
  navRows.every((r) => r.direction === "row"),
  JSON.stringify(navRows.map((r) => `${r.text}:${r.direction}`)),
);
check(
  "every row ends with a chevron",
  navRows.every((r) => r.chevron),
  JSON.stringify(navRows.map((r) => `${r.text}:${r.chevron}`)),
);
check(
  "every row's icon sits at the same edge (RTL: the chip is right of its label)",
  navRows.every((r) => r.chipLeft !== null && r.labelLeft !== null && r.chipLeft > r.labelLeft),
  JSON.stringify(navRows.map((r) => `${r.text}:${r.chipLeft}>${r.labelLeft}`)),
);
// The community edition's CONTROL re-applied .tabbtn's column layout to the
// management rows in this menu. This edition has no .tabbtn row here at all,
// so the split it guarded against cannot happen.
await page.click("#navMenuOverlay button[data-action='close-nav-menu']");
await page.waitForTimeout(250);

// ---------------------------------------------------------------------------
// Findings 13 and 14 were the community's share control and glossary sheet,
// neither of which exists in the training-log edition.

// ---------------------------------------------------------------------------
console.log("\n---- 8: a chart with too few points to be a trend ----");
await switchTab(page, "tabAddBtn");
await page.waitForTimeout(300);
await selectMovement(page, "Back Squat");
await logSet(page, { date: isoDaysAgo(20), weight: 80, reps: 5 });
await logSet(page, { date: isoDaysAgo(10), weight: 85, reps: 5 });
await switchTab(page, "tabHistoryBtn");
await page.waitForTimeout(400);
await openFirstHistoryDetail(page);
const twoPoint = await page.evaluate(() => {
  const compact = document.querySelector("#historyListArea .chart-compact");
  const svg = document.querySelector("#historyListArea svg[role='img']");
  return {
    compact: !!compact,
    compactHeight: compact ? Math.round(compact.getBoundingClientRect().height) : null,
    rows: compact ? compact.children.length : 0,
    plot: !!svg,
    label: compact ? compact.getAttribute("aria-label") : null,
  };
});
check("two points render as a compact readout, not a plot", twoPoint.compact && !twoPoint.plot, JSON.stringify(twoPoint));
check("one row per point", twoPoint.rows === 2, String(twoPoint.rows));
check(
  "it is a fraction of the plot area it replaces (174px)",
  twoPoint.compactHeight !== null && twoPoint.compactHeight < 110,
  `${twoPoint.compactHeight}px`,
);
check("it keeps a real accessible name", !!twoPoint.label && /\d/.test(twoPoint.label), JSON.stringify(twoPoint.label));
// CONTROL: a third point, and the same card draws the real plot again.
await switchTab(page, "tabAddBtn");
await page.waitForTimeout(300);
await logSet(page, { date: isoDaysAgo(3), weight: 90, reps: 5 });
await switchTab(page, "tabHistoryBtn");
await page.waitForTimeout(400);
await openFirstHistoryDetail(page);
const threePoint = await page.evaluate(() => {
  const svg = document.querySelector("#historyListArea svg[role='img']");
  return {
    compact: !!document.querySelector("#historyListArea .chart-compact"),
    plot: !!svg,
    plotHeight: svg ? Math.round(svg.getBoundingClientRect().height) : null,
  };
});
check(
  "CONTROL: the third point brings the real plot back",
  threePoint.plot && !threePoint.compact && threePoint.plotHeight > 150,
  JSON.stringify(threePoint),
);

// ---------------------------------------------------------------------------
console.log("\n---- 4 + 5 + 6: the calendar ----");
// A second category, left long enough to be genuinely overdue, and a third
// inside the "not recent but not a lapse" window the finding is about.
await switchTab(page, "tabAddBtn");
await page.waitForTimeout(300);
await selectMovement(page, "Deadlift");
await logSet(page, { date: isoDaysAgo(20), weight: 100, reps: 3 });
await switchTab(page, "tabAddBtn");
await page.waitForTimeout(250);
await selectMovement(page, "Strict Press");
await logSet(page, { date: isoDaysAgo(45), weight: 40, reps: 5 });
await switchTab(page, "tabCalendarBtn");
await page.waitForTimeout(500);

const dayNums = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#calGrid .cal-cell:not(.empty)")].map((cell) => {
      const num = cell.querySelector(".cal-daynum");
      const dot = cell.querySelector(".cal-dot");
      const nr = num.getBoundingClientRect();
      return {
        day: num.textContent.trim(),
        hasDot: !!dot,
        // The CELL's own top, for grouping into week rows. Grouping on the
        // NUMBER's top would be circular: in the pre-fix layout the numbers
        // are exactly what move, so a control run could split one week into
        // two "rows" and report a smaller spread than it really has.
        cellTop: Math.round(cell.getBoundingClientRect().top),
        top: Math.round(nr.top * 10) / 10,
        bottom: Math.round(nr.bottom * 10) / 10,
        dotTop: dot ? Math.round(dot.getBoundingClientRect().top * 10) / 10 : null,
      };
    }));
const cells = await dayNums(page);
check("the calendar grid has cells with and without dots", cells.some((c) => c.hasDot) && cells.some((c) => !c.hasDot), `${cells.filter((c) => c.hasDot).length} with a dot of ${cells.length}`);
// Compare within one week row, so the assertion is about the dot and not
// about which row of the month a day falls in.
function baselineSpread(cells) {
  const byRow = new Map();
  for (const c of cells) {
    const key = c.cellTop;
    if (!byRow.has(key)) byRow.set(key, []);
    byRow.get(key).push(c);
  }
  let worst = 0, detail = "";
  for (const row of byRow.values()) {
    if (row.length < 2) continue;
    const tops = row.map((c) => c.top);
    const spread = Math.max(...tops) - Math.min(...tops);
    if (spread > worst) { worst = spread; detail = JSON.stringify(row.map((c) => `${c.day}${c.hasDot ? "•" : ""}:${c.top}`)); }
  }
  return { worst, detail };
}
const spread = baselineSpread(cells);
check("every day number in a week sits on the same baseline", spread.worst <= 0.6, `worst spread ${spread.worst}px ${spread.detail}`);
const dotted = cells.filter((c) => c.hasDot);
check(
  "the dot is below the number, not beside or behind it",
  dotted.length > 0 && dotted.every((c) => c.dotTop >= c.bottom - 1),
  JSON.stringify(dotted.map((c) => `${c.day}: num ends ${c.bottom}, dot starts ${c.dotTop}`)),
);
// CONTROL: the pre-fix centred flex column, restored.
const controlSpread = await withPatchedCss(
  page,
  "body[data-scene] .cal-cell, .cal-cell{ display:flex !important; flex-direction:column !important; justify-content:center !important; gap:3px !important; }",
  async () => baselineSpread(await dayNums(page)),
);
check(
  "CONTROL: the pre-fix layout really did move the numbers",
  controlSpread.worst > 1,
  `worst spread ${controlSpread.worst}px ${controlSpread.detail}`,
);

const todayPaint = await page.evaluate(() => {
  const el = document.querySelector("#calGrid .cal-cell.selected .cal-daynum")
    || document.querySelector("#calGrid .cal-cell.today .cal-daynum");
  if (!el) return null;
  const cs = getComputedStyle(el);
  const probe = document.createElement("div");
  probe.style.color = "var(--energy)";
  document.body.appendChild(probe);
  const energy = getComputedStyle(probe).color;
  probe.remove();
  return { bg: cs.backgroundColor, color: cs.color, energy };
});
check("today is painted in the app's own accent", todayPaint && todayPaint.bg === todayPaint.energy, JSON.stringify(todayPaint));
check(
  "and it is not the old second red",
  todayPaint && todayPaint.bg !== "rgb(217, 47, 43)",
  todayPaint ? todayPaint.bg : "no cell",
);

const volumeRows = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".report-row")].map((row) => {
      const flag = row.querySelector(".report-flag");
      const counts = row.querySelector(".mono");
      return {
        cat: row.querySelector("span")?.textContent.trim(),
        flagText: flag ? flag.textContent.trim() : null,
        flagColor: flag ? getComputedStyle(flag).color : null,
        counts: counts ? counts.textContent.trim() : null,
      };
    }));
const vrows = await volumeRows(page);
check("the volume card has rows", vrows.length >= 3, `${vrows.length} rows`);
const neverLogged = vrows.filter((r) => r.flagText === "טרם נרשם");
const notRecent = vrows.find((r) => /לפני 20 ימים/.test(r.flagText || ""));
const overdue = vrows.find((r) => /לפני 45 ימים/.test(r.flagText || ""));
check("a 20-day-old category is on screen", !!notRecent, JSON.stringify(vrows.map((r) => r.flagText)));
check("a 45-day-old category is on screen", !!overdue, JSON.stringify(vrows.map((r) => r.flagText)));
if (notRecent && overdue && neverLogged.length) {
  check(
    "20 days is neutral, not red — the same neutral a never-logged row takes",
    notRecent.flagColor === neverLogged[0].flagColor,
    `${notRecent.flagColor} vs never-logged ${neverLogged[0].flagColor}`,
  );
  check(
    "45 days is still red, so red still means something",
    overdue.flagColor !== notRecent.flagColor,
    `overdue ${overdue.flagColor} vs not-recent ${notRecent.flagColor}`,
  );
}
check(
  "the counts row names both windows instead of printing a slash",
  vrows.every((r) => r.counts && /ב-7 ימים/.test(r.counts) && /ב-30 ימים/.test(r.counts) && !/\d\/\d/.test(r.counts)),
  JSON.stringify(vrows.map((r) => r.counts).slice(0, 3)),
);

// ---------------------------------------------------------------------------
console.log("\n---- 2 + 9: the medals screen ----");
await page.evaluate(() => openAchievements());
await page.waitForTimeout(500);
const medalOverflow = (page) =>
  page.evaluate(() => {
    const out = [];
    for (const rule of document.querySelectorAll("#achievementsOverlay .medal-rule")) {
      const badge = rule.closest(".medal-badge");
      const rr = rule.getBoundingClientRect(), br = badge.getBoundingClientRect();
      out.push({
        text: rule.textContent.trim().slice(0, 28),
        overflowsCell: Math.round(rule.scrollWidth) > Math.round(rr.width) + 1,
        outsideViewport: rr.left < -1 || rr.right > window.innerWidth + 1,
        cellWidth: Math.round(br.width),
      });
    }
    return out;
  });
const rules = await medalOverflow(page);
check("the medals screen has captions to measure", rules.length > 20, `${rules.length} captions`);
check(
  "no caption overflows its own cell",
  rules.every((r) => !r.overflowsCell),
  JSON.stringify(rules.filter((r) => r.overflowsCell).map((r) => r.text)),
);
check(
  "no caption is clipped at the screen edge",
  rules.every((r) => !r.outsideViewport),
  JSON.stringify(rules.filter((r) => r.outsideViewport).map((r) => r.text)),
);
const controlRules = await withPatchedCss(page, ".medal-rule{ overflow-wrap:normal !important; }", () => medalOverflow(page));
check(
  "CONTROL: without the wrap rule, a caption really does overflow",
  controlRules.some((r) => r.overflowsCell),
  JSON.stringify(controlRules.filter((r) => r.overflowsCell).map((r) => r.text)),
);

const repeats = await page.evaluate(() =>
  [...document.querySelectorAll("#achievementsOverlay .medal-badge")]
    .map((b) => ({
      name: b.querySelector(".medal-name")?.textContent.trim() || "",
      rule: b.querySelector(".medal-rule")?.textContent.trim() || "",
    }))
    .filter((m) => {
      if (!m.name || !m.rule) return false;
      // Any word of four characters or more that the caption repeats from the
      // title. Four, so "של"/"עם" and the like are not counted as repetition.
      return m.name
        .split(/[\s—–-]+/)
        .filter((w) => w.length >= 4)
        .some((w) => m.rule.includes(w));
    }));
check(
  "no caption repeats its own medal's title",
  repeats.length === 0,
  JSON.stringify(repeats.slice(0, 4)),
);

for (const theme of ["light", "dark"]) {
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await page.waitForTimeout(250);
  const sheetAlpha = await page.evaluate(() => {
    const el = document.querySelector("#achievementsOverlay .scene-sheet");
    if (!el) return null;
    const cs = getComputedStyle(el);
    const parts = (cs.backgroundColor.match(/[\d.]+/g) || []).map(Number);
    return { bg: cs.backgroundColor, alpha: parts.length === 4 ? parts[3] : 1, blur: cs.backdropFilter };
  });
  check(
    `${theme} theme: the medals sheet is the app's ordinary opaque surface`,
    sheetAlpha && sheetAlpha.alpha === 1,
    JSON.stringify(sheetAlpha),
  );
  const ruleContrast = await contrastInPage(page, "#achievementsOverlay .medal-rule", "#achievementsOverlay .scene-sheet");
  check(
    `${theme} theme: caption contrast clears AA (4.5:1)`,
    ruleContrast && ruleContrast.ratio >= 4.5,
    ruleContrast ? `${ruleContrast.ratio}:1 (${ruleContrast.fg} on ${ruleContrast.bg})` : "not measurable",
  );
  const nameContrast = await contrastInPage(page, "#achievementsOverlay .medal-name", "#achievementsOverlay .scene-sheet");
  check(
    `${theme} theme: medal titles clear AA too`,
    nameContrast && nameContrast.ratio >= 4.5,
    nameContrast ? `${nameContrast.ratio}:1` : "not measurable",
  );
}
// CONTROL: the translucency the overlay used to inherit, put back.
const controlContrast = await withPatchedCss(
  page,
  "#achievementsOverlay .scene-page > .scene-sheet{ background:rgba(20,31,58,.8) !important; }",
  () => contrastInPage(page, "#achievementsOverlay .medal-rule", "#achievementsOverlay .scene-sheet"),
);
check(
  "CONTROL: the pre-fix sheet really was translucent over the photo",
  controlContrast && controlContrast.alpha < 1,
  controlContrast ? `alpha ${controlContrast.alpha}` : "not measurable",
);
await page.evaluate(() => { delete document.documentElement.dataset.theme; closeAchievements(); });
await page.waitForTimeout(250);

// ---------------------------------------------------------------------------
console.log("\n---- the calendar and the menu again, in dark theme ----");
await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
await switchTab(page, "tabCalendarBtn");
await page.waitForTimeout(450);
const darkCells = await dayNums(page);
const darkSpread = baselineSpread(darkCells);
check("dark theme: the day numbers still share one baseline", darkSpread.worst <= 0.6, `worst spread ${darkSpread.worst}px`);
const darkToday = await page.evaluate(() => {
  const el = document.querySelector("#calGrid .cal-cell.selected .cal-daynum");
  if (!el) return null;
  const probe = document.createElement("div");
  probe.style.color = "var(--energy)";
  document.body.appendChild(probe);
  const energy = getComputedStyle(probe).color;
  probe.remove();
  return { bg: getComputedStyle(el).backgroundColor, energy };
});
check("dark theme: today still takes the accent", darkToday && darkToday.bg === darkToday.energy, JSON.stringify(darkToday));
const darkVolume = await volumeRows(page);
check(
  "dark theme: the counts row keeps both window labels",
  darkVolume.every((r) => r.counts && /ב-7 ימים/.test(r.counts) && /ב-30 ימים/.test(r.counts)),
  JSON.stringify(darkVolume.map((r) => r.counts).slice(0, 2)),
);
await page.click("#navMenuBtn");
await page.waitForSelector("#navMenuOverlay.open");
await page.waitForTimeout(250);
const darkNav = await page.evaluate(() =>
  [...document.querySelectorAll("#navMenuOverlay .navrow")].map((el) => getComputedStyle(el).flexDirection));
check("dark theme: every menu row is still a row", darkNav.length > 0 && darkNav.every((d) => d === "row"), JSON.stringify(darkNav));
await page.click("#navMenuOverlay button[data-action='close-nav-menu']");
await page.evaluate(() => { delete document.documentElement.dataset.theme; });
await page.waitForTimeout(200);

// ---------------------------------------------------------------------------
console.log("\n---- the rest of the findings, re-measured in dark theme ----");
// Every fix above is measured in both themes. The ones whose dark-theme pass
// is not already inline above are the ones whose fix is geometry or markup
// rather than colour - which is exactly why they are worth re-measuring
// rather than assumed: this app carries a separate token set per theme, and
// a dark-theme font metric or a theme-scoped rule that only exists in one
// block is how "it is only colour" stops being true.
await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
await page.waitForTimeout(250);

// 7, dark.
for (const s of sceneTabs) {
  await switchTab(page, s.tab);
  await page.waitForTimeout(350);
  const now = await photoHeight(page);
  check(
    `dark theme: ${s.name}'s photo keeps the reduced height`,
    now && now.pct <= 36,
    now ? `${now.px}px = ${now.pct}%` : "no .scene-page",
  );
}

// 8, dark. Back to the progress card, which still has three points on it.
await switchTab(page, "tabHistoryBtn");
await page.waitForTimeout(400);
await openFirstHistoryDetail(page);
const darkChart = await page.evaluate(() => {
  const svg = document.querySelector("#historyListArea svg[role='img']");
  return { plot: !!svg, plotHeight: svg ? Math.round(svg.getBoundingClientRect().height) : null };
});
check("dark theme: a three-point chart is still the full plot", darkChart.plot && darkChart.plotHeight > 150, JSON.stringify(darkChart));

// 12 + 11, dark: content, but read off the real dark-theme render rather
// than assumed to be theme-independent.
await switchTab(page, "tabWodBtn");
await page.waitForTimeout(300);
await page.click("button.subtabbtn[data-subtab='benchmarks']");
await page.waitForTimeout(250);
const darkCatalogue = await page.evaluate(() =>
  [...document.querySelectorAll(".cat-group .cat-name")].map((e) => e.textContent.trim()));
check("dark theme: the catalogue still names the group in Hebrew", darkCatalogue.includes("בנות"), JSON.stringify(darkCatalogue));


// 2, dark.
await page.evaluate(() => openAchievements());
await page.waitForTimeout(450);
const darkRules = await medalOverflow(page);
check(
  "dark theme: no medal caption overflows its cell or the viewport",
  darkRules.length > 20 && darkRules.every((r) => !r.overflowsCell && !r.outsideViewport),
  `${darkRules.length} captions, ${darkRules.filter((r) => r.overflowsCell || r.outsideViewport).length} overflowing`,
);
await page.evaluate(() => { closeAchievements(); delete document.documentElement.dataset.theme; });
await page.waitForTimeout(200);

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\ntraining-log-polish: FAILED" : "\ntraining-log-polish: all checks passed");
process.exit(failed ? 1 : 0);

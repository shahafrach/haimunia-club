// Audit check C6: RTL, axe (A11Y-1), 200% zoom, keyboard focus, icon buttons.
// Chromium-only — WebKit is not used for this check.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMockCloud } from "../scripts/browser-check/lib/mockCloud.mjs";
import { dismissWelcomeModal } from "../scripts/browser-check/lib/actions.mjs";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const BLOCKING = new Set(["serious", "critical"]);

test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "C6 axe/RTL checks run in Chromium only");
  await installMockCloud(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForSelector("#app", { state: "visible", timeout: 30_000 });
  await dismissWelcomeModal(page);
});

test("club home: document direction is rtl", async ({ page }) => {
  const dir = await page.evaluate(() => document.documentElement.getAttribute("dir"));
  expect(dir).toBe("rtl");
});

test("club home: axe reports zero serious or critical violations", async ({ page }) => {
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .analyze();
  const blocking = results.violations.filter((v) => BLOCKING.has(v.impact));
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
});

test("club home: no horizontal overflow at 200% zoom", async ({ page }) => {
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  );
  expect(overflow).toBe(false);
});

test("club home: Tab moves focus through interactive controls", async ({ page }) => {
  await page.click("#app", { position: { x: 8, y: 8 } });
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const desc = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return "";
      const action = el.getAttribute("data-action") || "";
      return `${el.tagName}:${action}:${el.id || ""}`;
    });
    if (desc) seen.add(desc);
    if (seen.size >= 3) break;
  }
  expect(seen.size).toBeGreaterThanOrEqual(3);
});

test("club home: visible icon-only buttons expose an accessible name", async ({ page }) => {
  const unnamed = await page.evaluate(() => {
    const isNamed = (el) => {
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy && document.getElementById(labelledBy.split(/\s+/)[0])?.textContent?.trim()) return true;
      const aria = (el.getAttribute("aria-label") || "").trim();
      if (aria) return true;
      const text = (el.innerText || el.textContent || "").trim();
      if (text) return true;
      const title = (el.getAttribute("title") || "").trim();
      return !!title;
    };
    return [...document.querySelectorAll("button, [role='button']")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return false;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") return false;
        return true;
      })
      .filter((el) => !isNamed(el))
      .map((el) => el.outerHTML.slice(0, 120));
  });
  expect(unnamed).toEqual([]);
});
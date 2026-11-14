// Audit check C4: lossless old-backup import and C4-1 iOS install banner copy.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installMockCloud } from "../scripts/browser-check/lib/mockCloud.mjs";
import { dismissWelcomeModal } from "../scripts/browser-check/lib/actions.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "test/fixtures/old-app-backup-v1.json");
const fixtureRaw = readFileSync(fixturePath, "utf8");
const fixture = JSON.parse(fixtureRaw);

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const EXPECTED = {
  entries: fixture.entries.length,
  customMovements: fixture.customMovements.length,
  customWods: fixture.customWods.length,
  bodyweight: fixture.bodyweightEntries.length,
};

test("importing old-app-backup-v1.json restores entity counts", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "backup import entity counts checked in Chromium");
  await installMockCloud(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForSelector("#app", { state: "visible", timeout: 30_000 });
  await dismissWelcomeModal(page);

  const importPromise = page.evaluate((json) => {
    const file = new File([json], "box-log-backup.json", { type: "application/json" });
    return window.importDataFromFile(file);
  }, fixtureRaw);

  await page.waitForSelector("#appConfirmOverlay[data-confirm-kind='import-backup']", { timeout: 15_000 });
  await page.click("#appConfirmOverlay [data-action='app-confirm-yes']");
  await importPromise;

  const counts = await page.evaluate(async () => {
    await window.reloadFromDb();
    const entries = window.allMovements().flatMap((m) => window.entriesFor(m.id));
    const customMovements = window.allMovements().filter((m) => String(m.id).startsWith("custom-"));
    const customWods = window.allWods().filter((w) => String(w.id).startsWith("customwod-"));
    const bodyweight = await window.dbLoadBodyweight();
    return {
      entries: entries.length,
      customMovements: customMovements.length,
      customWods: customWods.length,
      bodyweight: bodyweight.length,
    };
  });

  expect(counts.entries).toBe(EXPECTED.entries);
  expect(counts.customMovements).toBe(EXPECTED.customMovements);
  expect(counts.customWods).toBe(EXPECTED.customWods);
  expect(counts.bodyweight).toBe(EXPECTED.bodyweight);
});

test.describe("C4-1 iOS install banner", () => {
  test("banner HTML offers transfer and backup, not the old deletion warning", async ({ browser, browserName }) => {
    test.skip(browserName !== "webkit", "C4-1 install banner copy is checked in WebKit");

    const context = await browser.newContext({
      userAgent: IPHONE_UA,
      viewport: { width: 390, height: 844 },
      locale: "he-IL",
    });
    const page = await context.newPage();
    await installMockCloud(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });

    const bannerHtml = await page.locator("#iosInstallBanner").innerHTML();
    expect(bannerHtml).toMatch(/open-transfer-create|העבר לאפליקציה/);
    expect(bannerHtml).toMatch(/ios-install-backup|גיבוי/);
    expect(bannerHtml).not.toMatch(/כדי שהנתונים לא יימחקו/);
    await context.close();
  });
});
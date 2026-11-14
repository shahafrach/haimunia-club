// C5-1: offline shell and service-worker update behaviour (Playwright).
// Serves a local, version-stamped copy of the app and simulates Cloudflare's
// /index.html → / redirect during precache.
import { test, expect } from "@playwright/test";
import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installMockCloud } from "../scripts/browser-check/lib/mockCloud.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const swPath = path.join(repoRoot, "sw.js");
const appPath = path.join(repoRoot, "app.js");
const origSw = readFileSync(swPath, "utf8");
const origApp = readFileSync(appPath, "utf8");

const MARKER_KEY = "haimunia:c5-audit-marker";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

function setVersions(version) {
  writeFileSync(swPath, origSw.replace(/const SW_VERSION = "[^"]+";/, `const SW_VERSION = "${version}";`));
  writeFileSync(appPath, origApp.replace(/const APP_VERSION = "[^"]+";/, `const APP_VERSION = "${version}";`));
}

function restoreSources() {
  writeFileSync(swPath, origSw);
  writeFileSync(appPath, origApp);
}

function startStaticServer(root, { redirectIndexHtml = false } = {}) {
  const resolvedRoot = path.resolve(root);
  const server = http.createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent(req.url.split("?")[0]);
      if (redirectIndexHtml && urlPath === "/index.html") {
        res.writeHead(308, { Location: "/" });
        res.end();
        return;
      }
      if (urlPath === "/") urlPath = "/index.html";
      const filePath = path.join(resolvedRoot, urlPath);
      if (!filePath.startsWith(resolvedRoot)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const st = await stat(filePath);
      if (st.isDirectory()) {
        res.writeHead(404);
        res.end();
        return;
      }
      const ext = path.extname(filePath);
      const body = await readFile(filePath);
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function waitForControllerActive(page) {
  await page.waitForFunction(
    () => navigator.serviceWorker.controller && navigator.serviceWorker.controller.state === "activated",
    { timeout: 30_000 }
  );
}

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
  restoreSources();
});

test("offline reload after service worker is ready", async ({ page, context }) => {
  setVersions("3.8.0");
  const server = await startStaticServer(repoRoot);
  try {
    await installMockCloud(page);
    await page.goto(server.url, { waitUntil: "networkidle" });
    await page.waitForSelector("#app", { state: "visible", timeout: 20_000 });
    await waitForControllerActive(page);
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#app")).toBeVisible();
    const offlineBody = await page.evaluate(() => document.body?.innerText?.length > 0);
    expect(offlineBody).toBe(true);
  } finally {
    await server.close();
  }
});

test("SW update 3.7.2 to 3.8.0 keeps a localStorage marker", async ({ page }) => {
  setVersions("3.7.2");
  const server = await startStaticServer(repoRoot, { redirectIndexHtml: true });
  try {
    await installMockCloud(page);
    await page.goto(server.url, { waitUntil: "networkidle" });
    await waitForControllerActive(page);
    await page.evaluate(
      ([key, val]) => {
        localStorage.setItem(key, val);
      },
      [MARKER_KEY, "keep-me"]
    );
    setVersions("3.8.0");
    const sawReload = page.waitForEvent("load", { timeout: 30_000 }).then(() => true).catch(() => false);
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg.update();
    });
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      const reg = navigator.serviceWorker.controller;
      if (reg) reg.postMessage({ type: "SKIP_WAITING" });
    });
    await sawReload;
    const marker = await page.evaluate((key) => localStorage.getItem(key), MARKER_KEY);
    expect(marker).toBe("keep-me");
    const swVer = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL);
    expect(swVer).toBeTruthy();
  } finally {
    await server.close();
    restoreSources();
  }
});

test("precached index.html and navigate responses are not redirected", async ({ page }) => {
  setVersions("3.8.0");
  const server = await startStaticServer(repoRoot, { redirectIndexHtml: true });
  try {
    await installMockCloud(page);
    await page.goto(server.url, { waitUntil: "networkidle" });
    await waitForControllerActive(page);
    const cacheInfo = await page.evaluate(async () => {
      const ver = "3.8.0";
      const cache = await caches.open(`haimunia-v${ver}`);
      const origin = location.origin;
      const indexUrl = new URL("./index.html", `${origin}/`).href;
      const rootUrl = new URL("./", `${origin}/`).href;
      const indexRes = await cache.match(indexUrl);
      const rootRes = await cache.match(rootUrl);
      return {
        index: indexRes
          ? { redirected: indexRes.redirected, status: indexRes.status, type: indexRes.type }
          : null,
        root: rootRes ? { redirected: rootRes.redirected, status: rootRes.status, type: rootRes.type } : null,
      };
    });
    expect(cacheInfo.index).toBeTruthy();
    expect(cacheInfo.index.redirected).toBe(false);
    expect(cacheInfo.root).toBeTruthy();
    expect(cacheInfo.root.redirected).toBe(false);

    await page.context().setOffline(true);
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#app")).toBeVisible();
    const navRedirected = await page.evaluate(async () => {
      const res = await fetch(location.href, { redirect: "manual" });
      return res.redirected;
    });
    expect(navRedirected).toBe(false);
  } finally {
    await server.close();
  }
});
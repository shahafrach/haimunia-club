// F-001 (FINDINGS.md): an iPhone's home-screen app has storage apart from Safari's, so a member who
// logged in a Safari tab and then installed found an empty app. The fix, in the plan's order:
//   3b  a transfer code can be created HERE (src/transfer.js createCode), ported from the old app,
//       and a code made by the old app's own functions still redeems in the installed app;
//   1   the iOS install banner shows on the first visit and says: move the data first, then install;
//   2   the installed app's first launch with an empty log offers the import before anything else.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootApp } from "./helpers/boot.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backup = JSON.parse(readFileSync(path.join(root, "test/fixtures/old-app-backup-v1.json"), "utf8"));
// Frozen output of the old app's own transfer functions (see the file's _comment).
const oldVector = JSON.parse(readFileSync(path.join(root, "test/fixtures/old-app-transfer-v1.json"), "utf8"));
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label) { for (let i = 0; i < 300; i++) { if (await fn()) return; await wait(10); } assert.fail("timed out: " + label); }
const $ = (w, s) => w.document.querySelector(s);
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** A fake transfer-put / transfer-take pair with the server's rules: one take, then gone. */
function makeServer() {
  const blobs = new Map();
  const puts = [], takes = [];
  return {
    blobs, puts, takes,
    handle(url, init) {
      const body = JSON.parse(init.body);
      if (url.endsWith("/functions/v1/transfer-put")) {
        puts.push({ url, init, body });
        blobs.set(body.lookup, { iv: body.iv, ciphertext: body.ciphertext });
        return { ok: true, status: 200, json: async () => ({ status: "stored" }) };
      }
      takes.push({ url, init, body });
      const row = blobs.get(body.lookup);
      blobs.delete(body.lookup);
      return row ? { ok: true, status: 200, json: async () => row } : { ok: false, status: 404, json: async () => ({ error: "not_found" }) };
    },
  };
}

async function boot({ installed = false, iphone = false, server = makeServer(), localStorage } = {}) {
  const window = await bootApp({
    localStorage,
    matchMedia: (q) => (installed && /display-mode:\s*standalone/.test(q)),
    beforeScripts: (w) => {
      for (const k of ["DecompressionStream", "CompressionStream", "Blob", "Response", "TextEncoder", "TextDecoder", "AbortController", "atob", "btoa"]) w[k] = globalThis[k];
      w.scrollTo = () => {};
      if (iphone) Object.defineProperty(w.navigator, "userAgent", { value: IPHONE_UA, configurable: true });
      w.fetch = async (url, init) => {
        const u = String(url);
        if (!/\/functions\/v1\/transfer-(put|take)$/.test(u)) return { ok: true, status: 201, json: async () => ({}) }; // usage count
        return server.handle(u, init);
      };
    },
  });
  window.localStorage.setItem("haimunia:usageCountingOff", "1");
  return { window, server };
}
async function enterCode(window, text) {
  $(window, "#transferCode").value = text;
  $(window, "#transferCode").dispatchEvent(new window.Event("input", { bubbles: true }));
  $(window, "[data-transfer-form]").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
}

// ---- 3b: transfer codes --------------------------------------------------------------

test("a code made by the old app's own functions redeems in the new installed app, body weight and settings included", async () => {
  const server = makeServer();
  server.blobs.set(oldVector.put.lookup, { iv: oldVector.put.iv, ciphertext: oldVector.put.ciphertext });
  const { window } = await boot({ installed: true, server });
  window.haimuniaTransfer.open();
  await enterCode(window, oldVector.code);
  await until(() => /הלוג עבר/.test($(window, "#transferBody").textContent), "imported");
  assert.equal(server.takes.length, 1);
  assert.deepEqual(server.takes[0].body, { lookup: oldVector.lookup }, "the new app derives the old app's lookup from the old app's code");
  assert.equal((await window.dbLoadAll()).length, backup.entries.length, "every entry came across");
  assert.ok((await window.dbLoadBodyweight()).some((b) => b.weight === 77.2 && b.date === "2026-11-02"));
  assert.equal(await window.dbGetSetting("haimunia:userName"), "דנה");
  assert.equal(await window.dbGetSetting("haimunia:barWeight"), 15);
});

test("a code created in the Safari tab redeems in the installed app; only ciphertext, the lookup and a random device id go out", async () => {
  const server = makeServer();
  const tab = (await boot({ installed: false, iphone: true, server })).window;
  assert.equal(await tab.importBackupData(Object.assign({}, backup, { bodyweightEntries: [{ id: "bw-s1", date: "2026-11-03", weight: 70.5, ts: 1793200000000 }] })), true);
  tab.haimuniaTransfer.open("create");
  assert.match($(tab, "#transferTitle").textContent, /יצירת קוד העברה/);
  assert.match($(tab, "#transferBody").textContent, /24 שעות/);
  $(tab, "[data-transfer='create']").click();
  await until(() => $(tab, "#transferNewCode"), "code shown");
  const code = $(tab, "#transferNewCode").textContent.trim();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}-[0-9A-HJKMNP-TV-Z]{5}$/);
  assert.match($(tab, "#transferBody").textContent, /פעם אחת ול-24 שעות/);
  assert.equal(server.puts.length, 1);
  const put = server.puts[0];
  assert.deepEqual(Object.keys(put.body).sort(), ["ciphertext", "device", "iv", "lookup"]);
  assert.match(put.body.lookup, /^[0-9a-f]{64}$/);
  assert.match(put.body.device, /^[A-Za-z0-9-]{16,64}$/, "the shape transfer-put accepts");
  assert.equal(put.body.device, tab.localStorage.getItem("haimunia:transferDeviceId"), "kept in localStorage");
  assert.notEqual(put.body.device, tab.localStorage.getItem("haimunia:usageDeviceId"), "not the usage-count id");
  assert.equal(put.init.credentials, "omit");
  assert.equal(put.init.headers.apikey, tab.HAIMUNIA_CONFIG.cloud.supabasePublishableKey);
  const wire = JSON.stringify(put.body) + JSON.stringify(put.init.headers);
  for (const leak of [code.replace(/-/g, ""), "bodyweightEntries", "70.5", "entries"]) assert.ok(!wire.includes(leak), `no ${leak} on the wire`);
  // Closing drops the shown code; reopening starts at the create button. A second code reuses the device id.
  $(tab, "[data-transfer='close']").click();
  tab.haimuniaTransfer.open("create");
  assert.equal($(tab, "#transferNewCode"), null);
  $(tab, "[data-transfer='create']").click();
  await until(() => $(tab, "#transferNewCode"), "second code shown");
  assert.equal(server.puts.length, 2);
  assert.equal(server.puts[1].body.device, put.body.device, "the same phone sends the same device id");
  $(tab, "[data-transfer='close']").click();

  const home = (await boot({ installed: true, server })).window;
  home.haimuniaTransfer.open();
  await enterCode(home, code.toLowerCase());
  await until(() => /הלוג עבר/.test($(home, "#transferBody").textContent), "imported in the installed app");
  assert.equal((await home.dbLoadAll()).length, backup.entries.length);
  assert.ok((await home.dbLoadBodyweight()).some((b) => b.weight === 70.5));
  assert.equal(server.blobs.size, 1, "single use: the taken blob is gone, only the second code's remains");
});

test("creating a code with nothing logged says so and sends nothing; a server limit shows the old app's message", async () => {
  const server = makeServer();
  const { window } = await boot({ server });
  window.haimuniaTransfer.open("create");
  $(window, "[data-transfer='create']").click();
  await until(() => $(window, "#transferBody [role='alert']"), "empty message");
  assert.match($(window, "#transferBody").textContent, /אין עדיין רישומים להעביר/);
  assert.equal(server.puts.length, 0);

  await window.importBackupData(backup);
  server.handle = () => ({ ok: false, status: 429, json: async () => ({ error: "rate_limited" }) });
  window.haimuniaTransfer.open("create");
  $(window, "[data-transfer='create']").click();
  await until(() => $(window, "#transferBody [role='alert']"), "rate limit message");
  assert.match($(window, "#transferBody").textContent, /יותר מדי קודים/);
  assert.equal($(window, "#transferNewCode"), null);
});

test("the create path reuses the protocol: same alphabet, AAD and HKDF labels, put to transfer-put", () => {
  const src = readFileSync(path.join(root, "src/transfer.js"), "utf8");
  assert.match(src, /var MAX_CIPHERTEXT = 1024 \* 1024;/, "the client refuses what the server would refuse (1 MiB)");
  for (const s of ['"0123456789ABCDEFGHJKMNPQRSTVWXYZ"', '"haimunia-transfer:v1"', '"haimunia-transfer:lookup:v1"', '"haimunia-transfer:key:v1"', '"/functions/v1/transfer-put"', 'new CompressionStream("gzip")']) {
    assert.ok(src.includes(s), `src/transfer.js uses ${s}`);
  }
});

// ---- 1: the iOS install banner --------------------------------------------------------

test("the iOS banner shows on the first visit with nothing logged, and says to move the data before installing", async () => {
  const { window } = await boot({ iphone: true });
  const banner = $(window, "#iosInstallBanner");
  assert.equal(banner.style.display, "block", "shown before the first entry, on the first day");
  const text = banner.textContent;
  assert.doesNotMatch(text, /כדי שהנתונים לא יימחקו/);
  assert.match(text, /נפתחת ריקה עד שמייבאים/);
  assert.match(text, /1\. קודם מגבים[\s\S]*2\. מוסיפים למסך הבית/, "the two steps, in order");
  // Step one: a transfer code, or the existing backup export.
  $(window, "#iosInstallBanner [data-action='open-transfer-create']").click();
  assert.ok(window.haimuniaTransfer.isOpen());
  assert.ok($(window, "[data-transfer='create']"), "the create screen, not the code field");
  window.haimuniaTransfer.close();
  const saved = [];
  window.downloadBackup = (payload, name) => { saved.push([payload, name]); return true; };
  $(window, "#iosInstallBanner [data-action='ios-install-backup']").click();
  await until(() => saved.length === 1, "backup exported");
  assert.match(saved[0][1], /^box-log-backup-/);
});

test("the iOS banner stays hidden in the installed app, off iOS, and once dismissed", async () => {
  assert.equal($((await boot({ iphone: true, installed: true })).window, "#iosInstallBanner").style.display, "none");
  assert.equal($((await boot({ iphone: false })).window, "#iosInstallBanner").style.display, "none");
  assert.equal($((await boot({ iphone: true, localStorage: { "haimunia:iosInstallDismissed": "1" } })).window, "#iosInstallBanner").style.display, "none");
});

// ---- 2: the installed app's first launch ----------------------------------------------

test("installed, empty log: the import is offered before the welcome sheet, with a code or a file", async () => {
  const { window } = await boot({ installed: true });
  assert.ok($(window, "#firstImportOverlay").classList.contains("open"));
  assert.ok(!$(window, "#welcomeOverlay").classList.contains("open"), "the welcome sheet waits");
  $(window, "[data-action='first-import-code']").click();
  assert.ok(!$(window, "#firstImportOverlay").classList.contains("open"));
  assert.ok($(window, "#transferCode"), "the code field of the existing transfer screen");
  window.haimuniaTransfer.close();

  const second = (await boot({ installed: true })).window;
  let picked = 0;
  second.HTMLInputElement.prototype.click = function () { if (this.type === "file") picked++; };
  $(second, "[data-action='first-import-file']").click();
  assert.equal(picked, 1, "the existing backup import opens its file picker");
  assert.ok(!$(second, "#firstImportOverlay").classList.contains("open"));
});

test("'start fresh' opens the welcome sheet and is not asked again; a log or a browser tab never sees the offer", async () => {
  const { window } = await boot({ installed: true });
  $(window, "[data-action='first-import-fresh']").click();
  assert.ok($(window, "#welcomeOverlay").classList.contains("open"));
  assert.equal(window.localStorage.getItem("haimunia:firstImportAnswered"), "1");
  const again = (await boot({ installed: true, localStorage: { "haimunia:firstImportAnswered": "1" } })).window;
  assert.ok(!$(again, "#firstImportOverlay").classList.contains("open"));
  assert.ok($(again, "#welcomeOverlay").classList.contains("open"));

  const tab = (await boot({ installed: false })).window;
  assert.ok(!$(tab, "#firstImportOverlay").classList.contains("open"));

  const withLog = (await boot({ installed: true })).window;
  await withLog.importBackupData(backup);
  assert.equal(withLog.maybeOfferFirstImport(), false, "a device with entries is not offered the import");
});

// CONNECTED MODE, PHASE 3: the transfer code. The old app encrypts a backup (body weight included) on
// the phone; this app takes the ciphertext once, decrypts it on THIS phone and merges it through the
// same import as a backup file. The protocol is the one in haimunia-app-demo
// (docs/club/research.md D, test/transfer-edge-functions.test.mjs); the client side below mirrors it
// independently, so a drift in src/transfer.js shows up here.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootApp } from "./helpers/boot.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = JSON.parse(readFileSync(path.join(root, "test/fixtures/old-app-backup-v1.json"), "utf8"));
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label) { for (let i = 0; i < 200; i++) { if (await fn()) return; await wait(10); } assert.fail("timed out: " + label); }

const ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function encodeCode(bytes) { // Crockford base32, MSB first, no padding: 13 bytes -> 21 characters
  let bits = "", out = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  bits = bits.padEnd(105, "0");
  for (let i = 0; i < 105; i += 5) out += ALPHA[parseInt(bits.slice(i, i + 5), 2)];
  return [out.slice(0, 4), out.slice(4, 8), out.slice(8, 12), out.slice(12, 16), out.slice(16)].join("-");
}
const AAD = new TextEncoder().encode("haimunia-transfer:v1");
async function derive(code) {
  const base = await crypto.subtle.importKey("raw", code, "HKDF", false, ["deriveBits", "deriveKey"]);
  const salt = new Uint8Array(0);
  const lookup = Buffer.from(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode("haimunia-transfer:lookup:v1") }, base, 256)).toString("hex");
  const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode("haimunia-transfer:key:v1") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  return { lookup, key };
}
async function makeTransfer(backup) {
  const code = crypto.getRandomValues(new Uint8Array(13));
  const { lookup, key } = await derive(code);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, gzipSync(Buffer.from(JSON.stringify(backup)))));
  return { text: encodeCode(code), lookup, response: { iv: Buffer.from(iv).toString("base64"), ciphertext: Buffer.from(ct).toString("base64") } };
}

const withWeight = {
  ...fixture,
  bodyweightEntries: [{ id: "bw-t1", date: "2026-11-01", weight: 81.4, ts: 1793000000000 }],
  prefs: { userName: "דנה", boxStartDate: "2025-01-05", barWeight: 15, pctIncrement: 1, wodRxDefault: "plus", theme: "light", textScale: "large" },
};

async function boot({ installed = true, server, confirm = true, seed } = {}) {
  const requests = [];
  const window = await bootApp({
    matchMedia: (q) => (installed && /display-mode:\s*standalone/.test(q)),
    beforeScripts: (w) => {
      w.DecompressionStream = globalThis.DecompressionStream; w.Blob = globalThis.Blob; w.Response = globalThis.Response;
      w.TextEncoder = globalThis.TextEncoder; w.TextDecoder = globalThis.TextDecoder; w.AbortController = globalThis.AbortController;
      w.atob = globalThis.atob;
      w.scrollTo = () => {};
      w.confirm = () => (typeof confirm === "function" ? confirm() : confirm);
      w.fetch = async (url, init) => {
        requests.push({ url: String(url), init });
        if (!String(url).endsWith("/functions/v1/transfer-take")) return { ok: true, status: 201, json: async () => ({}) }; // the usage count
        return server(JSON.parse(init.body));
      };
    },
  });
  window.localStorage.setItem("haimunia:usageCountingOff", "1");
  return { window, requests };
}
const $ = (w, s) => w.document.querySelector(s);
const takes = (reqs) => reqs.filter((r) => r.url.endsWith("/transfer-take"));
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fail = (status) => ({ ok: false, status, json: async () => ({ error: "x" }) });
async function enter(window, text) {
  $(window, "#transferCode").value = text;
  $(window, "#transferCode").dispatchEvent(new window.Event("input", { bubbles: true }));
  $(window, "[data-transfer-form]").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
}

test("the typed code decodes tolerantly: case, spaces, dashes and look-alike letters", async () => {
  const { window } = await boot({ server: () => fail(404) });
  const bytes = crypto.getRandomValues(new Uint8Array(13));
  const t = encodeCode(bytes);
  const T = window.haimuniaTransfer;
  assert.deepEqual([...T.decodeCode(t)], [...bytes]);
  assert.deepEqual([...T.decodeCode(t.toLowerCase().replace(/-/g, " "))], [...bytes]);
  assert.deepEqual([...T.decodeCode(t.replace(/0/g, "o").replace(/1/g, "l"))], [...bytes]);
  assert.equal(T.decodeCode(t.slice(0, -1)), null);
  assert.equal(T.decodeCode(t.replace(/^./, "U")), null, "U is not in the alphabet");
  assert.equal(T.groupCode("abcd efgh"), "ABCD-EFGH");
});

test("in a browser tab the dialog says install first and offers no code field, so nothing is fetched", async () => {
  const { window, requests } = await boot({ installed: false, server: () => fail(404) });
  window.haimuniaTransfer.open();
  assert.equal($(window, "#transferCode"), null);
  assert.match($(window, "#transferBody").textContent, /קודם מתקינים/);
  assert.equal(takes(requests).length, 0);
});

test("a round trip: one request carrying only the lookup, then the log, body weight and device settings are merged", async () => {
  const tr = await makeTransfer(withWeight);
  let calls = 0;
  const { window, requests } = await boot({ server: (body) => { calls++; return body.lookup === tr.lookup ? ok(tr.response) : fail(404); } });
  window.haimuniaTransfer.open();
  await enter(window, tr.text);
  await until(() => /הלוג עבר/.test($(window, "#transferBody").textContent), "done");
  // The wire: exactly one POST to transfer-take, with the lookup and nothing else; never the code or the key.
  const sent = takes(requests);
  assert.equal(sent.length, 1);
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(sent[0].init.body), { lookup: tr.lookup });
  assert.doesNotMatch(sent[0].init.body + JSON.stringify(sent[0].init.headers), new RegExp(tr.text.replace(/-/g, "")));
  assert.equal(sent[0].init.credentials, "omit");
  // The data: records, with body weight, in IndexedDB.
  const bw = await window.dbLoadBodyweight();
  assert.equal(bw.length, 1);
  assert.ok(bw.some((b) => b.weight === 81.4 && b.date === "2026-11-01"), "body weight came across");
  assert.equal((await window.dbLoadAll()).length, fixture.entries.length);
  // Device settings on a fresh device.
  assert.match($(window, "#userGreeting").textContent, /דנה/);
  assert.equal(await window.dbGetSetting("haimunia:userName"), "דנה");
  assert.equal(await window.dbGetSetting("haimunia:barWeight"), 15);
  assert.equal(await window.dbGetSetting("haimunia:pctIncrement"), 1);
  assert.equal(await window.dbGetSetting("haimunia:wodRxDefault"), "plus");
  assert.equal(window.localStorage.getItem("haimunia:theme"), "light");
  assert.equal(window.localStorage.getItem("haimunia:textScale"), "large");
});

test("a device that already has data keeps its own settings and name; only the records are added", async () => {
  const tr = await makeTransfer(withWeight);
  const { window } = await boot({ server: () => ok(tr.response) });
  window.saveUserName("אורית");
  await window.dbPutBodyweight({ id: "bw-mine", date: "2026-10-01", weight: 70, ts: 1790000000000 });
  await window.reloadFromDb();
  window.setThemePref("dark");
  window.haimuniaTransfer.open();
  await enter(window, tr.text);
  await until(() => /הלוג עבר/.test($(window, "#transferBody").textContent), "done");
  assert.equal(await window.dbGetSetting("haimunia:userName"), "אורית");
  assert.equal(window.localStorage.getItem("haimunia:theme"), "dark");
  assert.equal(await window.dbGetSetting("haimunia:barWeight"), undefined);
  const bw = await window.dbLoadBodyweight();
  assert.ok(bw.some((b) => b.id === "bw-mine"), "their own weight is still there");
  assert.ok(bw.some((b) => b.weight === 81.4), "and the transferred one was added");
});

test("a code that was used or expired says so and changes nothing; a malformed one never reaches the network", async () => {
  const tr = await makeTransfer(withWeight);
  const { window, requests } = await boot({ server: () => fail(404) });
  window.haimuniaTransfer.open();
  await enter(window, "ABCD-EFGH");
  assert.match($(window, "#transferBody").textContent, /21 תווים/);
  assert.equal(takes(requests).length, 0);
  await enter(window, tr.text);
  await until(() => /הקוד לא נמצא/.test($(window, "#transferBody").textContent), "not found");
  assert.equal((await window.dbLoadAll()).length, 0);
  assert.equal((await window.dbLoadBodyweight()).length, 0);
});

test("a rate limit and a dead network are reported as such, and the typed code stays in the field", async () => {
  const tr = await makeTransfer(withWeight);
  let mode = 429;
  const { window } = await boot({ server: () => { if (mode === "net") throw new Error("offline"); return fail(mode); } });
  window.haimuniaTransfer.open();
  await enter(window, tr.text);
  await until(() => /יותר מדי ניסיונות/.test($(window, "#transferBody").textContent), "429");
  assert.equal($(window, "#transferCode").value, tr.text);
  mode = "net";
  await enter(window, tr.text);
  await until(() => /אין חיבור/.test($(window, "#transferBody").textContent), "network");
});

test("ciphertext that does not decrypt (wrong key or tampered) is refused and nothing is written", async () => {
  const tr = await makeTransfer(withWeight);
  const bad = Buffer.from(tr.response.ciphertext, "base64"); bad[bad.length - 1] ^= 1;
  const { window } = await boot({ server: () => ok({ iv: tr.response.iv, ciphertext: bad.toString("base64") }) });
  window.haimuniaTransfer.open();
  await enter(window, tr.text);
  await until(() => /לא הצלחנו לפענח/.test($(window, "#transferBody").textContent), "decrypt");
  assert.equal((await window.dbLoadBodyweight()).length, 0);
});

test("declining the import after the code is spent keeps the data in memory: retry, or save it as a file", async () => {
  const tr = await makeTransfer(withWeight);
  let answer = false;
  const { window, requests } = await boot({ confirm: () => answer, server: () => ok(tr.response) });
  const saved = [];
  window.downloadBackup = (payload, name) => { saved.push([payload, name]); return true; };
  window.haimuniaTransfer.open();
  await enter(window, tr.text);
  await until(() => $(window, "[data-transfer='retry']"), "keep view");
  assert.equal((await window.dbLoadBodyweight()).length, 0, "nothing written yet");
  $(window, "[data-transfer='file']").click();
  assert.equal(saved.length, 1);
  assert.equal(saved[0][0].bodyweightEntries[0].weight, 81.4);
  assert.equal(saved[0][0].prefs, undefined, "the file is a plain backup");
  answer = true;
  $(window, "[data-transfer='retry']").click();
  await until(() => /הלוג עבר/.test($(window, "#transferBody").textContent), "imported on retry");
  assert.equal(takes(requests).length, 1, "the retry did not ask the server again");
  assert.ok((await window.dbLoadBodyweight()).some((b) => b.weight === 81.4));
});

test("closing the dialog drops the decrypted data; the source holds no storage of the payload", async () => {
  const src = readFileSync(path.join(root, "src/transfer.js"), "utf8");
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|dbSetSetting|dbPut/);
  const tr = await makeTransfer(withWeight);
  const { window } = await boot({ confirm: false, server: () => ok(tr.response) });
  window.haimuniaTransfer.open();
  await enter(window, tr.text);
  await until(() => $(window, "[data-transfer='retry']"), "keep view");
  $(window, "[data-transfer='close']").click();
  window.haimuniaTransfer.open();
  assert.ok($(window, "#transferCode"), "reopening starts clean");
  assert.equal((await window.dbLoadBodyweight()).length, 0);
});

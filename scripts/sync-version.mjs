#!/usr/bin/env node
// Single source of truth for the app version: APP_VERSION in app.js.
// This script reads it and writes the same value into SW_VERSION in sw.js,
// so a bump only ever happens in one place. Run `node scripts/sync-version.mjs`
// after bumping APP_VERSION, or `node scripts/sync-version.mjs --check` (used
// by the test suite) to fail without writing if the two have drifted apart.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appJsPath = path.join(root, "app.js");
const swJsPath = path.join(root, "sw.js");

export function readAppVersion(src) {
  const m = src.match(/const APP_VERSION = "([^"]+)";/);
  if (!m) throw new Error("APP_VERSION not found in app.js");
  return m[1];
}

export function readSwVersion(src) {
  const m = src.match(/const SW_VERSION = "([^"]+)";/);
  if (!m) throw new Error("SW_VERSION not found in sw.js");
  return m[1];
}

export function withSwVersion(src, version) {
  return src.replace(/const SW_VERSION = "[^"]+";/, `const SW_VERSION = "${version}";`);
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const appJs = readFileSync(appJsPath, "utf8");
  const swJs = readFileSync(swJsPath, "utf8");
  const appVersion = readAppVersion(appJs);
  const swVersion = readSwVersion(swJs);

  if (appVersion === swVersion) {
    console.log(`OK: APP_VERSION and SW_VERSION both ${appVersion}`);
    return;
  }
  if (checkOnly) {
    console.error(`Mismatch: APP_VERSION=${appVersion} SW_VERSION=${swVersion}. Run "npm run sync-version" to fix.`);
    process.exit(1);
  }
  writeFileSync(swJsPath, withSwVersion(swJs, appVersion));
  console.log(`Synced: SW_VERSION ${swVersion} -> ${appVersion}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main();

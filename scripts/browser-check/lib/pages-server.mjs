// A static server shaped like GitHub Pages, for the upgrade rehearsal.
//
// Two things about Pages matter to an in-place upgrade and are reproduced:
//   * the site lives under a path, /haimunia-app/, not at the origin root, so
//     the service worker's scope is the path and every URL is relative;
//   * every response carries Cache-Control: max-age=600 and an ETag, so the
//     browser's HTTP cache holds the OLD files for ten minutes after a deploy.
//     An upgrade that only works with a cold HTTP cache would pass on a laptop
//     and fail on a phone that opened the app a minute before the deploy.
//
// setRoot() swaps the directory being served, which is what a deploy is.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".woff2": "font/woff2",
  ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
};

export function startPagesServer(initialRoot, prefix = "/haimunia-app/") {
  let root = path.resolve(initialRoot);
  const log = [];
  const server = http.createServer(async (req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    log.push(urlPath);
    if (!urlPath.startsWith(prefix)) { res.writeHead(404); res.end(); return; }
    let rel = urlPath.slice(prefix.length) || "index.html";
    const filePath = path.join(root, rel);
    if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
    try {
      const st = await stat(filePath);
      if (st.isDirectory()) { res.writeHead(404); res.end(); return; }
      const body = await readFile(filePath);
      const etag = `"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`;
      const headers = { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "max-age=600", ETag: etag };
      if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers); res.end(); return; }
      res.writeHead(200, headers);
      res.end(body);
    } catch (e) {
      res.writeHead(404); res.end("Not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}${prefix}`,
        setRoot: (dir) => { root = path.resolve(dir); },
        log,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

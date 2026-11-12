// Minimal static file server for local browser-check runs. No caching, no
// directory listing — just enough to serve the app exactly like GitHub
// Pages does for the paths this app actually requests.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

export function startStaticServer(root) {
  const resolvedRoot = path.resolve(root);
  const server = http.createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent(req.url.split("?")[0]);
      if (urlPath === "/") urlPath = "/index.html";
      const filePath = path.join(resolvedRoot, urlPath);
      if (!filePath.startsWith(resolvedRoot)) { res.writeHead(403); res.end(); return; }
      const st = await stat(filePath);
      if (st.isDirectory()) { res.writeHead(404); res.end(); return; }
      const ext = path.extname(filePath);
      const body = await readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(body);
    } catch (e) {
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

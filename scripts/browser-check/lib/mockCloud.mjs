// This edition has no cloud, so there is nothing to mock. The name is kept so
// the checks carried over from the community edition read the same, but the
// job is inverted: the page may reach its own origin and ONE other endpoint -
// the anonymous usage count (src/usage.js), answered here with the 201 the
// real one gives and recorded in page.__usageCalls - and every other request
// that leaves the origin is ABORTED and recorded in page.__foreignRequests,
// so each check also proves the app talks to nothing else.
//
// No-op defaults keep the community edition's call shapes valid
// (installMockCloud(page, seedTables, opts), withMock(page, fn, arg)).
export async function installMockCloud(page) {
  page.__foreignRequests = [];
  page.__usageCalls = [];
  await page.route("**/*", (route) => {
    const req = route.request();
    const url = req.url();
    let u = null;
    try { u = new URL(url); } catch (e) { u = null; }
    if (u && (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.protocol === "data:" || u.protocol === "blob:")) return route.continue();
    if (u && u.pathname === "/rest/v1/training_log_usage") {
      if (req.method() === "OPTIONS") {
        return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "apikey, content-type, prefer", "access-control-allow-methods": "POST" } });
      }
      page.__usageCalls.push({ url, body: req.postDataJSON() });
      return route.fulfill({ status: 201, headers: { "access-control-allow-origin": "*" }, body: "" });
    }
    page.__foreignRequests.push(url);
    return route.abort();
  });
}

export async function withMock(page, fn, arg) {
  return page.evaluate(fn, arg);
}

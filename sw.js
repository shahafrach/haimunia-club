// EMERGENCY SERVICE-WORKER KILL SWITCH (OPS-2). Not for normal releases.
// Ship it only when an installed worker leaves members unable to open the app.
// It touches no IndexedDB, localStorage or any member data: only Cache Storage
// and its own registration. Steps: docs/OPS-2-sw-kill.md.
//
// It has no fetch handler, so every request goes straight to the network.
// install: take over at once (the broken worker may leave no page to ask).
// activate: delete every cache, unregister, then reload open clients once.
// The reload carries ?swk=1; a client that already has it is not reloaded
// again, so a page that re-registers a worker cannot cause a reload loop.
const SW_VERSION = "3.7.3";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (err) {}
      try {
        await self.registration.unregister();
      } catch (err) {}
      try {
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        await Promise.all(
          clients.map((c) => {
            const u = new URL(c.url);
            if (u.searchParams.has("swk")) return null;
            u.searchParams.set("swk", "1");
            return c.navigate(u.href).catch(() => {});
          })
        );
      } catch (err) {}
    })()
  );
});

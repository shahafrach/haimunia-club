# Audit standard: finding codes

Every finding in FINDINGS.md carries one code.

| Code | Area |
|------|------|
| SEC  | Security: auth, RLS, CSP and headers, middleware, secrets, abuse limits |
| DATA | Member data on the phone: IndexedDB, backups, imports, transfer, loss or corruption |
| OFF  | Offline and updates: service worker, caching, deploys reaching members |
| A11Y | Accessibility: screen readers, focus, contrast, touch targets |
| RTL  | Hebrew and right-to-left layout, mixed-direction text |
| UX   | Flows, copy, layout and viewport behaviour |
| PERF | Load time, memory, battery |
| PRIV | Privacy: what leaves the device, usage counts, policy accuracy |
| OPS  | Operations: release, rollback, logging, monitoring, audit trail |

Severity: critical (data loss or account takeover now), high (likely member harm), medium, low.
Status: open, fixed, wontfix.

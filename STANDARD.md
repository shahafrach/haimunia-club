# Audit standard

Every finding in FINDINGS.md cites one code from this list.

| Code | Requirement |
|------|-------------|
| SEC-1 | RLS on every table |
| SEC-2 | SECURITY DEFINER with fixed search_path and auth check |
| SEC-3 | Anon grants allowlist |
| SEC-4 | Security headers and CSP |
| SEC-5 | No secrets in repo or build |
| SEC-6 | No high or critical dependency issues |
| SEC-7 | Independent review and threat model |
| DATA-1 | Lossless export and import |
| DATA-2 | Updates never delete local data |
| DATA-3 | Sensitive data encrypted or kept on device |
| OFF-1 | Offline logging and clean sync |
| OFF-2 | Safe service worker updates |
| A11Y-1 | Zero serious axe issues |
| A11Y-2 | Full keyboard use |
| A11Y-3 | 200% text, screen reader, 4.5:1 contrast |
| RTL-1 | Correct direction and Israeli formats |
| UX-1 | Single design token source |
| UX-2 | Every feature behind a toggle |
| PERF-1 | Lighthouse mobile 90+ |
| PRIV-1 | Policy matches collected data |
| OPS-1 | Semantic version and tag per release |
| OPS-2 | Rollback under 5 minutes |
| OPS-3 | In-app feedback and anonymous usage counts |
| ID-1 | Credit line on about screen and README |

Severity: critical (blocks launch), high, medium, low. Status: open, fixed, wontfix.

## Platform decisions

Standing rules for every app built from this standard. A change needs an owner decision recorded here and in FINDINGS.md.

| ID | Decision | Why | Revisit when |
|----|----------|-----|--------------|
| PD-1 | No web push for now. No `PushManager.subscribe`, no push or notificationclick handler in `sw.js`. | WebKit bug 315804 (owner report 2026-11-15): in an iOS 26 installed PWA, an IndexedDB write never completes after a push subscribe. Members' logs live in IndexedDB (DATA-2). | WebKit closes 315804 and a real-iPhone check shows IndexedDB writes completing after a subscribe. |
| PD-2 | Never rely on persistent storage on iOS. `navigator.storage.persist()` may still be requested, but no feature or text assumes it is granted. Installing to the home screen is the only real protection, so the install flow (F-001: banner, transfer code, first-launch import) stays a priority, together with backup reminders. | Safari can evict a site's storage regardless of `persist()`, and the home-screen app's storage is separate from Safari's. | Apple documents persistent storage for home-screen web apps, and a real-iPhone test confirms it. |


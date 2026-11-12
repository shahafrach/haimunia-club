// Resolves what URL a check script should run against.
//   TARGET_URL=https://haimunia-app.pages.dev/ node ladder.mjs
// verifies the live deployed site. With no env var, spins up a throwaway
// local static server over the working tree instead, so uncommitted changes
// can be checked before pushing.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer } from "./server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, "../../../");

export async function resolveTarget() {
  if (process.env.TARGET_URL) {
    return { url: process.env.TARGET_URL, local: false, close: async () => {} };
  }
  const { url, close } = await startStaticServer(projectRoot);
  return { url, local: true, close };
}

// Community scenarios (see lib/mockCloud.mjs) drive the app against an
// in-page mock Supabase client, never the real backend. They must never
// point at TARGET_URL even if a caller has it set for the rest of the
// suite — a deployed site still ships the real vendor/supabase.js and the
// real cloud-config.js, and this repo never runs community writes against
// the live production project from an unattended check. Always the local
// static server, regardless of the environment.
export async function resolveLocalOnlyTarget() {
  const { url, close } = await startStaticServer(projectRoot);
  return { url, local: true, close };
}

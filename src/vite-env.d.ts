/// <reference types="vite/client" />

interface Window {
  /** Set by harness pages and the game when the first frame is ready (screenshot/e2e tooling). */
  __HARNESS_READY__?: boolean;
  __SPLASH_READY__?: boolean;
  /** Optional JSON-serializable info a harness exposes to scripts/shot.mjs. */
  __HARNESS_INFO__?: unknown;
}

// Imported from "vitest/config" (a superset of vite's own) so the "test"
// key below is recognized - see https://vitest.dev/config/
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Accept requests through any host header (e.g. a Cloudflare/ngrok tunnel
    // subdomain), not just localhost. Fine for local dev; don't ship this
    // config as-is behind a public production deploy.
    allowedHosts: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/setupTests.js",
    // @testing-library/jest-dom's setup extends the global `expect`, which
    // only exists when globals are enabled (vitest doesn't inject
    // describe/test/expect by default the way Jest does).
    globals: true,
  },
});

import { defineConfig } from "vite";
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
});

// quiet: true - dotenv 17 added a randomized promotional "tip" line on
// every load (e.g. "injected env (0) from .env // tip: ..."), printed as
// plain, non-JSON stdout. Every other line this service writes is a
// structured JSON event (see services/securityLog.js); one unstructured
// ad line at boot is exactly the kind of noise that breaks grepping
// container logs for real events.
require("dotenv").config({ quiet: true });
const http = require("http");
const app = require("./app");
const { initRealtime } = require("./services/realtimeService");

const PORT = process.env.PORT || 5000;

// Socket.IO needs the raw HTTP server (not just the Express app) so it can
// upgrade connections to WebSockets alongside the normal REST traffic.
const httpServer = http.createServer(app);
initRealtime(httpServer);

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

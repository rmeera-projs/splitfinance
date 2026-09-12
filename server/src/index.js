require("dotenv").config();
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

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const groupRoutes = require("./routes/groupRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const settlementRoutes = require("./routes/settlementRoutes");
const insightsRoutes = require("./routes/insightsRoutes");
const adminRoutes = require("./routes/adminRoutes");
const assistantRoutes = require("./routes/assistantRoutes");
const { errorHandler } = require("./middleware/errorHandler");

const app = express();

// Express sees the connecting socket's address by default, not the
// original client's - in production that's Caddy's own address on every
// request, since it's the one reverse-proxying to this server (see
// terraform/user_data.sh.tpl's Caddyfile). Without this, express-rate-limit
// (see middleware/rateLimit.js) would key every visitor to that one
// address, turning "10 requests per IP" into "10 requests total" for
// everyone behind Caddy. `1` trusts exactly one hop in front of Express -
// correct as long as Caddy is genuinely the only thing between the
// internet and this server, which it is: the security group's direct
// :5000 fallback (terraform/main.tf) is restricted to allowed_ssh_cidr, so
// nobody outside that IP can reach Express directly and forge the header
// this setting starts trusting.
app.set("trust proxy", 1);

// contentSecurityPolicy/crossOriginEmbedderPolicy are for server-rendered
// HTML with inline scripts/embedded resources - this is a pure JSON API (the
// frontend is a separate app, served by Caddy), so both are off rather than
// fighting a CSP that has nothing to actually apply to. Everything else
// helmet sets by default still applies: HSTS, X-Content-Type-Options,
// X-Frame-Options, and turning off the X-Powered-By: Express header.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// credentials: true is what lets the browser send the HttpOnly session
// cookie (utils/authCookie.js) on the frontend's cross-origin calls to this
// API, and it is incompatible with a wildcard origin - the CORS spec
// forbids pairing "*" with credentials, and browsers reject the response
// outright. So the fallback here is a concrete localhost origin rather than
// the "*" this used to allow; production sets CLIENT_URL explicitly.
app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/settlements", settlementRoutes);
app.use("/api/insights", insightsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/assistant", assistantRoutes);

app.use(errorHandler);

module.exports = app;

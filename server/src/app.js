const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const groupRoutes = require("./routes/groupRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const settlementRoutes = require("./routes/settlementRoutes");
const insightsRoutes = require("./routes/insightsRoutes");
const { errorHandler } = require("./middleware/errorHandler");

const app = express();

// contentSecurityPolicy/crossOriginEmbedderPolicy are for server-rendered
// HTML with inline scripts/embedded resources - this is a pure JSON API (the
// frontend is a separate app, served by Caddy), so both are off rather than
// fighting a CSP that has nothing to actually apply to. Everything else
// helmet sets by default still applies: HSTS, X-Content-Type-Options,
// X-Frame-Options, and turning off the X-Powered-By: Express header.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_URL || "*" }));
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/settlements", settlementRoutes);
app.use("/api/insights", insightsRoutes);

app.use(errorHandler);

module.exports = app;

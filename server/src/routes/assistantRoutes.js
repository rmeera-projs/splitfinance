const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { requireVerifiedEmail } = require("../middleware/requireVerifiedEmail");
const { assistantRateLimit } = require("../middleware/rateLimit");
const { ask } = require("../controllers/assistantController");

const router = express.Router();

router.use(requireAuth);
// Gated the same way as the other Cohere-backed endpoints (see
// expenseRoutes.js): a confirmed email address, since signup is free and
// throwaway accounts are the cheap route to metered AI quota.
router.post("/ask", requireVerifiedEmail, assistantRateLimit, ask);

module.exports = router;

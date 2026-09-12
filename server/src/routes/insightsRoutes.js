const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { getMyInsights } = require("../controllers/insightsController");

const router = express.Router();

router.use(requireAuth);
router.get("/", getMyInsights);

module.exports = router;

const express = require("express");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { getStats } = require("../controllers/adminController");

const router = express.Router();

router.use(requireAuth, requireAdmin);
router.get("/stats", getStats);

module.exports = router;

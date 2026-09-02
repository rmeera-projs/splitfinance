const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { createSettlement } = require("../controllers/settlementController");

const router = express.Router();

router.use(requireAuth);
router.post("/", createSettlement);

module.exports = router;

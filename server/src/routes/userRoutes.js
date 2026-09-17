const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { getMe, getMyBalances, updateProfile, changePassword } = require("../controllers/userController");

const router = express.Router();

router.use(requireAuth);
router.get("/me", getMe);
router.get("/me/balances", getMyBalances);
router.patch("/me", updateProfile);
router.patch("/me/password", changePassword);

module.exports = router;

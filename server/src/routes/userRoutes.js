const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { getMe, updateProfile, changePassword } = require("../controllers/userController");

const router = express.Router();

router.use(requireAuth);
router.get("/me", getMe);
router.patch("/me", updateProfile);
router.patch("/me/password", changePassword);

module.exports = router;

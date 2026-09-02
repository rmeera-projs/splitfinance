const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { createGroup, listMyGroups, getGroup } = require("../controllers/groupController");

const router = express.Router();

router.use(requireAuth);
router.post("/", createGroup);
router.get("/", listMyGroups);
router.get("/:id", getGroup);

module.exports = router;

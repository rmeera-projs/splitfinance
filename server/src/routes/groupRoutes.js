const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { createGroup, listMyGroups, getGroup, setFinalized, addMembers } = require("../controllers/groupController");

const router = express.Router();

router.use(requireAuth);
router.post("/", createGroup);
router.get("/", listMyGroups);
router.get("/:id", getGroup);
router.patch("/:id/finalize", setFinalized);
router.post("/:id/members", addMembers);

module.exports = router;

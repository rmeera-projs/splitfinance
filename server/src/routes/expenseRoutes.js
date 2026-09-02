const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { createExpense, deleteExpense } = require("../controllers/expenseController");

const router = express.Router();

router.use(requireAuth);
router.post("/", createExpense);
router.delete("/:id", deleteExpense);

module.exports = router;

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const {
  createExpense,
  updateExpense,
  updateExpenseCategory,
  deleteExpense,
  listCategories,
} = require("../controllers/expenseController");

const router = express.Router();

router.use(requireAuth);
router.get("/categories", listCategories);
router.post("/", createExpense);
router.patch("/:id", updateExpense);
router.patch("/:id/category", updateExpenseCategory);
router.delete("/:id", deleteExpense);

module.exports = router;

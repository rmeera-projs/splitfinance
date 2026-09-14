const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { aiRateLimit } = require("../middleware/rateLimit");
const {
  createExpense,
  updateExpense,
  updateExpenseCategory,
  deleteExpense,
  listCategories,
  parseExpense,
} = require("../controllers/expenseController");

const router = express.Router();

router.use(requireAuth);
router.get("/categories", listCategories);
// Only the endpoints that actually call Cohere get aiRateLimit -
// updateExpenseCategory is a manual correction with no AI call to protect.
router.post("/parse", aiRateLimit, parseExpense);
router.post("/", aiRateLimit, createExpense);
router.patch("/:id", aiRateLimit, updateExpense);
router.patch("/:id/category", updateExpenseCategory);
router.delete("/:id", deleteExpense);

module.exports = router;

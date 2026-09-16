const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { aiRateLimit } = require("../middleware/rateLimit");
const { requireVerifiedEmail } = require("../middleware/requireVerifiedEmail");
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
// The one endpoint whose entire purpose is the AI call, so it is also the
// only one gated on a confirmed email address. Creating and editing
// expenses below stay open to unverified accounts and simply skip their
// auto-categorization instead (see expenseController).
router.post("/parse", requireVerifiedEmail, aiRateLimit, parseExpense);
router.post("/", aiRateLimit, createExpense);
router.patch("/:id", aiRateLimit, updateExpense);
router.patch("/:id/category", updateExpenseCategory);
router.delete("/:id", deleteExpense);

module.exports = router;

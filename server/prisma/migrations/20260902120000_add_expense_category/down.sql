-- Down migration for: add_expense_category
--
-- LOSSY: every category, whether chosen by a person or by Cohere, is
-- discarded. Re-applying the forward migration gives every expense the
-- default of 'Other' again, not what it had before.
ALTER TABLE "expenses" DROP COLUMN "category";

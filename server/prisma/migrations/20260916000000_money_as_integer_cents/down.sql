-- Down migration for: money_as_integer_cents
--
-- Not lossy. Integer cents divided by 100 lands exactly on NUMERIC(10,2):
-- every value that could be stored in cents has an exact two-decimal
-- representation, which is the whole reason the forward migration was
-- safe. 6000 becomes 60.00 and back again with no rounding either way.
--
-- The one real constraint is range. INTEGER tops out at $21,474,836.47 and
-- NUMERIC(10,2) at $99,999,999.99, so the ceiling only goes up here and
-- nothing can fail to fit. The forward migration guards the opposite
-- direction, where it genuinely can.
--
-- The division is written ::NUMERIC / 100 rather than / 100.0 so it stays
-- exact decimal arithmetic rather than going through a float.
ALTER TABLE "expenses"
  ALTER COLUMN "amount" TYPE DECIMAL(10,2) USING ("amount"::NUMERIC / 100);
ALTER TABLE "expense_splits"
  ALTER COLUMN "amount_owed" TYPE DECIMAL(10,2) USING ("amount_owed"::NUMERIC / 100);
ALTER TABLE "settlements"
  ALTER COLUMN "amount" TYPE DECIMAL(10,2) USING ("amount"::NUMERIC / 100);

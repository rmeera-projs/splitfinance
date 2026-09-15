-- Money moves from NUMERIC(10,2) dollars to INTEGER cents: $10.23 becomes
-- 1023. See server/src/utils/money.js for the reasoning.
--
-- The USING clause converts the existing rows rather than discarding them -
-- without it Postgres refuses the type change outright. NUMERIC(10,2) is
-- already exact to the cent, so ROUND is a scale change rather than a lossy
-- rounding; it's spelled out to guard against any stray sub-cent value.
--
-- On the range: INTEGER caps at 2,147,483,647 cents, i.e. $21,474,836.47
-- per row. That is *lower* than what NUMERIC(10,2) could technically hold
-- ($99,999,999.99), so this migration would fail on a row above the cap
-- rather than silently truncate - which is the right failure, but means the
-- check below runs first and reports the offending rows clearly. A
-- bill-splitting app has no business with a twenty-million-dollar line
-- item, and the API now rejects anything above the cap outright
-- (MAX_AMOUNT_CENTS in src/controllers/expenseController.js), so this only
-- ever guards pre-existing data.

DO $$
DECLARE
  bad_count INTEGER;
BEGIN
  SELECT (
    (SELECT COUNT(*) FROM "expenses" WHERE "amount" * 100 > 2147483647)
    + (SELECT COUNT(*) FROM "expense_splits" WHERE "amount_owed" * 100 > 2147483647)
    + (SELECT COUNT(*) FROM "settlements" WHERE "amount" * 100 > 2147483647)
  ) INTO bad_count;

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Cannot convert to integer cents: % row(s) exceed $21,474,836.47. Reduce or remove them first.',
      bad_count;
  END IF;
END $$;

ALTER TABLE "expenses"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount" * 100)::INTEGER;

ALTER TABLE "expense_splits"
  ALTER COLUMN "amount_owed" TYPE INTEGER USING ROUND("amount_owed" * 100)::INTEGER;

ALTER TABLE "settlements"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount" * 100)::INTEGER;

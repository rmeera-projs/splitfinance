-- Down migration for: init
--
-- DESTRUCTIVE. This is the schema itself, so reversing it removes every
-- table and everything in them. It exists for completeness and to keep the
-- down.sql convention exception-free; there is no realistic situation in
-- which running it against production is the right move. Restore from the
-- pre-migration dump instead (see scripts/rollback-migration.sh).
--
-- Dropped children-first; CASCADE is deliberately not used so that an
-- unexpected dependency fails loudly rather than being silently removed.
DROP TABLE IF EXISTS "expense_splits";
DROP TABLE IF EXISTS "settlements";
DROP TABLE IF EXISTS "expenses";
DROP TABLE IF EXISTS "group_members";
DROP TABLE IF EXISTS "groups";
DROP TABLE IF EXISTS "users";

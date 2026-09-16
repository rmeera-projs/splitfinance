-- Down migration for: add_password_reset_tokens
--
-- Safe in practice. Any outstanding reset links stop working, which is a
-- reasonable thing to happen during a rollback and arguably the desired
-- one; nothing else references this table.
DROP TABLE IF EXISTS "password_reset_tokens";

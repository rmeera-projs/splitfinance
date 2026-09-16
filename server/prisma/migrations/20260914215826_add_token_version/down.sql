-- Down migration for: add_token_version
--
-- Signs everybody out: middleware/auth.js compares the version embedded in
-- each JWT against this column, so sessions issued while it existed no
-- longer verify against the older code path either. No lasting data loss.
ALTER TABLE "users" DROP COLUMN "token_version";

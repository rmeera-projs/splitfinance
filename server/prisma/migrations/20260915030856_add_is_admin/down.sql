-- Down migration for: add_is_admin
--
-- LOSSY: which accounts were admins is forgotten, and there is no
-- self-service way to become one again - it has to be set directly in the
-- database. Note down who they were before running this.
ALTER TABLE "users" DROP COLUMN "is_admin";

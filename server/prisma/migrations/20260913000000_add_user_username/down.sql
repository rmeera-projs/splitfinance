-- Down migration for: add_user_username
--
-- LOSSY: usernames are discarded. Note that re-applying the forward
-- migration does NOT restore them - it backfills every account with
-- 'user_<id>', so anyone who had chosen a username loses it permanently.
-- Restore from the pre-migration dump if the usernames matter.
DROP INDEX IF EXISTS "users_username_key";
ALTER TABLE "users" DROP COLUMN "username";

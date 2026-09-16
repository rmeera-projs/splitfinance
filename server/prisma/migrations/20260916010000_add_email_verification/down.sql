-- Down migration for: add_email_verification
--
-- LOSSY only in the sense that who had confirmed their address is
-- forgotten, along with any outstanding confirmation links. Nothing a user
-- created is affected, and re-applying the forward migration backfills
-- every existing account as verified again, so the practical effect of a
-- round trip is that everyone ends up confirmed.
DROP TABLE IF EXISTS "email_verification_tokens";
ALTER TABLE "users" DROP COLUMN "email_verified_at";

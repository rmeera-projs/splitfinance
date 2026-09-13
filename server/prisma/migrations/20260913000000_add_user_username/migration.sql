-- AlterTable: add as nullable first so existing rows don't block the migration
ALTER TABLE "users" ADD COLUMN "username" TEXT;

-- Backfill existing accounts with a unique placeholder derived from their id
-- (they can't collide with each other, and are distinct from any
-- normal-looking username a real signup would pick).
UPDATE "users" SET "username" = 'user_' || id WHERE "username" IS NULL;

-- Now that every row has a value, enforce NOT NULL + uniqueness.
ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

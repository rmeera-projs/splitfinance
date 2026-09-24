-- Down migration for: add_demo_flags
--
-- LOSSY: which users/groups were demo sandboxes is forgotten. Not
-- dangerous on its own (a demo account has no real data behind it), but the
-- lazy cleanup in demoSeedService.js relies on this column to find its own
-- rows - reversing this while demo accounts still exist orphans them, since
-- there is no other flag identifying them once this one is gone.
ALTER TABLE "groups" DROP COLUMN "is_demo";
ALTER TABLE "users" DROP COLUMN "is_demo";

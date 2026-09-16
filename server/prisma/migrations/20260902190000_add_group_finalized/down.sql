-- Down migration for: add_group_finalized
--
-- LOSSY: which groups had been finalized is forgotten. Re-applying the
-- forward migration marks every group as not finalized.
ALTER TABLE "groups" DROP COLUMN "is_finalized";

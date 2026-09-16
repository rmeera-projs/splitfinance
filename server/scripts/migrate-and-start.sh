#!/bin/sh
# Container entrypoint. Replaces the plain `prisma migrate deploy && npm
# start` that used to be the Dockerfile CMD.
#
# The problem it solves: `migrate deploy` had no undo. Postgres runs each
# migration file in its own transaction, so a migration that fails outright
# rolls itself back - but that is the easy case. The hard ones are a
# migration that succeeds and is wrong, and a multi-statement migration
# where a later statement fails after an earlier non-transactional one
# already took effect. Neither leaves anything to go back to.
#
# So: dump first, migrate, and restore automatically if the migration
# fails. On success the dump is kept, which is what makes a considered
# rollback possible afterwards (see rollback-migration.sh).
set -eu

BACKUP_DIR="${BACKUP_DIR:-/var/backups/splitfinance}"
# Ten is enough to reach back through several deploys without the volume
# growing without bound.
BACKUP_KEEP="${BACKUP_KEEP:-10}"

# Prisma accepts connection URLs carrying its own parameters (?schema=public);
# libpq does not, and rejects the whole URL as invalid. pg_dump and psql get
# the query string stripped.
PG_URL=$(printf '%s' "$DATABASE_URL" | sed 's/?.*$//')

log() {
  echo "[migrate] $*"
}

# The db container accepts TCP connections before Postgres itself is ready
# to answer, and compose's depends_on only waits for the former.
log "waiting for the database"
until pg_isready -d "$PG_URL" >/dev/null 2>&1; do
  sleep 1
done

# Most restarts have nothing to apply - a redeploy of unchanged code, a
# reboot, a crash loop. Dumping on every one of those would be pure cost,
# and worse, would push the genuinely useful pre-migration dumps out of the
# retention window.
if npx prisma migrate status 2>&1 | grep -q "have not yet been applied"; then
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/pre-migration-$(date -u +%Y%m%dT%H%M%SZ).sql"

  log "pending migrations found - backing up to $BACKUP_FILE"
  # A plain dump: scripts/db-restore.sh clears the schema before replaying
  # it, so the dump does not need to drop anything itself (and pg_dump's own
  # --clean cannot do it correctly here - see that script for why). The dump
  # includes _prisma_migrations, so restoring reverts the migration history
  # along with the schema.
  if ! pg_dump --format=plain --no-owner --no-privileges "$PG_URL" > "$BACKUP_FILE"; then
    log "ERROR: backup failed - refusing to migrate without one"
    rm -f "$BACKUP_FILE"
    exit 1
  fi
  log "backup complete ($(wc -c < "$BACKUP_FILE") bytes)"

  if npx prisma migrate deploy; then
    log "migrations applied"
  else
    log "ERROR: migration failed - restoring from $BACKUP_FILE"
    if ./scripts/db-restore.sh "$BACKUP_FILE"; then
      log "database restored to its pre-migration state"
    else
      # Worth being loud about: the schema is now in whatever state the
      # failed migration left it, and the dump is still on disk.
      log "CRITICAL: restore ALSO failed. The database needs manual"
      log "CRITICAL: attention. The backup is at $BACKUP_FILE"
    fi
    # Either way the server does not start. Serving requests against a
    # schema the code does not expect is worse than being down, and the
    # container restarting into the same failure is a clear signal.
    exit 1
  fi

  # Oldest first, keep the newest BACKUP_KEEP.
  ls -1t "$BACKUP_DIR"/pre-migration-*.sql 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) | while read -r old; do
    log "pruning old backup $(basename "$old")"
    rm -f "$old"
  done
else
  log "no pending migrations"
fi

log "starting the server"
exec npm start

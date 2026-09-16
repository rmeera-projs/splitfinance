#!/bin/sh
# Rolling back a migration that already succeeded.
#
# Deliberately manual, unlike the automatic restore in migrate-and-start.sh.
# That one handles a migration that failed, where going back is
# unambiguously right. This one handles a migration that worked and turned
# out to be wrong - and by then the application has been writing to the new
# schema, so whether to lose those writes is a judgement call, not something
# a script should make on its own.
#
# Two ways back, and they are not equivalent:
#
#   --down    Applies the migration's down.sql and removes it from Prisma's
#             history. Keeps everything written since. Use this when the
#             schema change was wrong but the data is fine.
#
#   --restore Replays a pre-migration dump wholesale. Loses everything
#             written since that dump was taken. Use this when the data
#             itself is wrong, or when there is no usable down.sql.
#
# Run it inside the server container, which is where the tooling and the
# backup volume are:
#
#   docker compose exec server ./scripts/rollback-migration.sh --list
#   docker compose exec server ./scripts/rollback-migration.sh --down --yes
set -eu

BACKUP_DIR="${BACKUP_DIR:-/var/backups/splitfinance}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-./prisma/migrations}"
PG_URL=$(printf '%s' "$DATABASE_URL" | sed 's/?.*$//')

MODE=""
DUMP_FILE=""
CONFIRMED=""

usage() {
  cat <<USAGE
Usage:
  rollback-migration.sh --list
  rollback-migration.sh --down [--yes]
  rollback-migration.sh --restore [FILE] [--yes]

  --list        Show applied migrations and available backups, change nothing.
  --down        Apply the newest applied migration's down.sql and forget it.
  --restore     Replay a backup. Defaults to the most recent one.
  --yes         Skip the confirmation prompt (required when not on a terminal).
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --list) MODE="list" ;;
    --down) MODE="down" ;;
    --restore)
      MODE="restore"
      # An optional filename may follow, but not another flag.
      case "${2:-}" in
        ""|--*) ;;
        *) DUMP_FILE="$2"; shift ;;
      esac
      ;;
    --yes|-y) CONFIRMED="yes" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [ -z "$MODE" ]; then
  usage >&2
  exit 2
fi

psql_q() {
  psql -qtAX -v ON_ERROR_STOP=1 -d "$PG_URL" -c "$1"
}

# Prisma records every applied migration here. Rolled-back ones have to be
# removed from it or `migrate deploy` considers them done and will not
# reapply them.
latest_applied() {
  psql_q "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC LIMIT 1"
}

latest_dump() {
  ls -1t "$BACKUP_DIR"/pre-migration-*.sql 2>/dev/null | head -1
}

confirm() {
  [ "$CONFIRMED" = "yes" ] && return 0
  printf '%s [type "yes" to continue]: ' "$1"
  read -r answer
  [ "$answer" = "yes" ]
}

if [ "$MODE" = "list" ]; then
  echo "Applied migrations (newest first):"
  psql_q "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC" \
    | while read -r name; do
        if [ -f "$MIGRATIONS_DIR/$name/down.sql" ]; then
          echo "  $name"
        else
          echo "  $name  (NO down.sql - only --restore can undo this one)"
        fi
      done
  echo
  echo "Backups in $BACKUP_DIR (newest first):"
  ls -1t "$BACKUP_DIR"/pre-migration-*.sql 2>/dev/null | sed 's/^/  /' || echo "  none"
  exit 0
fi

if [ "$MODE" = "down" ]; then
  NAME=$(latest_applied)
  [ -n "$NAME" ] || { echo "No applied migrations to roll back." >&2; exit 1; }

  DOWN="$MIGRATIONS_DIR/$NAME/down.sql"
  if [ ! -f "$DOWN" ]; then
    echo "No down.sql for $NAME - use --restore instead." >&2
    exit 1
  fi

  echo "About to roll back: $NAME"
  echo
  sed 's/^/  | /' "$DOWN"
  echo
  confirm "Apply this?" || { echo "Cancelled."; exit 1; }

  # One transaction covering both the schema change and its history row, so
  # a failure part-way cannot leave Prisma believing something that is no
  # longer true about the schema.
  psql -v ON_ERROR_STOP=1 -d "$PG_URL" --single-transaction \
    -f "$DOWN" \
    -c "DELETE FROM _prisma_migrations WHERE migration_name = '$NAME'"

  echo "Rolled back $NAME. Deploy the matching application code before serving traffic."
  exit 0
fi

if [ "$MODE" = "restore" ]; then
  [ -n "$DUMP_FILE" ] || DUMP_FILE=$(latest_dump)
  [ -n "$DUMP_FILE" ] || { echo "No backups found in $BACKUP_DIR." >&2; exit 1; }
  [ -f "$DUMP_FILE" ] || { echo "No such backup: $DUMP_FILE" >&2; exit 1; }

  echo "About to restore: $DUMP_FILE"
  echo "Everything written since that dump was taken will be lost."
  confirm "Continue?" || { echo "Cancelled."; exit 1; }

  ./scripts/db-restore.sh "$DUMP_FILE"
  echo "Restored from $DUMP_FILE."
  exit 0
fi

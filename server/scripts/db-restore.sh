#!/bin/sh
# Replays a dump over the current database. Shared by the automatic restore
# in migrate-and-start.sh and the manual one in rollback-migration.sh, so
# there is exactly one implementation of the risky part.
#
# The schema is dropped and recreated first rather than letting pg_dump's
# own --clean do it. --clean emits a DROP for each object the dump knows
# about, which fails the moment the live database contains something the
# dump does not - and that is not an edge case here, it is the whole
# scenario: rolling back means the database has a table the dump predates.
# It surfaced as "cannot drop constraint users_pkey because
# email_verification_tokens depends on it", leaving the restore half-done.
#
# Dropping the schema wholesale has no such ordering problem, and makes the
# result identical no matter what state the database was in beforehand.
set -eu

DUMP_FILE="${1:?usage: db-restore.sh <dump-file>}"
PG_URL=$(printf '%s' "$DATABASE_URL" | sed 's/?.*$//')

[ -f "$DUMP_FILE" ] || { echo "No such dump: $DUMP_FILE" >&2; exit 1; }

# The GRANT restores what Postgres 15 and later no longer give back
# automatically when the public schema is recreated.
psql -v ON_ERROR_STOP=1 -d "$PG_URL" -q -c '
  DROP SCHEMA public CASCADE;
  CREATE SCHEMA public;
  GRANT ALL ON SCHEMA public TO public;
'

psql -v ON_ERROR_STOP=1 -d "$PG_URL" -q -f "$DUMP_FILE" >/dev/null

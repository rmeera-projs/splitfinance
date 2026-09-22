# Database

Schema, the cents-as-integers rule, and how migrations roll back. See the main [README](../README.md) for the product overview.

## Data Model

8 tables:

```
users                  (id, name, username, email, password_hash, token_version, is_admin, created_at)
groups                 (id, name, created_by, is_finalized, created_at)
group_members          (group_id, user_id, joined_at)
expenses               (id, group_id, paid_by, amount¹, description, category, date, created_at)
expense_splits         (id, expense_id, user_id, amount_owed¹)
settlements            (id, group_id, from_user, to_user, amount¹, date, created_at)
password_reset_tokens  (id, user_id, token_hash, expires_at, used_at, created_at)
email_verification_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
```

¹ `INTEGER`, holding **cents** rather than dollars — see Money below.

`users.email_verified_at` is `NULL` until the address is confirmed. It gates
the Cohere-backed features only — see [SECURITY.md](SECURITY.md).

See `server/prisma/schema.prisma` for the full schema.


## Money

Every amount in this app — in the database, over the API, and through every
calculation — is an **integer number of cents**. `$10.23` is `1023`.

Money was originally `NUMERIC(10,2)` in Postgres but became a JavaScript
`number` the moment it was read, and binary floating point can't represent
most decimal fractions exactly (`0.1 + 0.2 === 0.30000000000000004`). That
had one concrete consequence worth calling out: validating that an expense's
splits summed to its total needed a tolerance —

```js
if (Math.abs(splitTotal - data.amount) > 0.01)  // before
```

— which meant a split that was genuinely off by up to a cent passed
validation on every expense. With integers the same check is exact:

```js
if (splitTotal !== data.amount)                 // now
```

The tolerances are gone from debt simplification too, where "settled" now
means exactly zero instead of "within a cent" (which had been quietly
discarding real one-cent balances).

Dollars survive only at the edges — what someone types, what's rendered, and
what Cohere returns when it reads a sentence like "Dinner $60". Those cross
through [`money.js`](../server/src/utils/money.js) (mirrored at
[`client/src/utils/money.js`](../client/src/utils/money.js)), which converts via
*string parsing* rather than `Math.round(value * 100)`, because that
multiplication is itself lossy: `1.005 * 100` is `100.49999999999999`, which
rounds to `100` — the wrong cent.

The other thing integers force you to be honest about is remainders. `$60.50`
three ways is `2016.66…` cents each, which no set of equal whole cents can
make. `splitEvenly` hands the leftover cents out one at a time, so the parts
always reconcile against the total exactly rather than relying on a
correction afterwards that may or may not land.


## Migrations

Migrations used to be forward-only: `prisma migrate deploy` ran as the
container command and that was the whole story. Two schema migrations
shipped in a single day made the gap concrete — reverting the application
code after the integer-cents conversion would have left the database in
cents while the old code expected dollars, showing every amount 100x too
large.

**Every migration ships with a `down.sql`**, including the nine that
predate the convention. There's no allowlist of grandfathered ones: an
exception list is the thing that grows, and "most migrations can be rolled
back" isn't a property anyone can lean on at the moment they need it. Each
one states plainly whether reversing it loses data, because that's what
decides between reversing the schema and restoring a dump — and it gets
read under time pressure. Two test layers enforce this: a filesystem check
in the fast suite, and a database-backed test that applies the whole
history forward and then reverses all of it. A `down.sql` that has never
been executed is worse than not having one, because it gets trusted exactly
when there's no time to check it.

**Failed migrations roll back automatically.**
[`migrate-and-start.sh`](../server/scripts/migrate-and-start.sh) is now the
container command: it dumps the database, migrates, and restores if the
migration fails — then exits non-zero, so the server never starts against a
schema the code doesn't expect. Postgres already rolls back a failed
migration file on its own, so the real value is elsewhere: a failed
`migrate deploy` leaves an unfinished row in `_prisma_migrations` that
blocks *every subsequent deploy* with `P3018` until someone runs
`migrate resolve` by hand. Restoring the dump clears that too. Dumps are
only taken when something is actually pending, so ordinary restarts stay
fast.

**A migration that succeeded and was wrong is a separate, manual
decision.** By then the app has been writing to the new schema, so whether
to discard those writes isn't something a script should decide:

```bash
docker compose exec server ./scripts/rollback-migration.sh --list
docker compose exec server ./scripts/rollback-migration.sh --down     # reverse the schema, keep the writes
docker compose exec server ./scripts/rollback-migration.sh --restore   # replay a dump, lose the writes
```

In production the dumps live on the persistent EBS volume alongside the
database itself. As an ordinary Docker volume they'd sit on the root disk,
which is destroyed whenever the instance is replaced — while the database
survives. The backups would have been the one thing unable to outlive an
incident.

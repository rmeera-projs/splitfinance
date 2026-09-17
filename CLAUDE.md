# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

SplitFinance is a Splitwise-style expense-splitting app: React (Vite) + Express/Prisma/PostgreSQL,
deployed on a single AWS EC2 instance via Terraform. Live at https://splitfinance.org, API at
https://api.splitfinance.org.

## Commands

Node 24 is required — see "Node version is pinned deliberately" below.

```bash
# Backend (server/)
npm test                      # Jest unit suite, Prisma mocked, no DB needed
npm run lint                  # eslint src --max-warnings 0
npm run dev                   # nodemon
npx jest path/to/file.test.js # a single file
npx jest -t "part of a name"  # a single test

# Frontend (client/)
npm test                      # Vitest + React Testing Library
npm run lint                  # note the --ext .js,.jsx; without it eslint skips every .jsx
npm run build                 # production build (also a CI smoke check)
npx vitest run src/pages/LoginPage.test.jsx     # a single file
npm test -- -t "part of a name"                 # a single test
```

### Integration tests (need a real Postgres)

```bash
docker compose up -d db
cd server
docker compose exec db createdb -U postgres splitfinance_test
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/splitfinance_test" npm run test:integration:setup
npm run test:integration      # defaults to that same splitfinance_test database
npx jest --config jest.integration.config.js tests/integration/settling-up.test.js   # single file
```

`npm run test:integration:setup` is `prisma migrate deploy` and **respects whatever `DATABASE_URL` is
in the environment** — without the prefix it migrates the *dev* database instead, and the suite then
fails against an unmigrated test database. This is an easy half-hour to lose.

### End-to-end (Playwright)

```bash
docker compose -f docker-compose.yml -f docker-compose.e2e.yml -p splitfinance-e2e up -d --build
cd e2e && npm ci && npx playwright install chromium
npm test
npx playwright test -g "settling up"   # a single test
docker compose -p splitfinance-e2e down -v
```

Both compose files must be passed explicitly. A plain `docker compose up` picks up any local
`docker-compose.override.yml` (gitignored, and has broken this suite before). The e2e stack uses its
own ports (5433/5001/5174) and its own database, so it never touches dev data.

## Architecture

### Money is integer cents, everywhere

Every amount — database column, API field, React state — is an **integer number of cents**. There are
no floats and no decimals in the money path. `server/src/utils/money.js` and `client/src/utils/money.js`
are the only places that convert.

- `parseAmountToCents` is string-based on purpose: `1.005 * 100 === 100.49999999999999`.
- `splitEvenly` distributes the remainder so splits reconcile **exactly** — $0.05 between two people
  is 3¢ and 2¢, not 2.5¢ each.
- `createExpense`/`updateExpense` reject a request whose splits do not sum to the total exactly
  (`splitTotal !== data.amount`). There is no tolerance window; do not add one.
- `Int` in Postgres caps at **$21,474,836.47**, which is lower than the old `NUMERIC(10,2)` ceiling.
  The migration that converted the columns guards against overflow for this reason.

### There is one definition of "who owes whom"

`server/src/services/balanceService.js` computes a group's **simplified** debts, and everything that
needs to know what is owed goes through it: the group page lists them, Settle up pays them,
`settlementController` validates payments against them, and the dashboard's per-person balances
(`GET /api/users/me/balances`) add them up across groups.

Do not derive a second notion of balance. Settlements were once validated against the *direct* balance
between two people, which disagrees with the simplified debts whenever simplification routes a debt
through a third person — so the server refused payments the page offered and accepted ones it didn't,
silently creating debts. It is invisible in a two-person group; test balance logic with at least three.

### Auth is an HttpOnly cookie, not a bearer token

`server/src/utils/authCookie.js` owns the cookie and its flags. Consequences that span files:

- Responses **never contain the token**. Signup/login return only a user object.
- `requireAuth` reads `req.cookies[COOKIE_NAME]`, then hits the database every request to compare
  `tokenVersion` (so a password change revokes sessions immediately) and to set `req.emailVerified`.
- Logout is a **server round-trip** — JavaScript cannot delete a cookie it cannot read. The endpoint is
  deliberately unauthenticated so a stale cookie can still be cleared.
- The client cannot tell whether it is signed in, so `AuthContext` probes `GET /users/me` on mount with
  `{ skipAuthRedirect: true }`. Without that opt-out the 401 from that probe redirects a logged-out
  visitor off `/signup` mid-typing.
- CORS must use a concrete origin — `credentials: true` is incompatible with `origin: "*"`.
- Socket.IO authenticates from `socket.handshake.headers.cookie`, not `socket.auth`.

`splitfinance.org` and `api.splitfinance.org` share a registrable domain, so `SameSite=Lax` handles
CSRF without a token exchange. That stops being true if the API ever moves to a different domain.

### The PII boundary in Prisma selects

`server/src/utils/publicUser.js` has two select shapes and one presenter, and using the wrong one is a
real data leak:

- `publicUserSelect` (includes email) — **only** for the requester's own account.
- `groupUserSelect` (name/username only) — every *other* nested user: group members, expense payers,
  split participants.
- `presentUser()` is the single definition of the signed-in user over the wire. It names fields
  explicitly, so passing it a full Prisma row cannot leak `passwordHash`, and it converts
  `emailVerifiedAt` into the `emailVerified` boolean the client uses. Signup, login and `/users/me`
  all go through it — keep it that way or the verification banner drifts out of sync.

Never use `include: { user: true }` / `{ payer: true }`; that pulls the bcrypt hash along.

### Authorization has two independent layers

Route-level membership checks prove *the requester* belongs to a group. They say nothing about the
other user ids a request supplies (`paidBy`, `splits[].userId`, `toUser`), which reference the global
`User` table with sequential ids. `server/src/utils/assertGroupMembers.js` is the shared check for
those, and every write touching another user must call it.

### Email verification gates the AI only

`users.email_verified_at` gates the Cohere-backed features and nothing else, because signing up is free
and throwaway accounts were the cheap route to metered quota:

- `POST /api/expenses/parse` refuses with `403` and `code: "EMAIL_NOT_VERIFIED"` (the client keys off
  the code, not the prose).
- Creating/editing an expense still works but **skips auto-categorization** rather than failing.
- Everything else — groups, expenses, settling up — is open to an unverified account. Keep it that way.

### Security logging

`server/src/services/securityLog.js` writes one JSON object per line and escalates repeated events to a
`warn`. Wired in at the points that see everything rather than at each call site: the central
`errorHandler` covers every 500 and every controller-raised 403, `requireAuth` covers rejected sessions,
the rate limiters log before responding.

It is **silent under `NODE_ENV=test`** unless `SECURITY_LOG_TEST_OUTPUT` is set — tests asserting on
output must set it. Field names matching a credential-ish pattern are redacted regardless of what the
caller passes.

### Database migrations must ship with a rollback

**Every migration directory needs a `down.sql` alongside `migration.sql`**, and it must state whether
reversing it loses data. Two test layers enforce this — a filesystem check in the fast suite, and a
database-backed test that applies the entire history forward then reverses all of it against a scratch
database. There is no allowlist of exceptions.

The container entrypoint is `server/scripts/migrate-and-start.sh`, not `prisma migrate deploy`. It dumps
the database when something is pending, migrates, restores automatically on failure, and exits non-zero
so the server never serves against an unexpected schema. `scripts/rollback-migration.sh` handles a
migration that succeeded and was wrong (`--down` keeps later writes, `--restore` does not).

When restoring, go through `scripts/db-restore.sh`. Do not use `pg_dump --clean`: it emits a DROP per
object it knows about, which fails whenever the live database has objects the dump predates — i.e.
always, when rolling back.

### Testing is three deliberate layers

| Layer | Config | What is real |
|---|---|---|
| Unit | `jest.config.js`, Vitest | the Express app and React components; Prisma/Cohere/Resend mocked |
| Integration | `jest.integration.config.js` | real Postgres, real Prisma, real migrations; only Cohere/Resend mocked |
| End-to-end | `e2e/playwright.config.js` | everything — real browser, API, database |

The layers earn their keep: e2e caught the signup-redirect bug while all unit tests passed, and the
scratch-database migration test caught an integer-overflow bug before it ever deployed. When something
only breaks in a real browser or a real database, add it to the layer that can see it.

`realtimeService`'s `io` stays `null` under Jest by design, so `emitGroupActivity` is a safe no-op in
unit tests.

## Deployment

**A push to `main` that touches the app deploys.** CI runs four gating jobs (backend lint+unit,
integration, frontend, Playwright) and then redeploys the EC2 instance over AWS SSM. A `changes` job
decides whether the deploy runs at all: pushes touching only `*.md`, `.github/`, `docs/`, `e2e/` or
`.gitignore` skip it, since none of those can reach a container. Everything else deploys, and anything
it cannot work out (a force push, a rewritten history) deploys too — failing open, because a silently
skipped deploy leaves production behind the code. `.gitattributes` is deliberately *not* in the skip
list: it controls line endings at checkout, and a shell script arriving with CRLF breaks the server
image. To deploy unchanged code, or to recover from a skipped deploy, run the CI workflow manually
from the Actions tab (`workflow_dispatch` always deploys).

**`terraform apply` replaces the EC2 instance.** `user_data_replace_on_change = true`, so nearly any
change to `terraform/user_data.sh.tpl` destroys and recreates the instance: several minutes of real
downtime. **Ask before running it.** The database and Caddy's certificate store live on a separate EBS
volume and survive; the root disk does not.

`terraform/terraform.tfvars` is gitignored and holds real secrets. Never commit it.

### NODE_ENV=production is load-bearing

Two security behaviours are written against it and are silently inert without it: the session cookie's
`Secure` flag, and `emailService` withholding the raw password-reset URL from logs. It is set in the
compose override generated by `user_data.sh.tpl`.

### Node version is pinned deliberately

CI and all three Dockerfiles pin **Node 24** and should move together. Node 20 is EOL, and the frontend
toolchain will not run on it at all — vitest 5 requires `^22.12 || ^24 || >=26`, jsdom 28 needs
`>=22.22`. A mismatch shows up as `webidl.util.markAsUncloneable is not a function`, which names no
version and passes locally while failing in CI.

`server/Dockerfile` installs `postgresql16-client` to match the `postgres:16-alpine` server — `pg_dump`
refuses to dump from a newer server than itself, so that pin moves when the database image does.

## Conventions worth knowing

- **`.gitattributes` pins `*.sh` to LF.** A CRLF shebang makes a container fail with a bare
  "not found". Writing shell scripts from Python on Windows silently converts them — check before
  committing.
- **Dockerfiles use `npm ci`**, so `package.json` and the lockfile must stay in sync; this is what
  guarantees production runs the tree CI audited.
- **`errorHandler`'s unused 4th parameter is load-bearing** — Express detects error middleware by
  function arity.
- **Rate limiters skip entirely under `NODE_ENV=test`**; the e2e stack raises the limit via
  `AUTH_RATE_LIMIT_MAX` instead, since it legitimately signs up many accounts from one address.
- **ESLint 8 with `.eslintrc.json`**, not flat config.
- Both `README.md` (thorough, user-facing) and `DEPLOYMENT.md` are kept current; update the README when
  behaviour or test counts change.

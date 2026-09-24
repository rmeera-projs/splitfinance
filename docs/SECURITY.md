## 🔒 Security

A few protections worth calling out explicitly, mostly the product of a
review once the app was live on a real domain:

- **Group-membership checks on every user id a request supplies, not just
  the requester** - `paidBy` and each `splits[].userId` on an expense,
  `toUser` on a settlement, are all separate ids the *request* names, and
  the database has no constraint tying them to any particular group (they
  reference the global `User` table). The requester being a group member
  only proves *they* belong there; without checking these other ids too, an
  authenticated attacker could create their own group and reference any
  other registered user - sequential integer ids - as a payer or split
  participant. [`assertGroupMembers.js`](../server/src/utils/assertGroupMembers.js)
  is the shared check, used by `createExpense`, `updateExpense`, and
  `createSettlement`.
- **Group members see name/username only, never email or account-creation
  date** - [`publicUser.js`](../server/src/utils/publicUser.js) has two select
  shapes: `publicUserSelect` (with email) is only for the authenticated
  user's own account (`GET/PATCH /api/users/me`); every other nested user -
  group members, expense payers - uses `groupUserSelect` instead.
- **Settlements are validated against the actual balance, server-side** -
  `createSettlement` rejects an amount that's `<= 0`, exceeds what's
  currently owed, runs in the wrong direction, or names the requester as
  both parties. Partial settlements (paying off less than the full
  balance) are allowed. "Currently owed" means the group's *simplified*
  debts - the same list the group page shows and settles from, computed in
  one place ([`balanceService.js`](../server/src/services/balanceService.js)).
  It originally checked the direct balance between the two people instead,
  which disagrees whenever simplification routes a debt through someone
  else: if Carol owes Bob and Bob owes Alice, the page shows "Carol owes
  Alice", but directly Carol owes Alice nothing. That broke settling both
  ways - the server refused payments the page was offering, and accepted
  ones the page said weren't owed, quietly creating a new debt. Neither
  case can occur in a two-person group, which is why the browser tests
  missed it; a three-person integration test now pins both directions.
- **The session token is unreachable from JavaScript** - it lives in an
  HttpOnly, SameSite=Lax cookie ([`authCookie.js`](../server/src/utils/authCookie.js))
  rather than `localStorage`, so a script injected into the page can't read
  it and replay it elsewhere. Worth being precise about the limit: an
  injected script can still make authenticated requests from the victim's
  own browser, because the cookie rides along automatically. This narrows
  the blast radius from "token stolen and reusable anywhere for 7 days" to
  "abuse confined to the live page" - which is why the CSP below is doing
  comparable work on the same threat. Two consequences worth knowing: CSRF
  is handled by `SameSite` (the frontend and API are different origins but
  the same *site*, so the cookie is sent on the app's own calls and withheld
  from cross-site ones), and signing out became a real endpoint
  (`POST /api/auth/logout`), since JavaScript cannot delete a cookie it
  cannot see.
- **Sessions can actually be revoked** - JWTs carry a `tokenVersion` claim
  (`User.tokenVersion` in the schema) checked against the user's current
  value on every authenticated request, in both `requireAuth`
  ([`middleware/auth.js`](../server/src/middleware/auth.js)) and the Socket.IO
  handshake ([`realtimeService.js`](../server/src/services/realtimeService.js)).
  Changing or resetting a password increments it, which invalidates every
  token issued before that point - including one that leaked, which may be
  exactly why someone's resetting their password - rather than leaving it
  valid for the rest of its 7-day life. `changePassword` sets a fresh
  session cookie on its response so the requester's own session survives;
  anyone else holding an older token doesn't.
- **Rate limiting, tuned per endpoint kind**
  ([`rateLimit.js`](../server/src/middleware/rateLimit.js)): `signup`/`login`/
  `forgot-password`/`demo` are capped at 10 requests/15min/IP (guards against
  credential stuffing, email enumeration, and - for `demo` specifically -
  someone scripting sandbox creation to grow the database; `demo` needs no
  request body at all, so it would otherwise be the single cheapest write
  in the API to spam). The Cohere-calling endpoints
  (expense creation/editing, natural-language parsing) sit behind
  `requireAuth`, but signup is public and free, so a per-IP limit alone
  wouldn't stop someone from registering a few accounts and hammering these
  from one machine anyway - they're limited per-IP *and* per-user on a
  short window, plus a per-user daily ceiling, to bound Cohere spend/load
  from a single account spread out over time too.
- **`app.set("trust proxy", 1)`** in `app.js` - without it, Express sees
  Caddy's own address on every request (the one reverse-proxying to it in
  production - see [DEPLOYMENT.md](../DEPLOYMENT.md)), not the real client's,
  which would turn the per-IP rate limits above into one shared limit for
  every visitor behind Caddy.
- **The production build is what actually ships** - AWS deploys
  `client/Dockerfile.prod` (a real `vite build`, served as static files),
  never `client/Dockerfile` (Vite's dev server, meant for local iteration
  only - its own `vite.config.js` has an `allowedHosts: true` setting that
  says as much). See [DEPLOYMENT.md](../DEPLOYMENT.md) for the override that
  makes this happen.
- **Secrets aren't baked into the EC2 instance's user-data** - Cohere/
  Resend/JWT/Postgres/ZeroSSL secrets are SecureString parameters in SSM
  Parameter Store (`aws_ssm_parameter.secrets` in
  [`terraform/main.tf`](../terraform/main.tf)), fetched by the instance
  itself at boot via a narrowly-scoped IAM policy - not templated
  directly into the boot script, which is otherwise readable in plaintext
  by anyone in the AWS account with `ec2:DescribeInstanceAttribute`
  permission (a wider audience than whoever can read Terraform state).
  Postgres also no longer uses the `docker-compose.yml` default
  (`postgres`/`postgres`) - its actual password is generated
  (`random_password.postgres_password`) the same way `JWT_SECRET` already
  was.
- **CI deploys via GitHub OIDC, not a stored AWS key** - see [DEPLOYMENT.md](../DEPLOYMENT.md#continuous-deployment-via-github-actions-aws-only).
- **A real Content-Security-Policy on the frontend** - set in Caddy
  (`terraform/user_data.sh.tpl`), not Helmet, because it's the
  browser-rendered static build that a CSP actually restricts, not the
  JSON API's responses. Scoped to what the app actually needs rather than
  loosened with `*`/`'unsafe-eval'`: `'unsafe-inline'` on `style-src` only
  (for `InsightsPanel`'s inline chart-bar styles), and an explicit
  `connect-src` entry for `api.splitfinance.org`'s HTTPS and WebSocket
  origin, since it's a separate domain from the frontend.
- **Password-reset URLs never reach production logs** -
  [`emailService.js`](../server/src/services/emailService.js) only prints the
  raw reset link (which embeds the live token) when
  `NODE_ENV !== "production"`; the database itself only ever stores the
  token's SHA-256 hash, never the raw value.
- **Security events are logged structurally, and escalate on their own** -
  [`securityLog.js`](../server/src/services/securityLog.js) writes one JSON
  object per line for failed and successful logins, signups, password
  resets, rejected session cookies, every 403, every 500, AI usage, and any
  rate limiter tripping. The part that makes it more than a firehose is
  that repeated events escalate to a `warn` on stderr: one failed login is
  a typo, five against the same account inside fifteen minutes is worth
  looking at. Failed logins are keyed by the *account* rather than the
  source address, because a distributed credential-stuffing run varies
  where it comes from but not what it is trying to get into; bulk signups
  are keyed the other way. Where a rate limiter already exists, the warning
  fires deliberately below it - by the time a limiter trips, the request
  that was the useful signal has already been discarded. Field names that
  look like credentials are redacted no matter what a caller passes. In
  production these lines ship straight to a CloudWatch log group
  (`aws_cloudwatch_log_group.server_security` in
  [`terraform/main.tf`](../terraform/main.tf), via the Docker `awslogs`
  logging driver configured in `terraform/user_data.sh.tpl`), authenticated
  through the instance's own IAM role rather than any embedded credential -
  `aws logs tail /splitfinance/server --follow` is the live equivalent of
  the SSH-in-and-`docker compose logs` that used to be the only way to read
  them, and the history now survives instance replacement instead of
  resetting with it.
- **The AI features require a confirmed email address** - signing up is
  free and instant, which makes throwaway accounts the cheapest route to
  this project's metered Cohere quota. `POST /api/expenses/parse`, `POST
  /api/expenses/receipt` and `POST /api/assistant/ask` are gated on
  `users.email_verified_at`
  ([`requireVerifiedEmail.js`](../server/src/middleware/requireVerifiedEmail.js)),
  and creating or editing an expense still works but skips its
  auto-categorization. The scope is deliberate: an unconfirmed account can
  create groups, add expenses, split them and settle up - everything people
  actually sign up to do - because none of that costs anything, and putting
  a mail round-trip in front of the first run would be a real cost against
  a problem that does not exist there. The confirmation token is 32 random
  bytes stored only as a SHA-256 hash, single-use, and asking for a fresh
  link spends the outstanding one.
- **The assistant can only ever see the caller's own data** - its tools take
  no user id (each closes over the authenticated session), every group id is
  membership-checked before a query runs, and every tool is read-only, so a
  prompt-injection payload in an expense description has nothing to aim at.
  See [Balances & Spending Assistant](ARCHITECTURE.md#balances--spending-assistant) in ARCHITECTURE.md
- **Receipt uploads are narrow and never persisted** - a size cap, the file
  type decided from its bytes rather than its name, and no copy kept anywhere,
  because a receipt photo can carry card digits and a name. See
  [Receipt Scanning](ARCHITECTURE.md#receipt-scanning) in ARCHITECTURE.md
- **Dependencies are audited on a schedule, not just when someone
  remembers** - [`security.yml`](../.github/workflows/security.yml) runs
  `npm audit` on every change *and* weekly, since "no new commits" is not
  the same as "no new advisories". It fails on production dependencies at
  moderate or worse and reports dev-tooling findings without blocking - a
  split the last real findings argue for, since the one that shipped to
  browsers (an open redirect in react-router) was rated *moderate* while
  several criticals were in build-time-only tooling. Dependabot
  ([`dependabot.yml`](../.github/dependabot.yml)) opens the upgrade PRs, which
  run the full test suite before anyone merges them - monthly, with routine
  minor/patch updates grouped into one PR per project, and the major
  versions that were reviewed and declined (React 19, Tailwind 4, eslint 10,
  Prisma 7, cookie 2) ignored with the reason recorded, so they don't
  reappear with every patch release. zod 4 was on that list too, until it
  was taken deliberately (see the [Roadmap](../README.md#-roadmap)). That throttles routine
  churn only: Dependabot *security* updates are triggered by advisories, not
  the schedule, and the Dockerfiles use `npm ci` so the tree running in
  production is the tree that was audited.

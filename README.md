# SplitFinance - A Splitwise-Style Expense Sharing App

A full-stack expense-splitting app: track shared expenses across a group,
let an AI categorise and parse them, and settle up in as few payments as
the math allows.

🔗 **Live at [splitfinance.org](https://splitfinance.org)** · API health check: [api.splitfinance.org](https://api.splitfinance.org/health)

React (Vite) · Node/Express · PostgreSQL + Prisma · Socket.IO · Cohere ·
Docker · Terraform on AWS EC2 · GitHub Actions CI/CD

## 🏛️ How it fits together

```mermaid
flowchart LR
    U["Browser"] -->|HTTPS| C

    subgraph EC2["AWS EC2 · Docker Compose"]
        C["Caddy<br/>auto-TLS · CSP · security headers"]
        F["React SPA<br/>vite build, served static"]
        A["Express API<br/>JWT auth · Prisma"]
        DB[("PostgreSQL<br/>persistent EBS volume")]
        C --> F
        C --> A
        F -->|Socket.IO| A
        A --> DB
    end

    A --> CO["Cohere Chat API<br/>categorisation · NL parsing"]
    A --> RE["Resend<br/>password-reset email"]
    SSM["SSM Parameter Store<br/>secrets fetched at boot"] -.-> EC2
    GH["GitHub Actions<br/>test · lint · deploy via OIDC"] -.-> EC2
```

Everything below is the detail — [Features](#-features) first, then the
[algorithm](#-the-interesting-part-debt-simplification),
[AI](#-ai-features-cohere), [security](#-security), and
[deployment](#-deploying-for-real).

## ✨ Features

- **Auth** — JWT-based signup/login with hashed passwords; every account has
  a unique username (letters, numbers, underscores) alongside its email
- **Account Management** — a dedicated Account page (linked from the main
  menu on every page) for updating your name, username, or email, and for
  changing your password (requires the current one)
- **Admin Dashboard** — platform-wide counts (users, groups, expenses,
  settlements, total money moved) and a recent-signups/recent-groups
  glance, gated behind a `User.isAdmin` flag with no self-service way to
  set it (set directly in the database)
- **Password Reset** — a self-service "forgot password" flow: request a
  link by email, click it, set a new password. Reset tokens are single-use,
  expire in 1 hour, and the request endpoint responds identically whether
  or not the email is registered, so it can't be used to check who has an
  account
- **Groups** — create groups, invite members by email *or* username, and
  add more members to a group after it's already been created
- **Expenses** — log, edit, or delete expenses (editor-only), with 3 ways to split
  a bill: equally, by percentage, or by exact amount, and a "Split between"
  checkbox list to include/exclude specific members regardless of split type
- **Auto-Categorization** — expenses are automatically tagged with one of 9 fixed
  categories using Cohere's Chat API
- **Natural-Language Expense Entry** — type something like "Dinner $60, I
  paid, split with Bob and Charlie" and Cohere parses it into the
  add-expense form's fields for you to review before submitting
- **Balances** — real-time "who owes whom" view per group
- **Debt Simplification** — a graph-reduction algorithm that collapses a tangled
  web of IOUs into at most n−1 transactions for an n-person group
- **Settlements** — record payments between members, right from the balances view
- **Finalize / Reopen** — lock a group to stop new expenses once a trip/bill is
  done, without blocking settling up; any member can finalize or reopen
- **Manual Category Override** — any group member can correct a bad
  auto-categorization from a dropdown, even on a finalized group
- **Spending Insights** — category, time (day/week/month), and per-member/
  per-group breakdowns, both per-group and personally across all your groups;
  every current member appears in the per-member breakdown, even at $0 if
  they haven't been part of an expense yet
- **Activity Feed** — chronological log of expenses and settlements per group
- **Live Updates** — a WebSocket notice tells you when someone else changes a
  group you're viewing (new/edited/deleted expense, settlement, finalize/
  reopen, new member); the page refreshes itself automatically, with a
  dismissable banner naming who did what

## 🧠 The Interesting Part: Debt Simplification

If Alice owes Bob $10, Bob owes Carol $10, and Carol owes Alice $10, naively
that's 3 transactions — but the net effect is **zero**. This app implements a
greedy cash-flow reduction (`server/src/services/simplifyDebts.js`) that:

1. Computes each member's net balance (total owed − total owing)
2. Repeatedly matches the largest creditor with the largest debtor
3. Settles the whole group in **at most n−1 transactions** for n people

Each pass zeroes out at least one person's balance, which is what
guarantees the n−1 bound — so an O(n²) worst-case payment graph always
collapses to O(n) transactions.

Worth being precise about what this does *not* claim: finding the true
minimum number of transactions is NP-hard (it reduces to partitioning the
balances into as many zero-sum subsets as possible), so this is a
heuristic — the same one Splitwise uses in practice — not a provably
optimal solver. It's guaranteed to settle the group correctly and to stay
within the n−1 bound; it just isn't guaranteed to find the very shortest
possible list of payments in every case.

## 🤖 AI Features (Cohere)

### Auto-Categorization

Every expense is automatically tagged with one of 9 fixed categories (Food &
Drink, Groceries, Transportation, Housing & Utilities, Entertainment, Shopping,
Travel, Health & Wellness, Other) so spending is queryable by kind without any
manual tagging. This is implemented in
[`categorizationService.js`](server/src/services/categorizationService.js):

- Uses **Cohere's Chat endpoint** (`command-r7b-12-2024`) rather than the
  Classify endpoint, which Cohere has deprecated
- Drives the model with a **few-shot prompt** — one example description per
  category — asking it to reply with just the category name
- Normalizes the response (trims quotes/punctuation, matches case-insensitively)
  against the fixed category list
- **Never blocks expense creation**: a missing API key, a network/API error,
  or an unrecognized response all fall back to `"Other"`
- Only re-runs on an edit if the description actually changed, so fixing a
  typo in the amount doesn't burn an extra API call
- Fully unit-tested with a mocked Cohere client (`categorizationService.test.js`)
  — no live API calls happen in the test suite

If `COHERE_API_KEY` isn't set, every expense is simply categorized as `"Other"`
— the app works fully without it.

### Natural-Language Expense Entry

The add-expense form has a text box above its regular fields for describing
an expense in plain English - "Dinner $60, I paid, split with Bob and
Charlie" - which
[`expenseParsingService.js`](server/src/services/expenseParsingService.js)
turns into structured fields:

- Same Cohere Chat endpoint as categorization, but prompted for a single
  JSON object (`{description, amount, payerId, splitWithIds}`) instead of
  a category label, with the group's actual members (id + name) listed in
  the prompt so "Bob"/"I"/"me" resolve to real member ids rather than raw
  names the rest of the app can't use
- **Never creates the expense itself** - the parsed result only pre-fills
  the existing add-expense form (description, amount, "Paid by", and the
  split), so a bad parse just means editing the form before submitting,
  never a wrong charge going through unreviewed
- Drops any id the model hallucinates (a `payerId`/`splitWithIds` entry
  that isn't an actual member of the group) rather than trusting it outright
- A mentioned subset of members (not everyone) checks/unchecks the
  add-expense form's "Split between" list to match, applying to whichever
  split type is selected
- Without `COHERE_API_KEY`, falls back to a much cruder regex-only parse
  (just pulls out a dollar amount) rather than failing outright - same
  "optional until you need it" spirit as auto-categorization
- Fully unit-tested with a mocked Cohere client
  (`expenseParsingService.test.js`)

## 📊 Spending Insights

Both `GroupPage` (one group's expenses, broken down by member) and the
dashboard (your own share of spending across every group you're in, broken
down by group) share one [`InsightsPanel`](client/src/components/InsightsPanel.jsx)
component and one [aggregation utility](client/src/utils/insights.js):

- All aggregation (by category, by member/group, by time bucket) happens
  **client-side** from a flat list already fetched for the page - the data
  volumes involved (one group's or one person's expenses) are small enough
  that this is simpler than building server-side grouping queries, and it
  lets the time-bucket toggle switch **instantly with no refetch**
- The personal dashboard view is backed by one new endpoint,
  `GET /api/insights`, which flattens the current user's own expense-split
  shares across every group they belong to
- Time buckets (day/week/month, user-selectable) are computed against the
  **UTC calendar date**, not the viewer's local timezone - otherwise the
  same expense could land in a different day/week bucket depending on
  where the viewer is
- Bars are plain CSS (a `<div>` with a percentage width) rather than a
  charting library - there was no other charting need in the app to justify
  the dependency
- The per-member breakdown always lists every *current* group member, not
  just the ones with an expense so far - a member added after the fact would
  otherwise be silently missing until they actually paid for something

## 🔌 Live Updates with WebSockets

Group pages stay current across everyone viewing them via
[Socket.IO](server/src/services/realtimeService.js), without polling:

- One room per group (`group:<id>`) - a socket only joins after the server
  confirms the connecting user is actually a member, the same rule the REST
  API enforces
- Every mutating endpoint (add/edit/delete an expense, change its category,
  record a settlement, finalize/reopen, add a member) broadcasts a
  lightweight `{ type, actorId }` notice to the room after it succeeds - the
  socket event is a "something changed" signal, not the changed data
  itself, so there's one source of truth (the REST API) for what's
  actually current
- The client refetches the group immediately on receiving this notice, and
  shows a dismissable banner ("Bob added an expense") alongside it - the
  refetch is safe to do unprompted because add/edit form fields are their
  own local state, not derived from the fetched group data, so an
  in-progress form is never disturbed by it
- A user's own actions never trigger their own banner (the page already has
  the fresh data from the API response that caused the change)
- Auth happens in Socket.IO's handshake middleware (same JWT as the REST
  API) - a bad or missing token rejects the connection before it's ever
  established, rather than connecting and then disconnecting
- `initRealtime()` only runs from `index.js`'s real HTTP server, never
  under Jest/Supertest - `emitGroupActivity` is a safe no-op in every
  backend test

## 🔑 Password Reset

`POST /api/auth/forgot-password` and `POST /api/auth/reset-password`
(implemented in [`authController.js`](server/src/controllers/authController.js),
emailed via [`emailService.js`](server/src/services/emailService.js) and
[Resend](https://resend.com)):

- A raw reset token is emailed to the user and **never stored** - only its
  SHA-256 hash lives in the database, the same reasoning as hashing
  passwords: a database leak alone shouldn't hand out usable reset links
- Tokens expire after 1 hour and are single-use (marked spent in the same
  transaction that updates the password), so a reused or stale link fails
  with a generic "invalid or expired" error
- `forgot-password` always returns the same success message whether or not
  the email is registered - a different response would let anyone use the
  endpoint to check which emails have accounts
- If `RESEND_API_KEY` isn't set, the reset link is logged to the console
  instead of emailed - the endpoint still "succeeds" (no behavioral
  difference to detect), which is enough for local development without a
  Resend account
- Resetting or changing a password bumps the user's `tokenVersion` - see
  the Security section below for what that actually protects against

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
  participant. [`assertGroupMembers.js`](server/src/utils/assertGroupMembers.js)
  is the shared check, used by `createExpense`, `updateExpense`, and
  `createSettlement`.
- **Group members see name/username only, never email or account-creation
  date** - [`publicUser.js`](server/src/utils/publicUser.js) has two select
  shapes: `publicUserSelect` (with email) is only for the authenticated
  user's own account (`GET/PATCH /api/users/me`); every other nested user -
  group members, expense payers - uses `groupUserSelect` instead.
- **Settlements are validated against the actual balance, server-side** -
  `createSettlement` rejects an amount that's `<= 0`, exceeds what's
  currently owed between those two specific users
  (`balanceService.getBalanceBetweenUsers`, a direct pairwise total - not
  the debt-simplified group graph, which can route a person's debt through
  a third party), runs in the wrong direction, or names the requester as
  both parties. Partial settlements (paying off less than the full
  balance) are intentionally still allowed.
- **Sessions can actually be revoked** - JWTs carry a `tokenVersion` claim
  (`User.tokenVersion` in the schema) checked against the user's current
  value on every authenticated request, in both `requireAuth`
  ([`middleware/auth.js`](server/src/middleware/auth.js)) and the Socket.IO
  handshake ([`realtimeService.js`](server/src/services/realtimeService.js)).
  Changing or resetting a password increments it, which invalidates every
  token issued before that point - including one that leaked, which may be
  exactly why someone's resetting their password - rather than leaving it
  valid for the rest of its 7-day life. `changePassword` re-issues a fresh
  token in its response so the requester's own session survives; anyone
  else holding an older token doesn't.
- **Rate limiting, tuned per endpoint kind**
  ([`rateLimit.js`](server/src/middleware/rateLimit.js)): `signup`/`login`/
  `forgot-password` are capped at 10 requests/15min/IP (guards against
  credential stuffing and email enumeration). The Cohere-calling endpoints
  (expense creation/editing, natural-language parsing) sit behind
  `requireAuth`, but signup is public and free, so a per-IP limit alone
  wouldn't stop someone from registering a few accounts and hammering these
  from one machine anyway - they're limited per-IP *and* per-user on a
  short window, plus a per-user daily ceiling, to bound Cohere spend/load
  from a single account spread out over time too.
- **`app.set("trust proxy", 1)`** in `app.js` - without it, Express sees
  Caddy's own address on every request (the one reverse-proxying to it in
  production - see Deploying for real, below), not the real client's,
  which would turn the per-IP rate limits above into one shared limit for
  every visitor behind Caddy.
- **The production build is what actually ships** - AWS deploys
  `client/Dockerfile.prod` (a real `vite build`, served as static files),
  never `client/Dockerfile` (Vite's dev server, meant for local iteration
  only - its own `vite.config.js` has an `allowedHosts: true` setting that
  says as much). See Deploying for real, below, for the override that
  makes this happen.
- **Secrets aren't baked into the EC2 instance's user-data** - Cohere/
  Resend/JWT/Postgres/ZeroSSL secrets are SecureString parameters in SSM
  Parameter Store (`aws_ssm_parameter.secrets` in
  [`terraform/main.tf`](terraform/main.tf)), fetched by the instance
  itself at boot via a narrowly-scoped IAM policy - not templated
  directly into the boot script, which is otherwise readable in plaintext
  by anyone in the AWS account with `ec2:DescribeInstanceAttribute`
  permission (a wider audience than whoever can read Terraform state).
  Postgres also no longer uses the `docker-compose.yml` default
  (`postgres`/`postgres`) - its actual password is generated
  (`random_password.postgres_password`) the same way `JWT_SECRET` already
  was.
- **CI deploys via GitHub OIDC, not a stored AWS key** - see CI/CD, below.
- **A real Content-Security-Policy on the frontend** - set in Caddy
  (`terraform/user_data.sh.tpl`), not Helmet, because it's the
  browser-rendered static build that a CSP actually restricts, not the
  JSON API's responses. Scoped to what the app actually needs rather than
  loosened with `*`/`'unsafe-eval'`: `'unsafe-inline'` on `style-src` only
  (for `InsightsPanel`'s inline chart-bar styles), and an explicit
  `connect-src` entry for `api.splitfinance.org`'s HTTPS and WebSocket
  origin, since it's a separate domain from the frontend.
- **Password-reset URLs never reach production logs** -
  [`emailService.js`](server/src/services/emailService.js) only prints the
  raw reset link (which embeds the live token) when
  `NODE_ENV !== "production"`; the database itself only ever stores the
  token's SHA-256 hash, never the raw value.

## 🏗️ Architecture

```
splitfinance/
├── client/                React (Vite) + Tailwind CSS
├── server/                Node.js + Express + Prisma + PostgreSQL
├── terraform/             AWS EC2 deployment (alternative to Railway)
├── .github/workflows/     CI: test on every PR, deploy to AWS on merge
└── docker-compose.yml
```

### API Surface
21 REST endpoints across 7 resources (auth, users, groups, expenses,
settlements, insights, admin) - see `server/src/routes/`.

### Tech Stack
| Layer | Choice |
|---|---|
| Frontend | React (Vite), Tailwind CSS, React Router, Axios |
| Backend | Node.js, Express, Prisma ORM |
| Database | PostgreSQL |
| Auth | JWT + bcrypt |
| Email | Resend (password reset links) |
| Real-time | Socket.IO (live group activity notices) |
| AI | Cohere Chat API (expense auto-categorization, natural-language expense entry) |
| Testing | Jest + Supertest (backend), Vitest + React Testing Library (frontend) |
| Infra | Docker Compose, Caddy (reverse proxy + automatic HTTPS) |
| CI/CD | GitHub Actions (test on every PR, auto-deploy to AWS via SSM on merge) |

## 🚀 Getting Started

### Prerequisites
- Node.js 20+
- Docker & Docker Compose

### Setup
```bash
git clone https://github.com/rmeera-projs/splitfinance.git
cd splitfinance

# Start Postgres
docker-compose up -d db

# Backend
cd server
cp .env.example .env
npm install
npx prisma migrate dev --name init
npm run dev

# Frontend (in a new terminal)
cd client
cp .env.example .env
npm install
npm run dev
```

Backend runs on `http://localhost:5000`, frontend on `http://localhost:5173`.

#### Cohere API key (optional)
Auto-categorization and natural-language expense entry both need a
[Cohere](https://cohere.com) API key. Add it to `server/.env`:
```
COHERE_API_KEY="your-key-here"
```
This is optional — without it, every expense is categorized as `"Other"`
and natural-language entry falls back to a much cruder regex-only parse
(see [expenseParsingService.js](server/src/services/expenseParsingService.js)),
but everything else works normally. No key is needed to run the test
suite; the Cohere client is fully mocked in tests.

#### Resend API key (optional)
Password reset emails need a [Resend](https://resend.com) API key (free
tier, no domain verification required to start — their default
`onboarding@resend.dev` sender works immediately). Add it to `server/.env`:
```
RESEND_API_KEY="your-key-here"
```
This is optional — without it, `forgot-password` still responds
successfully (so it never leaks whether an email is registered), but the
reset link is only logged to the server's console instead of emailed,
which is enough to test the flow locally. No key is needed to run the test
suite; Resend is fully mocked in tests.

Once a domain is verified in Resend (Domains tab in its dashboard — add
the DKIM/SPF/MX records it gives you at your DNS provider), set
`RESEND_FROM_ADDRESS` too so emails send from that domain instead of the
shared `onboarding@resend.dev` testing address:
```
RESEND_FROM_ADDRESS="SplitFinance <noreply@yourdomain.com>"
```

### Run everything with Docker
```bash
docker-compose up --build
```
The `server` container reads its environment from `docker-compose.yml`, not
from `server/.env` — so to enable auto-categorization or real password
reset emails under Docker, put the keys in a `.env` file at the **repo
root** (not `server/.env`) instead:
```
COHERE_API_KEY="your-key-here"
RESEND_API_KEY="your-key-here"
RESEND_FROM_ADDRESS="SplitFinance <noreply@yourdomain.com>"
```
`docker-compose.yml` picks them up via
`${COHERE_API_KEY}`/`${RESEND_API_KEY}`/`${RESEND_FROM_ADDRESS}`
substitution. This root `.env` is git-ignored, same as `server/.env`.

## 🚢 Deploying for real
See [DEPLOYMENT.md](DEPLOYMENT.md) for a step-by-step Railway deployment (a
Postgres database, the API, and the frontend, each from this repo's own
Dockerfiles). Note that `client/Dockerfile.prod` - not the root
`client/Dockerfile`, which runs Vite's dev server - is what production
deploys should build.

Prefer to run it on your own AWS account instead? [`terraform/`](terraform/)
provisions a single free-tier-eligible EC2 instance that boots, installs
Docker, clones this repo, and runs `docker compose up --build` - no Railway
account needed. See the comments in `terraform/main.tf` and
`terraform/variables.tf` to get started (`terraform init`, `terraform plan
-out=tfplan`, `terraform apply "tfplan"`); `terraform destroy` tears it back
down. **This is what's actually running the live deploy** at
https://splitfinance.org.

A few things the AWS setup adds beyond the bare instance:
- **The real production build** - unlike local `docker-compose up` (which
  runs `client/Dockerfile`, Vite's dev server, for fast local iteration),
  the AWS deploy overrides the client service to build
  [`client/Dockerfile.prod`](client/Dockerfile.prod) instead: a real
  `vite build` served as static files by `serve`, on port 4173. Vite's dev
  server was never meant to be internet-facing (its own `vite.config.js`
  has an `allowedHosts: true` setting that says so directly) - shipping it
  to a public URL would have been a real vulnerability.
- **HTTPS via Caddy** - a Caddy reverse proxy container gets automatic
  Let's Encrypt certs for `domain_name`/`api_domain_name` (set in
  `terraform/variables.tf` or `terraform.tfvars`; default
  `splitfinance.org`/`api.splitfinance.org`) as long as their DNS A
  records already point at the instance's Elastic IP before it boots.
  The raw `http://<elastic-ip>:4173` / `:5000` URLs (this repo's
  `direct_app_url`/`direct_api_url` Terraform outputs) still work as a
  plaintext debugging fallback, e.g. during DNS cutover - but they're
  restricted to `allowed_ssh_cidr` in the security group, not open to the
  public internet, since anyone hitting them directly would be submitting
  login/signup credentials unencrypted.
- **A persistent Postgres volume** - database data lives on a separate
  EBS volume (`aws_ebs_volume.postgres_data`), not the instance's own
  root disk. This matters because `user_data_replace_on_change = true`
  means nearly any config change replaces the instance outright, which
  destroys its root volume - without a separate volume, that would
  silently wipe every user account on every `terraform apply`. The
  volume has `prevent_destroy` set, so removing it from config takes a
  deliberate extra step rather than an accidental `terraform apply`.

### CI/CD
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs backend and
frontend tests (plus a frontend build) on every push/PR to `main`. On a push
to `main`, once both test jobs pass, it also redeploys the AWS EC2 instance
automatically - via AWS Systems Manager, not SSH, since the instance's
security group intentionally only allows SSH from one trusted IP that a
GitHub-hosted runner could never match. Authenticates to AWS via GitHub
OIDC ([`terraform/github_oidc.tf`](terraform/github_oidc.tf)) rather than a
stored access-key secret - see
[DEPLOYMENT.md](DEPLOYMENT.md#continuous-deployment-via-github-actions-aws-only)
for details. Railway's own auto-deploy-on-push (see above) doesn't go
through this workflow at all.

## 🧪 Testing

219 tests total (134 backend, 85 frontend), with everything external mocked -
no live DB, no live Cohere calls, no Resend calls, no browser needed.

```bash
# Backend: 134 tests (Jest + Supertest), run against the real Express app
# with a mocked Prisma client, mocked categorizationService/
# expenseParsingService, and mocked emailService. A handful of these spin
# up a real (in-process, no external network) Socket.IO server + client to
# exercise realtimeService's auth and room logic directly.
cd server
npm test

# Frontend: 85 tests (Vitest + React Testing Library), with the API
# client, AuthContext, and the realtime socket mocked
cd client
npm test
```

## 📁 Data Model

7 tables:

```
users                  (id, name, username, email, password_hash, token_version, is_admin, created_at)
groups                 (id, name, created_by, is_finalized, created_at)
group_members          (group_id, user_id, joined_at)
expenses               (id, group_id, paid_by, amount, description, category, date, created_at)
expense_splits         (id, expense_id, user_id, amount_owed)
settlements            (id, group_id, from_user, to_user, amount, date, created_at)
password_reset_tokens  (id, user_id, token_hash, expires_at, used_at, created_at)
```

See `server/prisma/schema.prisma` for the full schema.

## 🗺️ Roadmap
- [x] WebSocket-based real-time updates
- [x] Natural-language expense entry - type "Dinner $60, I paid, split with
  Bob and Charlie" into a text box on the add-expense form and Cohere
  parses it into `{description, amount, payerId, splitWithIds}`, pre-filling
  the form for you to confirm (never submits on its own)
- [x] Choose who an expense splits between when adding it - a "Split
  between" checkbox list (defaulting to everyone) now applies to every
  split type, including "equal" - excluding someone no longer requires the
  exact/percentage workaround of leaving their amount blank
- [x] Admin dashboard - platform-wide counts (users, groups, expenses,
  settlements, total money moved) and a recent-signups/recent-groups
  glance, gated behind a `User.isAdmin` flag
- [ ] Settle up a custom (partial) amount - settling currently always pays
  off a balance in full; there's no way to record a partial payment toward
  what you owe someone
- [ ] Per-person balances on the dashboard - the main page currently only
  shows spending totals and a group list, with no rollup of how much you
  owe (or are owed by) each specific person across all your shared groups
- [ ] A conversational balances/insights assistant - ask "how much did I
  spend on food this month?" or "who do I owe the most right now?" in a
  chat box on the dashboard; a genuine tool-calling agent rather than a
  single completion, since it needs to decide which existing service
  (`getGroupBalances`, the insights aggregation utils, expense history) to
  query based on the question
- [ ] Smart settle-up nudges - reuse `simplifyDebts.js`'s output to
  proactively suggest who should settle up next, phrased in plain language
  ("Alice and Bob settling up clears 2 of the 3 outstanding debts") rather
  than just listing raw balances; would also give the "Email notifications"
  item below actual content worth sending instead of a plain transactional
  email
- [ ] Receipt OCR with multi-step line-item splitting - beyond just
  extracting a total, have a vision-capable model read individual line
  items off a photographed receipt and propose a per-item split ("shared
  appetizer split three ways, entrees individually?") for you to confirm or
  edit - extract → interpret → propose → confirm, a genuinely agentic flow
  rather than one completion
- [ ] Duplicate-expense detection - flag a newly-added expense that looks
  like an accidental double-entry of a recent one (similar description,
  amount, and date)
- [ ] Recurring expenses (rent, subscriptions)
- [ ] Email notifications on new expenses
- [x] Password reset flow
- [x] Rate limiting on auth endpoints - `signup`/`login`/`forgot-password`
  are capped at 10 requests/15min/IP via `express-rate-limit`
  ([rateLimit.js](server/src/middleware/rateLimit.js))
- [ ] Search/filter expenses within a group (by description, category, date
  range, or payer) - not needed with a handful of test expenses, but a real
  gap once a group's activity feed grows past a screenful
- [ ] Multi-currency support - right now every amount is an unlabeled
  number (implicitly one currency); real trips/roommate groups often mix
  currencies
- [ ] CSV export of a group's expenses and settlements - useful for
  record-keeping or reconciling outside the app

## 📄 License
MIT

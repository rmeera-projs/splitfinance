# SplitFinance - A Splitwise-Style Expense Sharing App

A full-stack expense-splitting application that lets groups of people track shared
expenses and settle up with the minimum number of payments.

## ✨ Features

- **Auth** — JWT-based signup/login with hashed passwords
- **Groups** — create groups, invite members by email, and add more members
  to a group after it's already been created
- **Expenses** — log, edit, or delete expenses (editor-only), with 3 ways to split
  a bill: equally, by percentage, or by exact amount
- **Auto-Categorization** — expenses are automatically tagged with one of 9 fixed
  categories using Cohere's Chat API
- **Balances** — real-time "who owes whom" view per group
- **Debt Simplification** — a graph-reduction algorithm that collapses a tangled
  web of IOUs into the minimum number of transactions needed to settle a group
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
  reopen, new member), with a one-click refresh rather than an unprompted
  page change

## 🧠 The Interesting Part: Debt Simplification

If Alice owes Bob $10, Bob owes Carol $10, and Carol owes Alice $10, naively
that's 3 transactions — but the net effect is **zero**. This app implements a
greedy min-cash-flow algorithm (`server/src/services/simplifyDebts.js`) that:

1. Computes each member's net balance (total owed − total owing)
2. Repeatedly matches the largest creditor with the largest debtor
3. Produces the minimum number of payments to settle the group

This turns an O(n²) worst-case payment graph into O(n) transactions.

## 🤖 Auto-Categorization with Cohere

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
  socket event is a "something changed, you may want to refresh" signal, not
  the changed data itself, so there's one source of truth (the REST API) for
  what's actually current
- The client shows this as a dismissable banner ("Bob added an expense -
  refresh to see it") rather than silently refetching - an unprompted data
  swap could yank an in-progress add/edit form out from under whoever's
  looking at the page
- A user's own actions never trigger their own banner (the page already has
  the fresh data from the API response that caused the change)
- Auth happens in Socket.IO's handshake middleware (same JWT as the REST
  API) - a bad or missing token rejects the connection before it's ever
  established, rather than connecting and then disconnecting
- `initRealtime()` only runs from `index.js`'s real HTTP server, never
  under Jest/Supertest - `emitGroupActivity` is a safe no-op in every
  backend test

## 🏗️ Architecture

```
splitfinance/
├── client/          React (Vite) + Tailwind CSS
├── server/          Node.js + Express + Prisma + PostgreSQL
└── docker-compose.yml
```

### API Surface
14 REST endpoints across 5 resources (auth, groups, expenses, settlements,
insights) - see `server/src/routes/`.

### Tech Stack
| Layer | Choice |
|---|---|
| Frontend | React (Vite), Tailwind CSS, React Router, Axios |
| Backend | Node.js, Express, Prisma ORM |
| Database | PostgreSQL |
| Auth | JWT + bcrypt |
| Real-time | Socket.IO (live group activity notices) |
| AI | Cohere Chat API (expense auto-categorization) |
| Testing | Jest + Supertest (backend), Vitest + React Testing Library (frontend) |
| Infra | Docker Compose |

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
Auto-categorization needs a [Cohere](https://cohere.com) API key. Add it to
`server/.env`:
```
COHERE_API_KEY="your-key-here"
```
This is optional — without it, every expense is categorized as `"Other"` and
everything else works normally. No key is needed to run the test suite; the
Cohere client is fully mocked in tests.

### Run everything with Docker
```bash
docker-compose up --build
```
The `server` container reads its environment from `docker-compose.yml`, not
from `server/.env` — so to enable auto-categorization under Docker, put the
key in a `.env` file at the **repo root** (not `server/.env`) instead:
```
COHERE_API_KEY="your-key-here"
```
`docker-compose.yml` picks it up via `${COHERE_API_KEY}` substitution. This
root `.env` is git-ignored, same as `server/.env`.

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
down.

## 🧪 Testing

100 tests total (50 backend, 50 frontend), with everything external mocked -
no live DB, no live Cohere calls, no browser needed.

```bash
# Backend: 50 tests (Jest + Supertest), run against the real Express app
# with a mocked Prisma client and a mocked categorizationService. A handful
# of these spin up a real (in-process, no external network) Socket.IO
# server + client to exercise realtimeService's auth and room logic directly.
cd server
npm test

# Frontend: 50 tests (Vitest + React Testing Library), with the API
# client, AuthContext, and the realtime socket mocked
cd client
npm test
```

## 📁 Data Model

6 tables:

```
users            (id, name, email, password_hash, created_at)
groups           (id, name, created_by, is_finalized, created_at)
group_members    (group_id, user_id, joined_at)
expenses         (id, group_id, paid_by, amount, description, category, date, created_at)
expense_splits   (id, expense_id, user_id, amount_owed)
settlements      (id, group_id, from_user, to_user, amount, date, created_at)
```

See `server/prisma/schema.prisma` for the full schema.

## 🗺️ Roadmap
- [x] WebSocket-based real-time updates
- [ ] Receipt OCR to auto-fill expense amounts
- [ ] Recurring expenses (rent, subscriptions)
- [ ] Email notifications on new expenses

## 📄 License
MIT

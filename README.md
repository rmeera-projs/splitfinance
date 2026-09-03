# SplitFinance - A Splitwise-Style Expense Sharing App

A full-stack expense-splitting application that lets groups of people track shared
expenses and settle up with the minimum number of payments.

## ✨ Features

- **Auth** — JWT-based signup/login with hashed passwords
- **Groups** — create groups, invite members by email
- **Expenses** — log, edit, or delete expenses (editor-only), split equally, by
  percentage, or by exact amount
- **Auto-Categorization** — expenses are automatically tagged with a category
  (Food & Drink, Groceries, Transportation, etc.) using Cohere's Chat API
- **Balances** — real-time "who owes whom" view per group
- **Debt Simplification** — a graph-reduction algorithm that collapses a tangled
  web of IOUs into the minimum number of transactions needed to settle a group
- **Settlements** — record payments between members, right from the balances view
- **Finalize / Reopen** — lock a group to stop new expenses once a trip/bill is
  done, without blocking settling up; any member can finalize or reopen
- **Activity Feed** — chronological log of expenses and settlements per group

## 🧠 The Interesting Part: Debt Simplification

If Alice owes Bob $10, Bob owes Carol $10, and Carol owes Alice $10, naively
that's 3 transactions — but the net effect is **zero**. This app implements a
greedy min-cash-flow algorithm (`server/src/services/simplifyDebts.js`) that:

1. Computes each member's net balance (total owed − total owing)
2. Repeatedly matches the largest creditor with the largest debtor
3. Produces the minimum number of payments to settle the group

This turns an O(n²) worst-case payment graph into O(n) transactions.

## 🤖 Auto-Categorization with Cohere

Every expense is automatically tagged with one of a fixed set of categories
(Food & Drink, Groceries, Transportation, Housing & Utilities, Entertainment,
Shopping, Travel, Health & Wellness, Other) so spending is queryable by kind
without any manual tagging. This is implemented in
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

## 🏗️ Architecture

```
splitfinance/
├── client/          React (Vite) + Tailwind CSS
├── server/          Node.js + Express + Prisma + PostgreSQL
└── docker-compose.yml
```

### Tech Stack
| Layer | Choice |
|---|---|
| Frontend | React (Vite), Tailwind CSS, React Router, Axios |
| Backend | Node.js, Express, Prisma ORM |
| Database | PostgreSQL |
| Auth | JWT + bcrypt |
| AI | Cohere Chat API (expense auto-categorization) |
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

## 📁 Data Model

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
- [ ] Frontend test coverage (no test framework wired up in `client/` yet)
- [ ] Manual category override (correct a bad auto-categorization by hand)
- [ ] Spending insights dashboard (charts by category/time) — the data model
      already supports this now that every expense carries a `category`
- [ ] WebSocket-based real-time updates
- [ ] Receipt OCR to auto-fill expense amounts
- [ ] Recurring expenses (rent, subscriptions)
- [ ] Email notifications on new expenses

## 📄 License
MIT

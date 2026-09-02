# SplitFinance — A Splitwise-Style Expense Sharing App

A full-stack expense-splitting application that lets groups of people track shared
expenses and settle up with the minimum number of payments.

## ✨ Features

- **Auth** — JWT-based signup/login with hashed passwords
- **Groups** — create groups, invite members by email
- **Expenses** — log expenses, split equally, by percentage, or by exact amount
- **Balances** — real-time "who owes whom" view per group
- **Debt Simplification** — a graph-reduction algorithm that collapses a tangled
  web of IOUs into the minimum number of transactions needed to settle a group
- **Settlements** — record payments between members
- **Activity Feed** — chronological log of expenses and settlements per group

## 🧠 The Interesting Part: Debt Simplification

If Alice owes Bob $10, Bob owes Carol $10, and Carol owes Alice $10, naively
that's 3 transactions — but the net effect is **zero**. This app implements a
greedy min-cash-flow algorithm (`server/src/services/simplifyDebts.js`) that:

1. Computes each member's net balance (total owed − total owing)
2. Repeatedly matches the largest creditor with the largest debtor
3. Produces the minimum number of payments to settle the group

This turns an O(n²) worst-case payment graph into O(n) transactions.

## 🏗️ Architecture

```
splitfinance/
├── client/          React (Vite) + Tailwind CSS
├── server/          Node.js + Express + Prisma + PostgreSQL
├── docker-compose.yml
└── .github/workflows/ci.yml
```

### Tech Stack
| Layer | Choice |
|---|---|
| Frontend | React (Vite), Tailwind CSS, React Router, Axios |
| Backend | Node.js, Express, Prisma ORM |
| Database | PostgreSQL |
| Auth | JWT + bcrypt |
| Infra | Docker Compose |
| CI | GitHub Actions (lint + test on PR) |

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

### Run everything with Docker
```bash
docker-compose up --build
```

## 📁 Data Model

```
users            (id, name, email, password_hash, created_at)
groups           (id, name, created_by, created_at)
group_members    (group_id, user_id, joined_at)
expenses         (id, group_id, paid_by, amount, description, date, created_at)
expense_splits   (id, expense_id, user_id, amount_owed)
settlements      (id, group_id, from_user, to_user, amount, date, created_at)
```

See `server/prisma/schema.prisma` for the full schema.

## 🗺️ Roadmap
- [ ] WebSocket-based real-time updates
- [ ] Receipt OCR to auto-fill expense amounts
- [ ] Spending insights dashboard (charts by category/time)
- [ ] Email notifications on new expenses

## 📄 License
MIT

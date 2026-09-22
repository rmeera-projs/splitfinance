## 🧪 Testing

See the main [README](../README.md) for the product overview.

612 tests across three layers, deliberately rather than incidentally: a
fast mocked layer for logic, a real-database layer for everything mocks
structurally can't prove, and a browser layer for the flows a user actually
performs.

| Layer | Count | What's real | What's mocked |
|---|---|---|---|
| Unit | 525 (302 backend, 223 frontend) | the Express app, React components | Prisma, Cohere, Resend, the socket |
| Integration | 70 | Postgres, Prisma, migrations, the whole request path | Cohere, Resend only |
| End-to-end | 17 | everything — real browser, real API, real database | nothing |

```bash
# Unit - fast, no Docker, no network. Runs on every save.
cd server && npm test        # 302 (Jest + Supertest, Prisma mocked)
cd client && npm test        # 223 (Vitest + React Testing Library)
```

**Integration** (`server/tests/integration/`) runs the real app against a
real PostgreSQL, with nothing about the data layer mocked. That's what
catches the class of bug the unit suite can't see by construction: wrong
Prisma query shapes, migrations drifting from the schema the code expects,
integer-cent storage and arithmetic, cascade deletes, unique constraints, and
balance arithmetic that only means anything against persisted rows. It also
applies the entire migration history forward and then reverses all of it
against a scratch database, which is the only thing that makes the down
migrations trustworthy (see [DATABASE.md](DATABASE.md#migrations)).

```bash
docker compose up -d db
cd server
createdb splitfinance_test   # or: docker compose exec db createdb -U postgres splitfinance_test
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/splitfinance_test" npm run test:integration:setup
npm run test:integration     # defaults to that same splitfinance_test database
```

**End-to-end** (`e2e/`) drives the real UI in Chromium via Playwright —
signup, login, creating a group, splitting an expense, settling up, search
and CSV export (a real file download), and the access control on the admin
page and the AI features. It runs against its own disposable stack
(`docker-compose.e2e.yml`: separate database, separate ports) so it never
touches local development data.

```bash
docker compose -f docker-compose.yml -f docker-compose.e2e.yml -p splitfinance-e2e up -d --build
cd e2e && npm install && npx playwright install chromium
npm test                     # 17 flows
npm run screenshots          # regenerates the README images from the live app
```

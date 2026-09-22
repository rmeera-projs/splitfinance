# Architecture

Package layout, tech stack, and how each subsystem is built. See the main [README](../README.md) for the product overview, or [SECURITY.md](SECURITY.md), [TESTING.md](TESTING.md) and [DATABASE.md](DATABASE.md) for those specifically.


```
splitfinance/
├── client/                React (Vite) + Tailwind CSS
├── server/                Node.js + Express + Prisma + PostgreSQL
├── terraform/             AWS EC2 deployment (alternative to Railway)
├── .github/workflows/     CI: test on every PR, deploy to AWS on merge

## API Surface
27 REST endpoints across 8 resources (auth, users, groups, expenses,
settlements, insights, admin, assistant) - see `server/src/routes/`.

## Tech Stack
| Layer | Choice |
|---|---|
| Frontend | React (Vite), Tailwind CSS, React Router, Axios |
| Backend | Node.js, Express, Prisma ORM |
| Database | PostgreSQL |
| Auth | JWT in an HttpOnly, SameSite=Lax cookie; bcrypt |
| Email | Resend (password reset links) |
| Real-time | Socket.IO (live group activity notices) |
| AI | Cohere (expense auto-categorization, natural-language entry, receipt vision, tool-calling assistant) |
| Testing | Jest + Supertest (backend), Vitest + React Testing Library (frontend) |
| Infra | Docker Compose, Caddy (reverse proxy + automatic HTTPS), CloudWatch Logs (security events) |
| CI/CD | GitHub Actions (lint, unit, integration and Playwright on every PR; auto-deploy to AWS via SSM when a merge touches the app) |


## 🤖 AI Features (Cohere)

### Auto-Categorization

Every expense is automatically tagged with one of 9 fixed categories (Food &
Drink, Groceries, Transportation, Housing & Utilities, Entertainment, Shopping,
Travel, Health & Wellness, Other) so spending is queryable by kind without any
manual tagging. This is implemented in
[`categorizationService.js`](../server/src/services/categorizationService.js):

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
— the app works fully without it. The same is true for an account that hasn't
confirmed its email address yet: categorization is skipped rather than the
expense being refused (see [SECURITY.md](SECURITY.md)).

### Natural-Language Expense Entry

The add-expense form has a text box above its regular fields for describing
an expense in plain English - "Dinner $60, I paid, split with Bob and
Charlie" - which
[`expenseParsingService.js`](../server/src/services/expenseParsingService.js)
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
- **Requires a confirmed email address** - this is the one endpoint whose
  entire purpose is the AI call, so it's also the only one that refuses
  outright (with a `code: "EMAIL_NOT_VERIFIED"` the client keys its
  "resend confirmation" prompt off). Adding an expense by hand is
  unaffected. See [SECURITY.md](SECURITY.md)

### Receipt Scanning

A "scan a receipt photo" link on the add-expense form uploads an image to
`POST /api/expenses/receipt`, where
[`receiptService.js`](../server/src/services/receiptService.js) sends it to a
Cohere vision model and gets back the merchant, the total and the line items:

- **Never creates the expense** - it pre-fills the form (and opens the
  per-item splitter), so a misread is something you correct before
  submitting, never a wrong charge
- **The upload path is deliberately narrow** - the first binary input in the
  app: memory storage with a 5MB cap, the file type decided from its leading
  bytes (JPEG/PNG/WebP) rather than its name, and the image is **never
  written to disk or the database**. A receipt can carry a card's last digits
  and a name, and the output is a few fields, so keeping it would only create
  something to leak
- **Line items are best-effort** - unusable ones (zero, negative,
  non-numeric, or costing more than the whole bill) are dropped and the count
  capped; a receipt with unreadable lines still yields a usable total
- **The per-item splitter is exact to the cent** -
  [`receiptSplit.js`](../client/src/utils/receiptSplit.js) splits each item among
  the people who had it, then spreads the rest (tax, tip, service charge, or a
  net discount) in proportion to what each person ordered. The rest is
  derived as "printed total minus items" rather than read off a scanned tax
  line, so the result reconciles to the total even when a line was missed, and
  leftover cents go by the largest-remainder method (BigInt for the products,
  which overflow a double at the largest amounts)
- Same gate as the other AI features: a confirmed email address and the
  shared rate limits, run before the upload is buffered. Without a key the
  route answers 503 and entering the expense by hand is unaffected

### Balances & Spending Assistant

A chat box on the dashboard, backed by `POST /api/assistant/ask` and
[`assistantService.js`](../server/src/services/assistantService.js) - a genuine
tool-calling agent (Cohere's v2 chat API) rather than a single completion:

- The model chooses among four read-only tools - `get_my_balances`,
  `list_my_groups`, `get_group_balances`, `get_my_spending` - each a thin
  wrapper over an existing, already-tested service, so the answers can't
  disagree with the balances and insights pages
- **No tool takes a user id.** Each closes over the authenticated caller, so
  there is no argument a prompt-injection payload sitting in an expense
  description could use to ask for someone else's data. The one unavoidable
  parameter, `groupId`, is checked against membership before any query runs
- Dollar figures are formatted to strings before the model sees them, and it
  is told to quote them verbatim rather than doing arithmetic
- The tool loop is capped at four rounds, the client resends the visible
  transcript (plain role/content pairs, length-capped; tool-call internals are
  never trusted from the client), and a tighter per-user limiter sits on top
  of the shared AI limits because one request can drive several model calls


## 📊 Spending Insights

Both `GroupPage` (one group's expenses, broken down by member) and the
dashboard (your own share of spending across every group you're in, broken
down by group) share one [`InsightsPanel`](../client/src/components/InsightsPanel.jsx)
component and one [aggregation utility](../client/src/utils/insights.js):

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
[Socket.IO](../server/src/services/realtimeService.js), without polling:

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
(implemented in [`authController.js`](../server/src/controllers/authController.js),
emailed via [`emailService.js`](../server/src/services/emailService.js) and
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
  [SECURITY.md](SECURITY.md) for what that actually protects against

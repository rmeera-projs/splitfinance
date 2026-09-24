# Changelog

Everything shipped so far, newest first. See the main [README](../README.md)
for what's next.

- [x] Try the demo - a "Try the demo" button on the login/signup pages
  (`POST /api/auth/demo`) creates a fresh, isolated sandbox account on the
  spot and logs the visitor straight in: its own two co-members, a seeded
  group, several categorized expenses, and one settlement, so there's
  something worth looking at immediately. Every visitor gets their own
  sandbox rather than sharing one fixed login, which sidesteps the usual
  shared-demo problems (one visitor's changes affecting another's, needing
  a published password, needing periodic manual reseeding). Deliberately
  not email-verified - `requireVerifiedEmail.js` exists because signup is
  already the cheap route to metered Cohere quota, and a demo account is
  cheaper still (no email needed at all), so pre-verifying it would reopen
  that hole rather than close it; the seeded expenses are pre-categorized
  so the categorization feature still has something to show. Expired
  sandboxes (`isDemo` on both `User` and `Group`) are swept up lazily on
  the next demo request rather than by a scheduled job, which needs no new
  infrastructure - the trade-off is that a sandbox nobody ever revisits
  outlives its age by however long it takes for the next visitor to arrive
- [x] Receipt scanning, stage two: splitting by item - when a scan reads the
  individual lines, a splitter opens showing each item with a checkbox per
  person (everyone ticked by default, since "shared" is right more often than
  a guess) and what each person would owe. Shared items split evenly; tax,
  tip and service charge are spread in proportion to what each person
  ordered rather than evenly, so the person with the steak carries more of
  the tip than the person with the salad. The arithmetic
  (`receiptSplit.js`) is exact to the cent: it derives the extras as
  "printed total minus items" rather than trusting a scanned tax line, so
  the result reconciles to the receipt total even when the scan missed a
  line, and uses the largest-remainder method (with BigInt for the
  intermediate products, which overflow a double at the largest amounts) to
  hand out leftover cents. Applying it fills the ordinary form as an exact
  split for you to review - it never submits by itself. Line items are
  best-effort: a receipt that only yields a total behaves as in stage one
- [x] Receipt scanning, stage one - a "scan a receipt photo" control on the
  add-expense form uploads a JPEG/PNG/WebP, a Cohere vision model reads the
  merchant and total, and the form is pre-filled for you to check (it never
  submits on its own). The first binary input in the app, so the upload path
  is deliberately narrow: memory storage with a 5MB cap, the file type
  decided from its leading bytes rather than its name or declared type, and
  the image is never written to disk or the database - a receipt can carry a
  card's last digits and a name, and the feature's whole output is two
  fields, so keeping it would only create something to leak. Gated like the
  other AI features (confirmed email, rate limits, limiters run before the
  upload is buffered)
- [x] A conversational balances/insights assistant - ask "how much did I
  spend on food this month?" or "who do I owe the most?" in a chat box on
  the dashboard. A genuine tool-calling agent (`assistantService.js`, the
  first user of Cohere's v2 chat API in this codebase) rather than a single
  completion, so the model decides which existing, already-tested service
  (`getUserBalances`, `getGroupBalances`, the spending aggregation) answers
  the question rather than being asked to compute anything itself - dollar
  figures are formatted to strings before the model ever sees them, and it's
  told to quote them verbatim rather than doing its own arithmetic. Every
  tool is read-only and none of them take a userId parameter; each closes
  over the authenticated caller's own id instead, so there's no argument a
  prompt-injection payload sitting in an expense description could use to
  ask for someone else's data - a groupId parameter is unavoidable, so
  every tool that takes one checks membership before running the query, the
  same boundary the rest of the app enforces at the route level
- [x] Security logs ship to CloudWatch - the structured JSON events from
  `securityLog.js` already went to the server container's stdout/stderr;
  now the Docker `awslogs` logging driver forwards that same output to a
  dedicated CloudWatch log group (`terraform/main.tf`'s
  `aws_cloudwatch_log_group.server_security`), authenticated via the
  instance's own IAM role rather than any embedded credential. "Every
  failed login for this address in the last hour" is now a query
  (`aws logs tail /splitfinance/server --follow`, or CloudWatch Logs
  Insights) instead of an SSH session and `docker compose logs`, and the
  events outlive instance replacement instead of vanishing with it
- [x] Search/filter expenses within a group - by description text, category,
  payer, and an inclusive date range, all combined as AND. Runs entirely
  client-side (`expenseFilters.js`) since the group page already has every
  expense loaded; balances and insights are deliberately left unfiltered, so
  narrowing the list can never make it look like someone owes less than they
  do
- [x] CSV export of a group's expenses and settlements - two files rather
  than one (`csvExport.js`), since folding a settlement's plain two-person
  transfer into the same rows as an expense's per-member split would mean
  either inventing an ambiguous sign convention or leaving most cells blank.
  The expenses file has one column per member showing their own split, so a
  column total is "what this person was charged" without reconstructing it
  by hand. Every field is escaped against CSV/spreadsheet formula injection -
  a description or member name starting with `=`, `+`, `-` or `@` would
  otherwise execute as a live formula the moment the file is opened in Excel
  or Sheets
- [x] Validation messages are worded for people, not zod's defaults -
  zod 4 renamed `ZodError.errors` to `.issues`, which was silently turning
  every validation failure into a 500 until `errorHandler.js` was updated.
  Taking the upgrade properly meant going further: zod's own default
  messages ("Too small: expected string to have >=8 characters") are written
  for developers, not the people reading them, and they were reworded
  wholesale between zod 3 and 4 - so leaving them in place meant a dependency
  bump could silently rewrite what a user sees on a failed signup. Every
  user-facing field now goes through `utils/validators.js`, which owns the
  wording once and stays put across future zod upgrades; an integration test
  drives a bad request at every validated endpoint and fails if any of
  zod's own phrasing leaks through
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
- [x] Settle up a custom (partial) amount - Settle up opens an amount field
  pre-filled with the full balance; editing it down records a partial
  payment. The API had accepted partial payments for a while, but nothing
  in the UI could send one
- [x] Per-person balances on the dashboard - what you owe and are owed by
  each person across all shared groups, netted across groups, with a
  per-group breakdown since settling still happens one group at a time
- [x] Move the session off `localStorage` into an HttpOnly cookie - the JWT
  was readable by any script on the page and replayable for its full 7-day
  life; it's now an HttpOnly, SameSite=Lax cookie the app can't see. Brought
  a logout endpoint with it (JavaScript can't delete a cookie it can't read)
  and a server-side session probe on load, since the client can no longer
  tell on its own whether it's signed in
- [x] Automatic rollback for database migrations - every migration now
  ships with a `down.sql`, the container entrypoint dumps the database
  before migrating and restores automatically if the migration fails, and
  `rollback-migration.sh` handles the harder case of a migration that
  succeeded and was wrong. See "Database migrations" above
- [x] Email verification - the AI features are gated on a confirmed
  address, since signing up is free and instant and throwaway accounts were
  the cheapest route to this project's metered Cohere quota. Everything
  else stays open to an unconfirmed account
- [x] Dependency scanning - `npm audit` on every change and weekly on a
  schedule, plus Dependabot upgrade PRs that run the full test suite
- [x] Security event logging - structured JSON events that escalate to a
  warning when the same thing keeps happening from the same source
- [x] Password reset flow
- [x] Rate limiting on auth endpoints - `signup`/`login`/`forgot-password`
  are capped at 10 requests/15min/IP via `express-rate-limit`
  ([rateLimit.js](../server/src/middleware/rateLimit.js))

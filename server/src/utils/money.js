// Money is integer cents everywhere inside this app - in the database
// (expenses.amount, expense_splits.amount_owed, settlements.amount are all
// INTEGER), over the API, and through every calculation. $10.23 is 1023.
//
// The reason is that binary floating point can't represent most decimal
// fractions exactly: 0.1 + 0.2 === 0.30000000000000004, so summing splits
// and comparing them against a total needed a "within a cent" tolerance to
// work at all - which in turn meant a split that genuinely didn't add up
// could pass validation. With integers the comparison is exact equality and
// the tolerance disappears.
//
// Dollars only exist at the edges: what a person types, what gets rendered,
// and what a language model hands back. Those cross the boundary through
// the helpers here.

// Parses a user- or LLM-supplied dollar amount into integer cents.
//
// Deliberately string-based rather than Math.round(value * 100): the
// multiplication is itself lossy for some values (1.005 * 100 is
// 100.49999999999999, which rounds to 100 rather than 101), and the whole
// point of this module is not to let that class of error in.
//
// Returns null for anything that isn't a well-formed non-negative amount
// with at most two decimal places, so callers can reject rather than
// silently coerce.
function parseAmountToCents(input) {
  if (input === null || input === undefined) return null;

  const raw = String(input).trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;

  const [whole, frac = ""] = raw.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

// Same, but for a value that's already a JavaScript number from a source we
// don't control (the Cohere parsing service). Rounds to the nearest cent
// rather than rejecting, since a model returning 60.499999 means $60.50.
function numberToCents(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

// Cents -> a plain decimal string for display ("1023" -> "10.23"). No
// currency symbol: the app is single-currency for now (see the README's
// roadmap) and callers add their own "$".
function formatCents(cents) {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

// Splits a total into n parts that are each whole cents and that sum to
// exactly the total. A three-way split of $60.50 is 6050 / 3 = 2016.67
// each, which no combination of equal integers can make - so the remainder
// (here 2 cents) is handed out one cent at a time to the earliest parts.
// Somebody has to absorb the odd cent; this makes it explicit and
// guarantees the parts reconcile against the total.
function splitEvenly(totalCents, n) {
  if (n <= 0) return [];
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

module.exports = { parseAmountToCents, numberToCents, formatCents, splitEvenly };

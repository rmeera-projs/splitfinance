// The API speaks integer cents - $10.23 is 1023 - so dollars exist in this
// app only at the two edges a person actually touches: what they type into
// a form, and what gets rendered on screen. Everything in between (state,
// requests, responses, arithmetic) is whole cents.
//
// Mirrors server/src/utils/money.js; the two are kept deliberately
// symmetric so a value converted on one side round-trips through the other.

// Parses what someone typed into integer cents. String-based rather than
// Math.round(value * 100), because that multiplication is itself lossy for
// some values (1.005 * 100 is 100.49999999999999, which rounds down to 100
// rather than up to 101).
//
// Returns null for anything that isn't a well-formed non-negative amount
// with at most two decimal places, so callers can show a validation error
// instead of silently coercing a typo into a number.
export function parseAmountToCents(input) {
  if (input === null || input === undefined) return null;

  const raw = String(input).trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;

  const [whole, frac = ""] = raw.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

// Cents to a plain decimal string: 1023 -> "10.23". No currency symbol -
// the app is single-currency for now, and callers add their own "$".
export function formatCents(cents) {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

// Cents back to an editable decimal string for prefilling a form field.
// Same output as formatCents; named separately because the intent differs
// (this value goes into an <input>, not onto the screen) and because a
// future currency-aware formatCents shouldn't change what lands in a field.
export function centsToInputValue(cents) {
  return formatCents(cents);
}

// Splits a total into n whole-cent parts that sum to exactly the total.
// $60.50 three ways is 2016.666... cents each, which no set of equal
// integers can make, so the leftover cents go one at a time to the earliest
// parts. Someone has to absorb the odd cent; doing it explicitly is what
// guarantees the splits reconcile against the total, which the API now
// requires exactly rather than within a cent.
export function splitEvenly(totalCents, n) {
  if (n <= 0) return [];
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

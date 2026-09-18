const { z } = require("zod");

// Letters, digits, underscores only - keeps it safe to display and to type
// into the "add member" field without any quoting/escaping concerns. Shared
// between signup and profile updates so both enforce the exact same rule.
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

// The largest value an Int column holds - amounts are integer cents, so this
// is $21,474,836.47. See utils/money.js.
const MAX_AMOUNT_CENTS = 2147483647;

// Field schemas with this app's own error wording.
//
// Validation messages go straight to users: the error handler joins them
// into the `error` field the client displays. zod's default messages are
// written for developers ("Too small: expected string to have >=8
// characters", "Invalid input: expected number, received string"), and
// they were reworded wholesale between zod 3 and 4 - so leaving them in
// place meant a dependency upgrade silently rewrote what people read.
// Every user-facing field is built here instead, so the wording is ours and
// stays put across upgrades.
//
// The `error` passed to the base type covers a missing or wrongly-typed
// value; the one passed to each check covers that check.

const username = () =>
  z
    .string({ error: "Username is required" })
    .regex(USERNAME_RE, "Username must be 3-20 characters: letters, numbers, and underscores only");

const email = () => z.email({ error: "Enter a valid email address" });

// `label` lets "Name", "Description" and friends share one definition.
const requiredText = (label) =>
  z.string({ error: `${label} is required` }).min(1, `${label} is required`);

const newPassword = (label = "Password") =>
  z.string({ error: `${label} is required` }).min(8, `${label} must be at least 8 characters`);

// Ids arrive from the app's own UI, so a bad one is a client bug rather
// than a user typo - but it should still read as a sentence.
const id = (label) => z.number({ error: `${label} must be a valid id` }).int(`${label} must be a valid id`);

const amountInCents = () =>
  z
    .number({ error: "Amount must be a number" })
    .int("Amounts must be given in whole cents")
    .positive("Amount must be greater than zero")
    .max(MAX_AMOUNT_CENTS, "Amount is too large");

module.exports = { USERNAME_RE, MAX_AMOUNT_CENTS, username, email, requiredText, newPassword, id, amountInCents };

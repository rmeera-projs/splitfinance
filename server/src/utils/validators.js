// Letters, digits, underscores only - keeps it safe to display and to type
// into the "add member" field without any quoting/escaping concerns. Shared
// between signup and profile updates so both enforce the exact same rule.
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

module.exports = { USERNAME_RE };

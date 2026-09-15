// Integration tests: the real Express app talking to a real PostgreSQL
// database through a real Prisma client. Nothing about the data layer is
// mocked, so these catch the whole class of bug the unit suite structurally
// can't - wrong Prisma query shapes, migrations that don't match the schema
// the code expects, Decimal/Number coercion, cascade behaviour, unique
// constraints, and transactions.
//
// Cohere and Resend stay mocked (see tests/integration/setup.js): those are
// third-party HTTP calls, not our persistence layer, and hitting them for
// real would make the suite slow, flaky, and billable.
//
// Requires a database - see the Testing section of the README.
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/integration/**/*.test.js"],
  setupFilesAfterEnv: ["<rootDir>/tests/integration/setup.js"],
  // A real database plus bcrypt hashing is slower than mocked unit tests,
  // and these run serially against one shared schema.
  testTimeout: 30000,
  maxWorkers: 1,
};

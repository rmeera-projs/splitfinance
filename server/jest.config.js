// Unit tests: everything under src/, with Prisma and the external services
// (Cohere, Resend) mocked. Fast, no Docker, no network - this is what runs
// on every save and as the first CI gate.
//
// The Postgres-backed integration suite lives in tests/integration and is
// deliberately excluded here; it needs a real database, so it has its own
// config (jest.integration.config.js) and its own npm script.
module.exports = {
  testEnvironment: "node",
  testPathIgnorePatterns: ["/node_modules/", "/tests/integration/"],
};

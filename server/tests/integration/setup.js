// Shared setup for the Postgres-backed integration suite.
//
// Deliberately does NOT mock ../config/prisma - that's the entire point of
// this suite. What it does mock is the two third-party HTTP integrations,
// which have nothing to do with persistence and would otherwise make every
// run slow, flaky, and chargeable.
process.env.JWT_SECRET = process.env.JWT_SECRET || "integration-test-secret";
process.env.NODE_ENV = "test";

// Defaults to a *separate* database from local development, so running the
// suite can never truncate the data you've been clicking around in. Set
// DATABASE_URL explicitly to point somewhere else (CI does). Assigned
// before the Prisma client below is required, since it reads the variable
// at construction time.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/splitfinance_test";

jest.mock("../../src/services/categorizationService", () => ({
  categorizeExpense: jest.fn().mockResolvedValue("Other"),
}));

jest.mock("../../src/services/expenseParsingService", () => ({
  parseExpenseText: jest.fn(),
}));

jest.mock("../../src/services/emailService", () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
}));

const prisma = require("../../src/config/prisma");

// Order matters: children before parents, since these are plain deletes
// rather than a TRUNCATE ... CASCADE. Runs before each test rather than
// after, so a failed test leaves its rows behind to inspect.
async function resetDatabase() {
  await prisma.expenseSplit.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.groupMember.deleteMany();
  await prisma.group.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.user.deleteMany();
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

module.exports = { resetDatabase };

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { PrismaClient } = require("@prisma/client");
const prisma = require("../../src/config/prisma");

// A down.sql that has never been executed is worse than not having one,
// because it will be trusted in the one situation where there is no time to
// check it. So these actually run every migration forward and then every
// down.sql back again, against a scratch database created and dropped here.
//
// Deliberately not the shared test database: applying and reversing the
// whole schema would destroy whatever the rest of the suite is using.

const MIGRATIONS_DIR = path.join(__dirname, "../../prisma/migrations");
const SCRATCH_DB = "splitfinance_migration_check";

// Reuse the configured connection, swapping only the database name, so this
// works unchanged against a local Docker Postgres and against the CI
// service container.
const BASE_URL = (process.env.DATABASE_URL || "").replace(/\?.*$/, "");
const SCRATCH_URL = BASE_URL.replace(/\/[^/]*$/, `/${SCRATCH_DB}`);

const migrations = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((name) => fs.statSync(path.join(MIGRATIONS_DIR, name)).isDirectory())
  // Prisma applies migrations in lexicographic order, which is why the
  // directories are timestamp-prefixed. Reversing that order is what makes
  // "roll everything back" well defined.
  .sort();

// The Prisma CLI is invoked as a plain Node script rather than through npx.
// npx on Windows is a .cmd shim, which Node will not spawn without
// shell: true - and passing arguments through a shell is both what Node
// deprecated and an injection risk. Resolving the CLI entry point sidesteps
// the shell entirely and behaves identically on Windows and on CI.
const PRISMA_CLI = require.resolve("prisma/build/index.js", {
  paths: [path.join(__dirname, "../..")],
});

// `prisma db execute` is used rather than psql so this needs no Postgres
// client binaries on the machine running the tests - the CLI is already a
// dependency, and it runs a multi-statement script as-is, which
// $executeRawUnsafe cannot.
function runSql(file) {
  execFileSync(process.execPath, [PRISMA_CLI, "db", "execute", "--url", SCRATCH_URL, "--file", file], {
    cwd: path.join(__dirname, "../.."),
    stdio: "pipe",
  });
}

function applyUp(name) {
  runSql(path.join(MIGRATIONS_DIR, name, "migration.sql"));
}

function applyDown(name) {
  runSql(path.join(MIGRATIONS_DIR, name, "down.sql"));
}

let scratch;

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
  await prisma.$executeRawUnsafe(`CREATE DATABASE "${SCRATCH_DB}"`);
  scratch = new PrismaClient({ datasourceUrl: SCRATCH_URL });
}, 60000);

afterAll(async () => {
  if (scratch) await scratch.$disconnect();
  await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
}, 60000);

// The shared setup truncates tables before every test; there is nothing in
// this file that wants that, and the scratch database is separate anyway.
beforeEach(() => {});

async function tableNames() {
  const rows = await scratch.$queryRawUnsafe(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
  );
  return rows.map((r) => r.tablename);
}

async function columnType(table, column) {
  const rows = await scratch.$queryRawUnsafe(
    "SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = $2",
    table,
    column
  );
  return rows[0]?.data_type ?? null;
}

describe("every migration is reversible", () => {
  test(
    "applies the full history forward and then reverses all of it",
    async () => {
      for (const name of migrations) applyUp(name);

      const afterUp = await tableNames();
      expect(afterUp).toEqual(expect.arrayContaining(["users", "groups", "expenses", "settlements"]));

      // In reverse, which is the only order a rollback can happen in - a
      // down.sql may depend on tables a later migration has not dropped yet.
      for (const name of [...migrations].reverse()) applyDown(name);

      // Nothing of the application schema should be left. _prisma_migrations
      // is not created here (these scripts run directly, not through
      // `migrate deploy`), so the expectation is genuinely empty.
      expect(await tableNames()).toEqual([]);
    },
    300000
  );
});

describe("the integer-cents migration specifically", () => {
  // The one down migration with real arithmetic in it rather than a DROP.
  // Worth its own test because a rounding error here would silently
  // misstate what people owe each other, which is the whole product.
  test(
    "converts money back to decimal without losing a cent",
    async () => {
      for (const name of migrations) applyUp(name);

      expect(await columnType("expenses", "amount")).toBe("integer");

      await scratch.$executeRawUnsafe(
        `INSERT INTO users (id, name, username, email, password_hash) VALUES
           (1, 'Alice', 'alice', 'alice@example.com', 'x'),
           (2, 'Bob', 'bob', 'bob@example.com', 'x')`
      );
      await scratch.$executeRawUnsafe(`INSERT INTO groups (id, name, created_by) VALUES (1, 'Trip', 1)`);
      // Deliberately awkward values: an odd number of cents, a lone cent,
      // and a whole-dollar amount whose decimal form has trailing zeros.
      await scratch.$executeRawUnsafe(
        `INSERT INTO expenses (id, group_id, paid_by, amount, description) VALUES
           (1, 1, 1, 1023, 'Lunch'),
           (2, 1, 2, 1, 'A single cent'),
           (3, 1, 1, 100000, 'A thousand dollars')`
      );

      applyDown("20260916010000_add_email_verification");
      applyDown("20260916000000_money_as_integer_cents");

      expect(await columnType("expenses", "amount")).toBe("numeric");
      const afterDown = await scratch.$queryRawUnsafe("SELECT id, amount::text FROM expenses ORDER BY id");
      expect(afterDown.map((r) => r.amount)).toEqual(["10.23", "0.01", "1000.00"]);

      // And forward again - a rollback is usually followed by a fix and a
      // retry, so the round trip is what actually has to hold.
      applyUp("20260916000000_money_as_integer_cents");

      const afterUp = await scratch.$queryRawUnsafe("SELECT id, amount FROM expenses ORDER BY id");
      expect(afterUp.map((r) => r.amount)).toEqual([1023, 1, 100000]);
    },
    300000
  );
});

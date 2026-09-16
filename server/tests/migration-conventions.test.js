const fs = require("fs");
const path = require("path");

// The rule that makes the rollback tooling mean anything: every migration
// ships with a way back. This is the fast check - it only reads the
// filesystem, so a new migration without a down.sql fails in the first CI
// job rather than in the slower database-backed one. Whether those down
// migrations actually work is proven separately, in
// tests/integration/migrations.test.js.

const MIGRATIONS_DIR = path.join(__dirname, "../prisma/migrations");

const migrations = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((name) => fs.statSync(path.join(MIGRATIONS_DIR, name)).isDirectory());

test("there are migrations to check", () => {
  // Guards against the glob silently matching nothing and every assertion
  // below vacuously passing.
  expect(migrations.length).toBeGreaterThan(0);
});

describe.each(migrations)("%s", (name) => {
  const dir = path.join(MIGRATIONS_DIR, name);

  test("has a forward migration", () => {
    expect(fs.existsSync(path.join(dir, "migration.sql"))).toBe(true);
  });

  // No allowlist of pre-convention migrations on purpose. An exception list
  // is the thing that grows, and "most migrations can be rolled back" is not
  // a property anyone can rely on at the moment they need it.
  test("has a down migration", () => {
    const down = path.join(dir, "down.sql");
    expect(fs.existsSync(down)).toBe(true);

    // A file containing only comments would pass an existence check while
    // doing nothing at all.
    const statements = fs
      .readFileSync(down, "utf8")
      .split("\n")
      .filter((line) => line.trim() && !line.trim().startsWith("--"));
    expect(statements.length).toBeGreaterThan(0);
  });

  // Every down.sql here documents whether reversing it loses anything, and
  // that note is the first thing read when deciding between --down and a
  // full restore. Cheap to check, and easy to forget when writing one.
  test("says whether rolling it back is lossy", () => {
    const down = fs.readFileSync(path.join(dir, "down.sql"), "utf8");
    expect(down).toMatch(/LOSSY|DESTRUCTIVE|Not lossy|Safe in practice|No lasting data loss/);
  });
});

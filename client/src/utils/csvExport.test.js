import { describe, test, expect } from "vitest";
import { buildExpensesCsv, buildSettlementsCsv, slugifyForFilename } from "./csvExport";

const ALICE = { id: 1, name: "Alice" };
const BOB = { id: 2, name: "Bob" };

function group(overrides = {}) {
  return {
    name: "Ski Trip",
    members: [{ user: ALICE }, { user: BOB }],
    expenses: [],
    settlements: [],
    ...overrides,
  };
}

// Splits each line on the real CSV delimiter rather than re-parsing quoting
// rules by hand - these tests care about field values, not escaping detail,
// which the dedicated escaping tests below cover directly.
function lines(csv) {
  // Strip the BOM and the trailing CRLF the file always ends with.
  return csv.replace(/^\uFEFF/, "").replace(/\r\n$/, "").split("\r\n");
}

function unquote(field) {
  return field.slice(1, -1).replace(/""/g, '"');
}

describe("buildExpensesCsv", () => {
  test("has a column per member, alongside the standard fields", () => {
    const csv = buildExpensesCsv(group());
    expect(lines(csv)[0]).toBe('"Date","Description","Category","Total Amount","Paid By","Alice","Bob"');
  });

  test("puts each member's own split in their own column, blank if they weren't in it", () => {
    const csv = buildExpensesCsv(
      group({
        expenses: [
          {
            date: "2026-09-01T12:00:00.000Z",
            description: "Lift passes",
            category: "Entertainment",
            amount: 12000,
            payer: ALICE,
            splits: [{ userId: ALICE.id, amountOwed: 6000 }],
          },
        ],
      })
    );

    const row = lines(csv)[1].split(",").map(unquote);
    // Date, Description, Category, Total, Paid By, Alice, Bob
    expect(row).toEqual(["2026-09-01", "Lift passes", "Entertainment", "120.00", "Alice", "60.00", ""]);
  });

  test("one row per expense, in the order given", () => {
    const csv = buildExpensesCsv(
      group({
        expenses: [
          { date: "2026-09-01T12:00:00.000Z", description: "A", category: "Other", amount: 100, payer: ALICE, splits: [] },
          { date: "2026-09-02T12:00:00.000Z", description: "B", category: "Other", amount: 200, payer: BOB, splits: [] },
        ],
      })
    );

    expect(lines(csv)).toHaveLength(3); // header + 2 rows
    expect(lines(csv)[1]).toContain('"A"');
    expect(lines(csv)[2]).toContain('"B"');
  });

  test("starts with a UTF-8 BOM so Excel renders non-ASCII names correctly", () => {
    expect(buildExpensesCsv(group())).toMatch(/^\uFEFF/);
  });
});

describe("buildSettlementsCsv", () => {
  test("resolves fromUser/toUser ids to member names", () => {
    const csv = buildSettlementsCsv(
      group({ settlements: [{ date: "2026-09-03T12:00:00.000Z", fromUser: BOB.id, toUser: ALICE.id, amount: 4500 }] })
    );

    expect(lines(csv)).toEqual(['"Date","From","To","Amount"', '"2026-09-03","Bob","Alice","45.00"']);
  });

  test("falls back to a generic label for a settlement naming someone no longer a member", () => {
    const csv = buildSettlementsCsv(
      group({ settlements: [{ date: "2026-09-03T12:00:00.000Z", fromUser: 999, toUser: ALICE.id, amount: 100 }] })
    );

    expect(lines(csv)[1]).toContain('"User 999"');
  });
});

describe("CSV formula injection", () => {
  // The classic attack: a description of "=HYPERLINK(...)" becomes a live
  // formula the instant the export is opened in Excel or Sheets - not
  // merely displayed as text. Each dangerous leading character gets its own
  // case since spreadsheet programs treat all four as formula triggers.
  test.each(["=cmd|'/c calc'!A1", "+1+1", "-2+3", "@SUM(A1:A9)"])(
    "neutralizes a description starting with %j",
    (malicious) => {
      const csv = buildExpensesCsv(
        group({
          expenses: [
            {
              date: "2026-09-01T12:00:00.000Z",
              description: malicious,
              category: "Other",
              amount: 100,
              payer: ALICE,
              splits: [],
            },
          ],
        })
      );

      const field = unquote(lines(csv)[1].split(",")[1]);
      expect(field).toBe(`'${malicious}`);
      // The literal text survives (prefixed), rather than being stripped -
      // this is a display-safety fix, not a content filter.
      expect(field).toContain(malicious);
    }
  );

  test("leaves an ordinary description starting with a similar-looking character alone", () => {
    // A minus sign inside the text, not at the start, is never dangerous.
    const csv = buildExpensesCsv(
      group({
        expenses: [
          { date: "2026-09-01T12:00:00.000Z", description: "Coffee - 2 cups", category: "Other", amount: 500, payer: ALICE, splits: [] },
        ],
      })
    );

    expect(unquote(lines(csv)[1].split(",")[1])).toBe("Coffee - 2 cups");
  });

  test("escapes a description containing a comma and an embedded quote", () => {
    const csv = buildExpensesCsv(
      group({
        expenses: [
          {
            date: "2026-09-01T12:00:00.000Z",
            description: 'Dinner, "the good place"',
            category: "Other",
            amount: 500,
            payer: ALICE,
            splits: [],
          },
        ],
      })
    );

    // The raw line has the doubled quote and the comma inside one quoted
    // field - splitting naively on "," would wrongly see two fields, which
    // is exactly why this asserts on the raw text rather than using the
    // split-based `lines()` helper for this one case.
    expect(lines(csv)[1]).toContain('"Dinner, ""the good place"""');
  });

  // A member's own name is exactly as much user-controlled text as an
  // expense description (chosen at signup, no charset restriction), and it
  // ends up as a CSV header - so it needs the same protection.
  test("also protects a member name used as a column header", () => {
    const evilMember = { id: 3, name: "=cmd|'/c calc'!A1" };
    const csv = buildExpensesCsv(group({ members: [{ user: ALICE }, { user: evilMember }] }));

    expect(unquote(lines(csv)[0].split(",")[6])).toBe(`'${evilMember.name}`);
  });
});

describe("slugifyForFilename", () => {
  test("replaces spaces with hyphens", () => {
    expect(slugifyForFilename("Ski Trip 2026")).toBe("Ski-Trip-2026");
  });

  test("strips characters that are invalid in a filename on Windows/macOS/Linux", () => {
    expect(slugifyForFilename('Trip: "Vegas" / Fun?')).toBe("Trip-Vegas-Fun");
  });

  test("falls back to a generic name when nothing usable is left", () => {
    expect(slugifyForFilename('///???')).toBe("group");
  });
});

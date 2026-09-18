// Building a group's expenses and settlements into CSV files, for
// "record-keeping or reconciling outside the app".
//
// Two files rather than one. Cramming both into a single sheet means either
// inventing a sign convention for how a settlement (a plain transfer between
// two people) sits next to an expense (a cost split across several people),
// or leaving most cells blank depending on the row type - neither reads
// cleanly in a spreadsheet. Splitwise's own export makes the same call.
// Expenses get one column per group member showing that member's split, so
// a column total is "what this person was charged" without the reader
// having to reconstruct it from a shared "amount" column by hand.
//
// Pure and framework-free like expenseFilters.js, for the same reason: the
// page already has everything in `group`, so this runs entirely client-side
// with no new endpoint.

import { formatCents } from "./money";
import { localDateKey } from "./expenseFilters";

// A field that begins with =, +, - or @ is interpreted as a formula by
// Excel and Google Sheets, not as literal text - the classic CSV/spreadsheet
// injection vector (e.g. a description of `=HYPERLINK("http://evil","x")`
// silently becomes a live, clickable link when the export is opened). Every
// field here is quoted regardless of content, but quoting alone does not
// stop this - a quoted formula is still a formula to the spreadsheet
// program. Prefixing a bare apostrophe is the standard mitigation: it makes
// the leading character part of the text, not a formula trigger, at the
// cost of one visible apostrophe if a cell is later edited in place.
const FORMULA_PREFIX = /^[=+\-@]/;

function csvField(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  // RFC 4180: double any embedded quote, then wrap the whole field in
  // quotes. Applied unconditionally rather than only when a comma/quote/
  // newline is present - a name or description here is free-form user text,
  // and always quoting is one fewer case to get wrong.
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRow(fields) {
  return fields.map(csvField).join(",");
}

// \r\n per RFC 4180; Excel on Windows treats a bare \n export as one long
// line in some locales. A leading UTF-8 BOM is what makes Excel render
// accented or non-Latin names correctly instead of as mojibake - a plain
// CSV with no BOM is assumed Latin-1 by Excel regardless of its actual
// encoding.
function toCsv(rows) {
  return String.fromCharCode(0xfeff) + rows.map(csvRow).join("\r\n") + "\r\n";
}

// One row per expense, with a column per member for their individual split
// (blank when that member wasn't part of it) rather than folding the split
// into a single ambiguous "amount" column.
export function buildExpensesCsv(group) {
  const members = group.members.map((m) => m.user);
  const header = ["Date", "Description", "Category", "Total Amount", "Paid By", ...members.map((m) => m.name)];

  const rows = group.expenses.map((exp) => {
    const splitByUser = new Map(exp.splits.map((s) => [s.userId, s.amountOwed]));
    return [
      localDateKey(exp.date),
      exp.description,
      exp.category || "",
      formatCents(exp.amount),
      exp.payer.name,
      ...members.map((m) => (splitByUser.has(m.id) ? formatCents(splitByUser.get(m.id)) : "")),
    ];
  });

  return toCsv([header, ...rows]);
}

// Settlements only ever have two parties, so a wide per-member layout would
// be mostly empty cells - a plain From/To/Amount ledger is what a
// reconciler actually wants here.
export function buildSettlementsCsv(group) {
  const nameById = new Map(group.members.map((m) => [m.user.id, m.user.name]));
  const header = ["Date", "From", "To", "Amount"];

  const rows = group.settlements.map((s) => [
    localDateKey(s.date),
    nameById.get(s.fromUser) || `User ${s.fromUser}`,
    nameById.get(s.toUser) || `User ${s.toUser}`,
    formatCents(s.amount),
  ]);

  return toCsv([header, ...rows]);
}

// Keeps a downloaded filename readable and safe across filesystems: strips
// characters Windows/macOS/Linux all reject in a filename, collapses
// whitespace, and falls back to a generic name for a group whose name is
// nothing but such characters (an empty filename is worse than a generic
// one).
export function slugifyForFilename(name) {
  const cleaned = name
    .replace(/[/\\?%*:|"<>]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return cleaned || "group";
}

// Triggers a real browser download via a throwaway <a download> element -
// the standard client-side pattern for turning an in-memory string into a
// file the user's browser saves, no server round trip needed. Kept as its
// own function so the pure CSV-building above can be unit tested without a
// DOM, and this thin, hard-to-unit-test sliver is the only part an e2e test
// has to cover.
export function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportGroupCsvs(group) {
  const slug = slugifyForFilename(group.name);
  downloadCsv(`${slug}-expenses.csv`, buildExpensesCsv(group));
  downloadCsv(`${slug}-settlements.csv`, buildSettlementsCsv(group));
}

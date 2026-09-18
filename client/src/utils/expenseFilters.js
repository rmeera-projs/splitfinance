// Filtering a group's expense list, kept pure so it can be tested apart from
// the page.
//
// This runs in the browser because GET /api/groups/:id already returns every
// expense in the group, so filtering is instant and needs no new endpoint.
// If groups ever grow large enough that loading every expense is the
// problem, the answer is server-side pagination - at which point this moves
// server-side with it.

export const EMPTY_FILTERS = { text: "", category: "", payerId: "", from: "", to: "" };

export function hasActiveFilters(filters) {
  return Object.keys(EMPTY_FILTERS).some((key) => filters[key] !== EMPTY_FILTERS[key]);
}

const pad = (n) => String(n).padStart(2, "0");

// The calendar date an expense falls on *for the person looking at it*, as
// YYYY-MM-DD - the same shape an <input type="date"> produces.
//
// Deliberately not `date.slice(0, 10)`. Expense dates are stored as UTC
// timestamps, so that would use the UTC calendar date: an expense logged at
// 9pm in New York is already the next day in UTC, and filtering "up to
// today" would silently drop it. Using local date parts puts every expense
// on the day its viewer would say it happened.
export function localDateKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function filterExpenses(expenses, filters) {
  const text = filters.text.trim().toLowerCase();
  const payerId = filters.payerId === "" ? null : Number(filters.payerId);

  return expenses.filter((exp) => {
    if (text && !exp.description.toLowerCase().includes(text)) return false;
    if (filters.category && exp.category !== filters.category) return false;
    if (payerId !== null && exp.payer.id !== payerId) return false;

    // Both ends inclusive: "from the 1st to the 31st" includes both days.
    // Compared as YYYY-MM-DD strings, which order the same way the dates do.
    if (filters.from || filters.to) {
      const day = localDateKey(exp.date);
      if (filters.from && day < filters.from) return false;
      if (filters.to && day > filters.to) return false;
    }
    return true;
  });
}

import { describe, test, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InsightsPanel from "./InsightsPanel";

const items = [
  { amount: 10, category: "Food & Drink", date: "2026-01-05", payer: "Alice" },
  { amount: 20, category: "Travel", date: "2026-02-10", payer: "Bob" },
  { amount: 5, category: "Food & Drink", date: "2026-02-15", payer: "Alice" },
];

// Category totals: Food & Drink=15, Travel=20.
// Member totals: Alice=15, Bob=20.
// Month totals: Jan 2026=10, Feb 2026=25.

function section(headingText) {
  // The "Over Time" heading sits one level deeper (alongside the
  // granularity toggle) than the other two headings, so climb to the
  // column's direct-child-of-grid ancestor rather than the nearest div.
  return within(screen.getByText(headingText).closest(".grid > div"));
}

describe("InsightsPanel", () => {
  test("shows a message instead of charts when there are no items", () => {
    render(<InsightsPanel items={[]} dimensionLabel="Member" dimension={(i) => i.payer} />);
    expect(screen.getByText(/no expenses yet/i)).toBeInTheDocument();
  });

  test("renders the category breakdown with totals", () => {
    render(<InsightsPanel items={items} dimensionLabel="Member" dimension={(i) => i.payer} />);

    const category = section("By Category");
    expect(category.getByText("Food & Drink")).toBeInTheDocument();
    expect(category.getByText("Travel")).toBeInTheDocument();
    expect(category.getByText("$15.00")).toBeInTheDocument();
    expect(category.getByText("$20.00")).toBeInTheDocument();
  });

  test("renders the custom dimension breakdown (e.g. by member) with totals", () => {
    render(<InsightsPanel items={items} dimensionLabel="Member" dimension={(i) => i.payer} />);

    const member = section("By Member");
    expect(member.getByText("Alice")).toBeInTheDocument();
    expect(member.getByText("Bob")).toBeInTheDocument();
    expect(member.getByText("$15.00")).toBeInTheDocument();
    expect(member.getByText("$20.00")).toBeInTheDocument();
  });

  test("defaults the time breakdown to monthly buckets", () => {
    render(<InsightsPanel items={items} dimensionLabel="Member" dimension={(i) => i.payer} />);

    const time = section("Over Time");
    expect(time.getByText("Jan 2026")).toBeInTheDocument();
    expect(time.getByText("Feb 2026")).toBeInTheDocument();
    expect(time.getByText("$10.00")).toBeInTheDocument();
    expect(time.getByText("$25.00")).toBeInTheDocument();
  });

  test("switches the time breakdown when a granularity button is clicked", async () => {
    const user = userEvent.setup();
    render(<InsightsPanel items={items} dimensionLabel="Member" dimension={(i) => i.payer} />);

    await user.click(screen.getByRole("button", { name: "day" }));

    const time = section("Over Time");
    expect(time.getByText("Jan 5")).toBeInTheDocument();
    expect(time.getByText("Feb 10")).toBeInTheDocument();
    expect(time.getByText("Feb 15")).toBeInTheDocument();
    expect(time.queryByText("Jan 2026")).not.toBeInTheDocument();
  });
});

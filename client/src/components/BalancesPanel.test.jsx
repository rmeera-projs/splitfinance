import { describe, test, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BalancesPanel from "./BalancesPanel";

function renderPanel(balances) {
  return render(
    <MemoryRouter>
      <BalancesPanel balances={balances} />
    </MemoryRouter>
  );
}

const person = (id, name, net, groups) => ({ user: { id, name, username: name.toLowerCase() }, net, groups });

describe("BalancesPanel", () => {
  test("renders nothing before balances have loaded", () => {
    const { container } = renderPanel(null);
    expect(container).toBeEmptyDOMElement();
  });

  test("says so when there is nothing owed either way", () => {
    renderPanel({ totalOwedToYou: 0, totalYouOwe: 0, people: [] });
    expect(screen.getByText(/all settled up with everyone/i)).toBeInTheDocument();
  });

  test("shows the totals owed in each direction", () => {
    renderPanel({
      totalOwedToYou: 2500,
      totalYouOwe: 700,
      people: [
        person(2, "Bob", 2500, [{ id: 1, name: "Trip", amount: 2500 }]),
        person(3, "Carol", -700, [{ id: 1, name: "Trip", amount: -700 }]),
      ],
    });

    expect(screen.getByText("$25.00")).toBeInTheDocument();
    expect(screen.getByText("$7.00")).toBeInTheDocument();
  });

  // The sign convention is the thing most likely to be got backwards, and
  // getting it backwards tells people they're owed money they actually owe.
  test("words a positive net as owed to you and a negative one as owed by you", () => {
    renderPanel({
      totalOwedToYou: 2500,
      totalYouOwe: 700,
      people: [
        person(2, "Bob", 2500, [{ id: 1, name: "Trip", amount: 2500 }]),
        person(3, "Carol", -700, [{ id: 1, name: "Trip", amount: -700 }]),
      ],
    });

    expect(screen.getByText(/owes you \$25\.00/)).toBeInTheDocument();
    expect(screen.getByText(/you owe \$7\.00/)).toBeInTheDocument();
  });

  test("links to the group where the balance can be settled", () => {
    renderPanel({
      totalOwedToYou: 2500,
      totalYouOwe: 0,
      people: [person(2, "Bob", 2500, [{ id: 7, name: "Trip", amount: 2500 }])],
    });

    expect(screen.getByRole("link", { name: "Trip" })).toHaveAttribute("href", "/groups/7");
  });

  // Settling happens per group, so a net figure spanning several groups is
  // only half the answer - the breakdown is what says where to go.
  test("breaks a multi-group balance down by group", () => {
    renderPanel({
      totalOwedToYou: 1500,
      totalYouOwe: 0,
      people: [
        person(2, "Bob", 1500, [
          { id: 1, name: "Trip", amount: 2500 },
          { id: 2, name: "Flat", amount: -1000 },
        ]),
      ],
    });

    const row = screen.getByText("Bob").closest("li");
    expect(within(row).getByText(/owes you \$15\.00/)).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Trip" })).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Flat" })).toBeInTheDocument();
    expect(within(row).getByText(/you owe \$10\.00/)).toBeInTheDocument();
  });

  // Even overall still leaves two balances to clear, one per group.
  test("shows the breakdown for someone you are even with overall", () => {
    renderPanel({
      totalOwedToYou: 0,
      totalYouOwe: 0,
      people: [
        person(2, "Bob", 0, [
          { id: 1, name: "Trip", amount: 1000 },
          { id: 2, name: "Flat", amount: -1000 },
        ]),
      ],
    });

    expect(screen.getByText(/even overall/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Trip" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Flat" })).toBeInTheDocument();
  });
});

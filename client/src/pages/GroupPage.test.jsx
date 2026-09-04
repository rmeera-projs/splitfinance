import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import GroupPage from "./GroupPage";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useParams: () => ({ id: "7" }) };
});

const ME = { id: 1, name: "Alice" };
const OTHER = { id: 2, name: "Bob" };

function baseGroup(overrides = {}) {
  return {
    id: 7,
    name: "Ski Trip",
    isFinalized: false,
    members: [{ user: ME }, { user: OTHER }],
    balances: [],
    expenses: [],
    ...overrides,
  };
}

function renderGroupPage() {
  return render(
    <MemoryRouter>
      <GroupPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ user: ME });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

describe("GroupPage - rendering", () => {
  test("shows balances, the category badge, and the group name", async () => {
    api.get.mockResolvedValue({
      data: baseGroup({
        balances: [{ from: OTHER.id, to: ME.id, amount: 10 }],
        expenses: [
          {
            id: 1,
            payer: ME,
            amount: "20",
            description: "Dinner at Chipotle",
            category: "Food & Drink",
            splits: [{ userId: ME.id, amountOwed: 20 }],
          },
        ],
      }),
    });

    renderGroupPage();

    expect(await screen.findByText("Ski Trip")).toBeInTheDocument();
    expect(screen.getAllByText("Bob").length).toBeGreaterThan(0);
    expect(screen.getByText(/owes/)).toBeInTheDocument();
    // "$" and the amount render as separate text nodes, so match loosely.
    expect(screen.getByText(/10\.00/)).toBeInTheDocument();
    expect(screen.getByText("Food & Drink")).toBeInTheDocument();
  });

  test("shows a settled-up message when there are no balances", async () => {
    api.get.mockResolvedValue({ data: baseGroup() });

    renderGroupPage();

    expect(await screen.findByText(/everyone is settled up/i)).toBeInTheDocument();
  });
});

describe("GroupPage - adding an expense", () => {
  test("submits an equal split across all members", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ data: baseGroup() });
    api.post.mockResolvedValue({ data: {} });

    renderGroupPage();
    await screen.findByText("Ski Trip");

    await user.type(screen.getByPlaceholderText("Description"), "Groceries");
    await user.type(screen.getByPlaceholderText("Amount"), "50");
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/expenses", {
        groupId: 7,
        paidBy: ME.id,
        amount: 50,
        description: "Groceries",
        splits: [
          { userId: ME.id, amountOwed: 25 },
          { userId: OTHER.id, amountOwed: 25 },
        ],
      })
    );
  });

  test("hides the add-expense form and shows a message when the group is finalized", async () => {
    api.get.mockResolvedValue({ data: baseGroup({ isFinalized: true }) });

    renderGroupPage();

    expect(await screen.findByText(/this group is finalized/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Description")).not.toBeInTheDocument();
  });
});

describe("GroupPage - editing and deleting an expense", () => {
  function groupWithMyExpense() {
    return baseGroup({
      expenses: [
        {
          id: 1,
          payer: ME,
          amount: "20",
          description: "Dinner",
          category: "Food & Drink",
          splits: [{ userId: ME.id, amountOwed: 20 }],
        },
      ],
    });
  }

  test("only shows Edit/Delete on expenses the current user paid for", async () => {
    api.get.mockResolvedValue({
      data: baseGroup({
        expenses: [
          {
            id: 1,
            payer: ME,
            amount: "20",
            description: "Mine",
            category: "Other",
            splits: [{ userId: ME.id, amountOwed: 20 }],
          },
          {
            id: 2,
            payer: OTHER,
            amount: "15",
            description: "Bob's",
            category: "Other",
            splits: [{ userId: OTHER.id, amountOwed: 15 }],
          },
        ],
      }),
    });

    renderGroupPage();
    await screen.findByText(/Mine/);

    expect(screen.getAllByText("Edit")).toHaveLength(1);
    expect(screen.getAllByText("Delete")).toHaveLength(1);
  });

  test("edits an expense and sends the updated fields", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ data: groupWithMyExpense() });
    api.patch.mockResolvedValue({ data: {} });

    renderGroupPage();
    await screen.findByText(/Dinner/);

    await user.click(screen.getByText("Edit"));
    const editForm = screen.getByRole("button", { name: "Save" }).closest("form");
    const amountInput = within(editForm).getByPlaceholderText("Amount");
    await user.clear(amountInput);
    await user.type(amountInput, "30");
    // Editing defaults to the "exact" split type, prefilled from the
    // expense's current splits (just $20 on ME) - bump it to match the new
    // total, same as a real user would need to.
    const exactInput = within(editForm).getAllByPlaceholderText("$")[0];
    await user.clear(exactInput);
    await user.type(exactInput, "30");
    await user.click(within(editForm).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/expenses/1", {
        paidBy: ME.id,
        amount: 30,
        description: "Dinner",
        splits: [{ userId: ME.id, amountOwed: 30 }],
      })
    );
  });

  test("deletes an expense after confirming", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ data: groupWithMyExpense() });
    api.delete.mockResolvedValue({});

    renderGroupPage();
    await screen.findByText(/Dinner/);

    await user.click(screen.getByText("Delete"));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/expenses/1"));
  });

  test("hides Edit/Delete once the group is finalized, even for your own expense", async () => {
    api.get.mockResolvedValue({ data: { ...groupWithMyExpense(), isFinalized: true } });

    renderGroupPage();
    await screen.findByText(/Dinner/);

    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });
});

describe("GroupPage - settling up", () => {
  test("shows Settle up only on a balance where the current user is the one who owes", async () => {
    api.get.mockResolvedValue({
      data: baseGroup({
        balances: [
          { from: ME.id, to: OTHER.id, amount: 10 },
          { from: OTHER.id, to: ME.id, amount: 5 },
        ],
      }),
    });

    renderGroupPage();
    await screen.findByText("Ski Trip");

    expect(screen.getAllByText("Settle up")).toHaveLength(1);
  });

  test("records a settlement for the balance the user owes", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({
      data: baseGroup({ balances: [{ from: ME.id, to: OTHER.id, amount: 10 }] }),
    });
    api.post.mockResolvedValue({ data: {} });

    renderGroupPage();
    await screen.findByText("Settle up");

    await user.click(screen.getByText("Settle up"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/settlements", {
        groupId: 7,
        toUser: OTHER.id,
        amount: 10,
      })
    );
  });
});

describe("GroupPage - finalize/reopen", () => {
  test("finalizes the group after confirming", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ data: baseGroup() });
    api.patch.mockResolvedValue({ data: {} });

    renderGroupPage();
    await screen.findByText("Finalize group");

    await user.click(screen.getByText("Finalize group"));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/groups/7/finalize", { finalized: true })
    );
  });

  test("shows Reopen group and a Finalized badge once finalized", async () => {
    api.get.mockResolvedValue({ data: baseGroup({ isFinalized: true }) });

    renderGroupPage();

    expect(await screen.findByText("Reopen group")).toBeInTheDocument();
    expect(screen.getByText("Finalized")).toBeInTheDocument();
  });
});

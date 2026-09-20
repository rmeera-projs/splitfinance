import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import GroupPage from "./GroupPage";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { __mockSocket } from "../realtime/socket";
import { exportGroupCsvs } from "../utils/csvExport";

// The download mechanics (Blob/URL.createObjectURL/an <a download> click)
// are exercised by the e2e suite, which can observe a real browser download
// event - jsdom has no such thing. What belongs here is narrower and
// cheaper to check: that the button calls exportGroupCsvs with this page's
// actual group data.
vi.mock("../utils/csvExport", () => ({
  exportGroupCsvs: vi.fn(),
}));

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

vi.mock("../realtime/socket", () => {
  const mockSocket = { connect: vi.fn(), emit: vi.fn(), on: vi.fn(), off: vi.fn() };
  return { getSocket: () => mockSocket, __mockSocket: mockSocket };
});

// Mirrors the server's fixed list closely enough for these tests - exact
// values don't matter, only that it's a realistic non-empty list.
const CATEGORIES = [
  "Food & Drink",
  "Groceries",
  "Transportation",
  "Housing & Utilities",
  "Entertainment",
  "Shopping",
  "Travel",
  "Health & Wellness",
  "Other",
];

const ME = { id: 1, name: "Alice", username: "alice1" };
const OTHER = { id: 2, name: "Bob", username: "bob2" };

function baseGroup(overrides = {}) {
  return {
    id: 7,
    name: "Ski Trip",
    isFinalized: false,
    members: [{ user: ME }, { user: OTHER }],
    balances: [],
    expenses: [],
    // The real API (groupController's getGroup) always includes this,
    // even for a group with none - defaulted here for the same reason
    // expenses/balances are, so Export CSV has real settlement data to
    // read rather than undefined.
    settlements: [],
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

// Dispatches api.get by URL so /expenses/categories always resolves
// (fired once on mount) independently of however many times a handler
// re-fetches /groups/:id afterward (settle up, finalize, edit, delete all
// trigger a refetch).
function mockGroupResponse(response) {
  api.get.mockImplementation((url) => {
    if (url === "/expenses/categories") {
      return Promise.resolve({ data: { categories: CATEGORIES } });
    }
    return Promise.resolve(response);
  });
}
// The Insights section can render the same category/"Other" text that
// appears on an expense's badge/dropdown - scope activity-feed assertions
// to this section to avoid ambiguous matches against the Insights panel.
function activitySection() {
  return within(screen.getByText("Activity").closest("section"));
}
// Just the expense list. The Activity section also holds the filter bar,
// whose category and payer dropdowns repeat names that appear on expenses.
function expenseList() {
  return within(screen.getByText("Activity").closest("section").querySelector("ul"));
}
// "You"/member names also appear in the "Paid by" select options - scope to
// the Members section to avoid ambiguous matches.
function membersSection() {
  return within(screen.getByText("Members").closest("section"));
}
// The Insights panel's "By member" breakdown can coincidentally show the
// same dollar figure as a balance (e.g. a member's total spend equalling
// what they owe) - scope balance assertions here to avoid that collision.
function balancesSection() {
  return within(screen.getByText("Balances").closest("section"));
}
// Invokes whatever handler GroupPage registered for "group-activity", as if
// the server had just emitted it over the (mocked) socket.
function triggerActivity(payload) {
  const call = __mockSocket.on.mock.calls.find(([event]) => event === "group-activity");
  act(() => call[1](payload));
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ user: ME });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

describe("GroupPage - rendering", () => {
  test("shows balances, the category badge, and the group name", async () => {
    mockGroupResponse({
      data: baseGroup({
        balances: [{ from: OTHER.id, to: ME.id, amount: 1000 }],
        expenses: [
          {
            id: 1,
            payer: ME,
            amount: 2000,
            description: "Dinner at Chipotle",
            category: "Food & Drink",
            splits: [{ userId: ME.id, amountOwed: 2000 }],
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
    expect(expenseList().getByText("Food & Drink")).toBeInTheDocument();
  });

  test("shows a settled-up message when there are no balances", async () => {
    mockGroupResponse({ data: baseGroup() });

    renderGroupPage();

    expect(await screen.findByText(/everyone is settled up/i)).toBeInTheDocument();
  });
});

describe("GroupPage - adding an expense", () => {
  test("submits an equal split across all members", async () => {
    const user = userEvent.setup();
    mockGroupResponse({ data: baseGroup() });
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
        amount: 5000,
        description: "Groceries",
        splits: [
          { userId: ME.id, amountOwed: 2500 },
          { userId: OTHER.id, amountOwed: 2500 },
        ],
      })
    );
  });

  // An amount that doesn't divide evenly is where integer cents actually
  // shows up for the user: $0.05 between two people can't be 2.5c each, and
  // the API now rejects splits that don't sum to the total exactly, so the
  // odd cent has to be assigned rather than rounded away.
  test("assigns the odd cent when an amount doesn't divide evenly", async () => {
    const user = userEvent.setup();
    mockGroupResponse({ data: baseGroup() });
    api.post.mockResolvedValue({ data: {} });

    renderGroupPage();
    await screen.findByText("Ski Trip");

    await user.type(screen.getByPlaceholderText("Description"), "Sweets");
    await user.type(screen.getByPlaceholderText("Amount"), "0.05");
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/expenses",
        expect.objectContaining({
          amount: 5,
          splits: [
            { userId: ME.id, amountOwed: 3 },
            { userId: OTHER.id, amountOwed: 2 },
          ],
        })
      )
    );
  });

  test("rejects an amount with more precision than a cent", async () => {
    const user = userEvent.setup();
    mockGroupResponse({ data: baseGroup() });

    renderGroupPage();
    await screen.findByText("Ski Trip");

    await user.type(screen.getByPlaceholderText("Description"), "Odd");
    await user.type(screen.getByPlaceholderText("Amount"), "10.234");
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    expect(await screen.findByText(/valid amount/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  test("hides the add-expense form and shows a message when the group is finalized", async () => {
    mockGroupResponse({ data: baseGroup({ isFinalized: true }) });

    renderGroupPage();

    // The Members section shows its own "finalized" message too - match the
    // expense-specific wording so this doesn't collide with it.
    expect(await screen.findByText(/reopen it to add expenses/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Description")).not.toBeInTheDocument();
  });
});

describe("GroupPage - scanning a receipt", () => {
  const photo = () => new File(["fake"], "receipt.jpg", { type: "image/jpeg" });

  test("uploads the photo and pre-fills the form without submitting an expense", async () => {
    const user = userEvent.setup();
    mockGroupResponse({ data: baseGroup() });
    api.post.mockImplementation((url) => {
      if (url === "/expenses/receipt") return Promise.resolve({ data: { merchant: "Olive Garden", total: 6050 } });
      return Promise.resolve({ data: {} });
    });

    renderGroupPage();
    await screen.findByText("Ski Trip");

    await user.upload(screen.getByLabelText("Scan a receipt"), photo());

    expect(await screen.findByDisplayValue("Olive Garden")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Amount")).toHaveValue(60.5);

    const [url, body] = api.post.mock.calls.find(([u]) => u === "/expenses/receipt");
    expect(url).toBe("/expenses/receipt");
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("receipt").name).toBe("receipt.jpg");
    expect(api.post).not.toHaveBeenCalledWith("/expenses", expect.anything());
  });

  test("still fills the amount when the merchant is unreadable", async () => {
    const user = userEvent.setup();
    mockGroupResponse({ data: baseGroup() });
    api.post.mockResolvedValue({ data: { merchant: null, total: 1200 } });

    renderGroupPage();
    await screen.findByText("Ski Trip");
    await user.upload(screen.getByLabelText("Scan a receipt"), photo());

    await waitFor(() => expect(screen.getByPlaceholderText("Amount")).toHaveValue(12));
    expect(screen.getByPlaceholderText("Description")).toHaveValue("");
  });

  test("shows the server's message and leaves the form alone when the receipt can't be read", async () => {
    const user = userEvent.setup();
    mockGroupResponse({ data: baseGroup() });
    api.post.mockRejectedValue({ response: { data: { error: "Couldn't read a total from that image" } } });

    renderGroupPage();
    await screen.findByText("Ski Trip");
    await user.upload(screen.getByLabelText("Scan a receipt"), photo());

    expect(await screen.findByText(/couldn't read a total/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Amount")).toHaveValue(null);
  });
});

describe("GroupPage - natural-language expense entry", () => {
  test("fills in the form from a parsed sentence, without submitting an expense", async () => {
    const user = userEvent.setup();
    mockGroupResponse({ data: baseGroup() });
    api.post.mockImplementation((url) => {
      if (url === "/expenses/parse") {
        return Promise.resolve({
          data: { description: "Dinner", amount: 6000, payerId: OTHER.id, splitWithIds: null },
        });
      }
      return Promise.resolve({ data: {} });
    });

    renderGroupPage();
    await screen.findByText("Ski Trip");

    await user.type(
      screen.getByPlaceholderText(/dinner \$60/i),
      "Dinner $60, Bob paid, split with everyone"
    );
    await user.click(screen.getByRole("button", { name: "Fill in form" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/expenses/parse", {
        groupId: 7,
        text: "Dinner $60, Bob paid, split with everyone",
      })
    );
    expect(await screen.findByPlaceholderText("Description")).toHaveValue("Dinner");
    expect(screen.getByPlaceholderText("Amount")).toHaveValue(60);
    expect(screen.getByRole("combobox", { name: "Paid by" })).toHaveValue(String(OTHER.id));
    // Parsing only pre-fills the form - it must never itself create the expense.
    expect(api.post).not.toHaveBeenCalledWith("/expenses", expect.anything());
  });

  test("checks/unchecks the split-between boxes to match a parsed subset", async () => {
    const user = userEvent.setup();
    const THIRD = { id: 3, name: "Charlie", username: "charlie3" };
    mockGroupResponse({
      data: baseGroup({ members: [{ user: ME }, { user: OTHER }, { user: THIRD }] }),
    });
    api.post.mockImplementation((url) => {
      if (url === "/expenses/parse") {
        return Promise.resolve({
          data: { description: "Pizza", amount: 2000, payerId: null, splitWithIds: [ME.id, OTHER.id] },
        });
      }
      return Promise.resolve({ data: {} });
    });

    renderGroupPage();
    await screen.findByText("Ski Trip");

    await user.type(screen.getByPlaceholderText(/dinner \$60/i), "Pizza $20 split between me and Bob");
    await user.click(screen.getByRole("button", { name: "Fill in form" }));
    await screen.findByDisplayValue("Pizza");

    expect(screen.getByRole("checkbox", { name: "You" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bob" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Charlie" })).not.toBeChecked();

    // Submitting an equal split now divides only between the two checked
    // members, with Charlie excluded rather than getting a $0 share.
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/expenses", {
        groupId: 7,
        paidBy: ME.id,
        amount: 2000,
        description: "Pizza",
        splits: [
          { userId: ME.id, amountOwed: 1000 },
          { userId: OTHER.id, amountOwed: 1000 },
        ],
      })
    );
  });

  test("unchecking a member excludes them from an equal split", async () => {
    const user = userEvent.setup();
    mockGroupResponse({ data: baseGroup() });
    api.post.mockResolvedValue({ data: {} });

    renderGroupPage();
    await screen.findByText("Ski Trip");

    await user.type(screen.getByPlaceholderText("Description"), "Groceries");
    await user.type(screen.getByPlaceholderText("Amount"), "50");
    await user.click(screen.getByRole("checkbox", { name: "Bob" }));
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/expenses",
        expect.objectContaining({ splits: [{ userId: ME.id, amountOwed: 5000 }] })
      )
    );
  });

  test("shows an error instead of submitting when every member is unchecked", async () => {
    const user = userEvent.setup();
    mockGroupResponse({ data: baseGroup() });

    renderGroupPage();
    await screen.findByText("Ski Trip");

    await user.type(screen.getByPlaceholderText("Description"), "Groceries");
    await user.type(screen.getByPlaceholderText("Amount"), "50");
    await user.click(screen.getByRole("checkbox", { name: "You" }));
    await user.click(screen.getByRole("checkbox", { name: "Bob" }));
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    expect(await screen.findByText("Select at least one person to split with")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalledWith("/expenses", expect.anything());
  });

  test("shows an error when the sentence can't be understood", async () => {
    const user = userEvent.setup();
    mockGroupResponse({ data: baseGroup() });
    api.post.mockImplementation((url) => {
      if (url === "/expenses/parse") {
        return Promise.reject({ response: { data: { error: "Couldn't understand that" } } });
      }
      return Promise.resolve({ data: {} });
    });

    renderGroupPage();
    await screen.findByText("Ski Trip");

    await user.type(screen.getByPlaceholderText(/dinner \$60/i), "asdf");
    await user.click(screen.getByRole("button", { name: "Fill in form" }));

    expect(await screen.findByText("Couldn't understand that")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Description")).toHaveValue("");
  });
});

describe("GroupPage - editing and deleting an expense", () => {
  function groupWithMyExpense() {
    return baseGroup({
      expenses: [
        {
          id: 1,
          payer: ME,
          amount: 2000,
          description: "Dinner",
          category: "Food & Drink",
          splits: [{ userId: ME.id, amountOwed: 2000 }],
        },
      ],
    });
  }

  test("only shows Edit/Delete on expenses the current user paid for", async () => {
    mockGroupResponse({
      data: baseGroup({
        expenses: [
          {
            id: 1,
            payer: ME,
            amount: 2000,
            description: "Mine",
            category: "Other",
            splits: [{ userId: ME.id, amountOwed: 2000 }],
          },
          {
            id: 2,
            payer: OTHER,
            amount: 1500,
            description: "Bob's",
            category: "Other",
            splits: [{ userId: OTHER.id, amountOwed: 1500 }],
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
    mockGroupResponse({ data: groupWithMyExpense() });
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
        amount: 3000,
        description: "Dinner",
        splits: [{ userId: ME.id, amountOwed: 3000 }],
      })
    );
  });

  test("deletes an expense after confirming", async () => {
    const user = userEvent.setup();
    mockGroupResponse({ data: groupWithMyExpense() });
    api.delete.mockResolvedValue({});

    renderGroupPage();
    await screen.findByText(/Dinner/);

    await user.click(screen.getByText("Delete"));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/expenses/1"));
  });

  test("hides Edit/Delete once the group is finalized, even for your own expense", async () => {
    mockGroupResponse({ data: { ...groupWithMyExpense(), isFinalized: true } });

    renderGroupPage();
    await screen.findByText(/Dinner/);

    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });
});

describe("GroupPage - settling up", () => {
  test("shows Settle up only on a balance where the current user is the one who owes", async () => {
    mockGroupResponse({
      data: baseGroup({
        balances: [
          { from: ME.id, to: OTHER.id, amount: 1000 },
          { from: OTHER.id, to: ME.id, amount: 500 },
        ],
      }),
    });

    renderGroupPage();
    await screen.findByText("Ski Trip");

    expect(screen.getAllByText("Settle up")).toHaveLength(1);
  });

  async function openSettleForm(amount = 1000) {
    const user = userEvent.setup();
    mockGroupResponse({
      data: baseGroup({ balances: [{ from: ME.id, to: OTHER.id, amount }] }),
    });
    renderGroupPage();
    await user.click(await screen.findByText("Settle up"));
    return user;
  }

  // Paying in full stays one click away: the field arrives holding the whole
  // balance, so the common case is just confirming it.
  test("pre-fills the full balance and records it", async () => {
    api.post.mockResolvedValue({ data: {} });
    const user = await openSettleForm(1000);

    expect(screen.getByLabelText("Settlement amount")).toHaveValue("10.00");
    await user.click(screen.getByRole("button", { name: "Record payment" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/settlements", { groupId: 7, toUser: OTHER.id, amount: 1000 })
    );
  });

  test("records a partial payment when the amount is edited down", async () => {
    api.post.mockResolvedValue({ data: {} });
    const user = await openSettleForm(1000);

    const input = screen.getByLabelText("Settlement amount");
    await user.clear(input);
    await user.type(input, "4.25");
    await user.click(screen.getByRole("button", { name: "Record payment" }));

    // Sent as integer cents, like every other amount on the wire.
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/settlements", { groupId: 7, toUser: OTHER.id, amount: 425 })
    );
  });

  test("refuses more than is owed without calling the API", async () => {
    const user = await openSettleForm(1000);

    const input = screen.getByLabelText("Settlement amount");
    await user.clear(input);
    await user.type(input, "10.01");
    await user.click(screen.getByRole("button", { name: "Record payment" }));

    expect(await screen.findByText(/more than you owe/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  test.each([["0"], ["abc"], ["1.234"], [""]])("refuses an invalid amount (%j) without calling the API", async (value) => {
    const user = await openSettleForm(1000);

    const input = screen.getByLabelText("Settlement amount");
    await user.clear(input);
    if (value) await user.type(input, value);
    await user.click(screen.getByRole("button", { name: "Record payment" }));

    expect(await screen.findByText(/enter a valid amount/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  // The server re-checks against the live balance, which can have moved
  // since the page loaded. Its refusal belongs next to the form, not in an
  // alert() that throws away what the user typed.
  test("shows the server's refusal inline and keeps the form open", async () => {
    api.post.mockRejectedValue({
      response: { data: { error: "Settlement amount cannot exceed the outstanding balance" } },
    });
    const user = await openSettleForm(1000);

    await user.click(screen.getByRole("button", { name: "Record payment" }));

    expect(await screen.findByText(/cannot exceed the outstanding balance/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Settlement amount")).toBeInTheDocument();
  });

  test("cancel closes the form without recording anything", async () => {
    const user = await openSettleForm(1000);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Settlement amount")).not.toBeInTheDocument();
    expect(screen.getByText("Settle up")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe("GroupPage - finalize/reopen", () => {
  test("finalizes the group after confirming", async () => {
    const user = userEvent.setup();
    mockGroupResponse({ data: baseGroup() });
    api.patch.mockResolvedValue({ data: {} });

    renderGroupPage();
    await screen.findByText("Finalize group");

    await user.click(screen.getByText("Finalize group"));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/groups/7/finalize", { finalized: true })
    );
  });

  test("shows Reopen group and a Finalized badge once finalized", async () => {
    mockGroupResponse({ data: baseGroup({ isFinalized: true }) });

    renderGroupPage();

    expect(await screen.findByText("Reopen group")).toBeInTheDocument();
    expect(screen.getByText("Finalized")).toBeInTheDocument();
  });
});

describe("GroupPage - insights includes every current member", () => {
  test("a member with no expenses yet still appears in the By Member breakdown, at $0", async () => {
    mockGroupResponse({
      data: baseGroup({
        expenses: [
          {
            id: 1,
            payer: ME,
            amount: 2000,
            description: "Dinner",
            category: "Food & Drink",
            splits: [{ userId: ME.id, amountOwed: 2000 }],
          },
        ],
      }),
    });

    renderGroupPage();
    await screen.findByText("Ski Trip");

    const insights = within(screen.getByText("Insights").closest("section"));
    // Bob (OTHER) never paid for anything, but he's still a current member -
    // this is exactly what's missing if a newly-added member "doesn't show
    // up" in insights.
    expect(insights.getByText("Bob")).toBeInTheDocument();
    expect(insights.getByText("$0.00")).toBeInTheDocument();
  });
});

describe("GroupPage - adding members", () => {
  test("lists current members", async () => {
    mockGroupResponse({ data: baseGroup() });

    renderGroupPage();
    await screen.findByText("Ski Trip");

    expect(membersSection().getByText("You")).toBeInTheDocument();
    expect(membersSection().getByText("Bob")).toBeInTheDocument();
  });

  test("submits comma-separated emails/usernames to add", async () => {
    const user = userEvent.setup();
    mockGroupResponse({ data: baseGroup() });
    api.post.mockResolvedValue({ data: { ...baseGroup(), unmatchedIdentifiers: [] } });

    renderGroupPage();
    await screen.findByText("Ski Trip");

    await user.type(
      screen.getByPlaceholderText(/add by email/i),
      "carol@example.com, dave99"
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/groups/7/members", {
        memberIdentifiers: ["carol@example.com", "dave99"],
      })
    );
  });

  test("surfaces unmatched identifiers after adding", async () => {
    const user = userEvent.setup();
    mockGroupResponse({ data: baseGroup() });
    api.post.mockResolvedValue({ data: { ...baseGroup(), unmatchedIdentifiers: ["nobody@example.com"] } });

    renderGroupPage();
    await screen.findByText("Ski Trip");

    await user.type(screen.getByPlaceholderText(/add by email/i), "nobody@example.com");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText(/nobody@example.com/)).toBeInTheDocument();
  });

  test("hides the add-member form and shows a message when the group is finalized", async () => {
    mockGroupResponse({ data: baseGroup({ isFinalized: true }) });

    renderGroupPage();
    await screen.findByText("Ski Trip");

    expect(screen.getByText(/reopen it to add members/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/add by email/i)).not.toBeInTheDocument();
  });
});

describe("GroupPage - live activity notice", () => {
  test("joins the group's socket room on mount and leaves it on unmount", async () => {
    mockGroupResponse({ data: baseGroup() });

    const { unmount } = renderGroupPage();
    await screen.findByText("Ski Trip");

    expect(__mockSocket.connect).toHaveBeenCalled();
    expect(__mockSocket.emit).toHaveBeenCalledWith("join-group", "7");

    unmount();
    expect(__mockSocket.emit).toHaveBeenCalledWith("leave-group", "7");
  });

  test("shows a banner naming who made the change, when it's someone else", async () => {
    mockGroupResponse({ data: baseGroup() });

    renderGroupPage();
    await screen.findByText("Ski Trip");

    triggerActivity({ groupId: 7, type: "expense-added", actorId: OTHER.id });

    expect(await screen.findByText(/bob added an expense/i)).toBeInTheDocument();
  });

  test("ignores activity the current user caused themselves", async () => {
    mockGroupResponse({ data: baseGroup() });

    renderGroupPage();
    await screen.findByText("Ski Trip");
    api.get.mockClear();

    triggerActivity({ groupId: 7, type: "expense-added", actorId: ME.id });

    expect(screen.queryByText(/added an expense/i)).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  test("ignores activity for a different group", async () => {
    mockGroupResponse({ data: baseGroup() });

    renderGroupPage();
    await screen.findByText("Ski Trip");
    api.get.mockClear();

    triggerActivity({ groupId: 999, type: "expense-added", actorId: OTHER.id });

    expect(screen.queryByText(/added an expense/i)).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  test("refetches the group automatically as soon as the activity notice arrives, no click needed", async () => {
    mockGroupResponse({ data: baseGroup() });

    renderGroupPage();
    await screen.findByText("Ski Trip");
    api.get.mockClear();

    triggerActivity({ groupId: 7, type: "settlement", actorId: OTHER.id });

    // The banner and the refetch both happen off the same event - neither
    // waits on the other, and there's no "Refresh" button to click.
    expect(await screen.findByText(/recorded a settlement/i)).toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/groups/7"));
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
  });

  test("dismissing the banner hides it without an extra refetch", async () => {
    const user = userEvent.setup();
    mockGroupResponse({ data: baseGroup() });

    renderGroupPage();
    await screen.findByText("Ski Trip");

    triggerActivity({ groupId: 7, type: "member-added", actorId: OTHER.id });
    await screen.findByText(/added a member/i);

    api.get.mockClear();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByText(/added a member/i)).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe("GroupPage - manual category override", () => {
  function groupWithExpense(payer) {
    return baseGroup({
      expenses: [
        {
          id: 1,
          payer,
          amount: 2000,
          description: "Arcade tokens",
          category: "Other",
          splits: [{ userId: payer.id, amountOwed: 20 }],
        },
      ],
    });
  }

  test("shows an editable category dropdown even for an expense the current user didn't pay for", async () => {
    mockGroupResponse({ data: groupWithExpense(OTHER) });

    renderGroupPage();
    await screen.findByText(/Arcade tokens/);

    const select = screen.getByTitle("Change category");
    expect(select).toHaveValue("Other");
    expect(within(select).getByRole("option", { name: "Food & Drink" })).toBeInTheDocument();
  });

  test("changing the dropdown sends the override to the server", async () => {
    const user = userEvent.setup();
    mockGroupResponse({ data: groupWithExpense(OTHER) });
    api.patch.mockResolvedValue({ data: {} });

    renderGroupPage();
    await screen.findByText(/Arcade tokens/);

    await user.selectOptions(screen.getByTitle("Change category"), "Entertainment");

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/expenses/1/category", { category: "Entertainment" })
    );
  });

  test("falls back to a plain badge if the category list hasn't loaded", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/expenses/categories") {
        return Promise.resolve({ data: { categories: [] } });
      }
      return Promise.resolve({ data: groupWithExpense(ME) });
    });

    renderGroupPage();
    await screen.findByText(/Arcade tokens/);

    expect(screen.queryByTitle("Change category")).not.toBeInTheDocument();
    expect(activitySection().getByText("Other")).toBeInTheDocument();
  });

  test("still shows the dropdown even when the group is finalized", async () => {
    mockGroupResponse({ data: { ...groupWithExpense(OTHER), isFinalized: true } });

    renderGroupPage();
    await screen.findByText(/Arcade tokens/);

    expect(screen.getByTitle("Change category")).toBeInTheDocument();
  });
});

describe("GroupPage - filtering expenses", () => {
  const noon = (d) => new Date(2026, 8, d, 12).toISOString();
  const EXPENSES = [
    { id: 11, description: "Lift passes", amount: 12000, category: "Entertainment", date: noon(1), payer: ME, splits: [] },
    { id: 12, description: "Chalet groceries", amount: 4500, category: "Groceries", date: noon(3), payer: OTHER, splits: [] },
    { id: 13, description: "Apres-ski drinks", amount: 3000, category: "Food & Drink", date: noon(5), payer: OTHER, splits: [] },
  ];

  async function renderWithExpenses(extra = {}) {
    mockGroupResponse({ data: baseGroup({ expenses: EXPENSES, ...extra }) });
    renderGroupPage();
    // Descriptions render as bare text nodes next to the category <select>
    // (see the Activity list markup), so no single element's full text
    // equals just the description - wait on the filter bar instead, which
    // only appears once expenses have loaded.
    await screen.findByLabelText("Search expenses");
    return userEvent.setup();
  }

  // Same reasoning as above: check each <li>'s full text rather than
  // looking for an element whose text is exactly the description.
  const shown = () => {
    const items = expenseList().queryAllByRole("listitem");
    return ["Lift passes", "Chalet groceries", "Apres-ski drinks"].filter((d) =>
      items.some((li) => li.textContent.includes(d))
    );
  };

  test("has no filter bar until there is something to filter", async () => {
    mockGroupResponse({ data: baseGroup() });
    renderGroupPage();
    await screen.findByText("Ski Trip");

    expect(screen.queryByLabelText("Search expenses")).not.toBeInTheDocument();
  });

  test("narrows the list by description and reports what is shown", async () => {
    const user = await renderWithExpenses();

    await user.type(screen.getByLabelText("Search expenses"), "SKI");

    expect(shown()).toEqual(["Apres-ski drinks"]);
    expect(screen.getByText(/Showing 1 of 3 expenses · \$30\.00/)).toBeInTheDocument();
  });

  test("filters by payer and by category", async () => {
    const user = await renderWithExpenses();

    await user.selectOptions(screen.getByLabelText("Filter by payer"), String(OTHER.id));
    expect(shown()).toEqual(["Chalet groceries", "Apres-ski drinks"]);

    await user.selectOptions(screen.getByLabelText("Filter by category"), "Groceries");
    expect(shown()).toEqual(["Chalet groceries"]);
  });

  test("filters by an inclusive date range", async () => {
    const user = await renderWithExpenses();

    await user.type(screen.getByLabelText("From date"), "2026-09-03");
    await user.type(screen.getByLabelText("To date"), "2026-09-05");

    expect(shown()).toEqual(["Chalet groceries", "Apres-ski drinks"]);
  });

  test("says so when nothing matches, and clearing brings everything back", async () => {
    const user = await renderWithExpenses();

    await user.type(screen.getByLabelText("Search expenses"), "helicopter");
    expect(screen.getByText(/no expenses match these filters/i)).toBeInTheDocument();
    expect(shown()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(shown()).toEqual(["Lift passes", "Chalet groceries", "Apres-ski drinks"]);
    expect(screen.getByLabelText("Search expenses")).toHaveValue("");
  });

  // A filter must never make someone look like they owe less than they do.
  test("leaves balances untouched while filtering", async () => {
    const user = await renderWithExpenses({ balances: [{ from: OTHER.id, to: ME.id, amount: 7500 }] });

    await user.type(screen.getByLabelText("Search expenses"), "helicopter");

    expect(balancesSection().getByText(/owes/)).toBeInTheDocument();
    expect(balancesSection().getByText(/75\.00/)).toBeInTheDocument();
  });
});

describe("GroupPage - exporting CSVs", () => {
  test("Export CSV passes the page's own group data straight through", async () => {
    const user = userEvent.setup();
    const groupData = baseGroup({
      expenses: [
        {
          id: 21,
          description: "Cabin rental",
          amount: 30000,
          category: "Housing & Utilities",
          date: "2026-09-01T12:00:00.000Z",
          payer: ME,
          splits: [{ userId: ME.id, amountOwed: 15000 }, { userId: OTHER.id, amountOwed: 15000 }],
        },
      ],
      settlements: [{ id: 1, fromUser: OTHER.id, toUser: ME.id, amount: 5000, date: "2026-09-02T12:00:00.000Z" }],
    });
    mockGroupResponse({ data: groupData });

    renderGroupPage();
    await user.click(await screen.findByRole("button", { name: "Export CSV" }));

    // Not a deep-equal on the whole payload - the point is that GroupPage
    // is a thin pass-through with no export-specific logic of its own to
    // get wrong, so identity (or at least the fields csvExport reads) is
    // what matters, not GroupPage re-deriving anything.
    expect(exportGroupCsvs).toHaveBeenCalledTimes(1);
    const passed = exportGroupCsvs.mock.calls[0][0];
    expect(passed.name).toBe(groupData.name);
    expect(passed.expenses).toBe(groupData.expenses);
    expect(passed.settlements).toBe(groupData.settlements);
    expect(passed.members).toBe(groupData.members);
  });

  test("the button is available even when there is nothing to export yet", async () => {
    mockGroupResponse({ data: baseGroup() });
    renderGroupPage();

    expect(await screen.findByRole("button", { name: "Export CSV" })).toBeEnabled();
  });
});

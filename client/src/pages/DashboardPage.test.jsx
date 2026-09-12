import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import DashboardPage from "./DashboardPage";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
}

// Dispatches api.get by URL - the dashboard fetches both /groups and
// /insights on mount (and re-fetches /groups after creating a group), so a
// single mockResolvedValue would answer both endpoints with the same shape.
function mockApiGet({ groups, insightItems = [] }) {
  api.get.mockImplementation((url) => {
    if (url === "/insights") {
      return Promise.resolve({ data: { items: insightItems } });
    }
    return Promise.resolve({ data: groups });
  });
}

function callsTo(url) {
  return api.get.mock.calls.filter(([u]) => u === url).length;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ user: { id: 1, name: "Alice" }, logout: vi.fn() });
});

describe("DashboardPage", () => {
  test("lists the user's groups, with a Finalized badge on finalized ones", async () => {
    mockApiGet({
      groups: [
        { id: 1, name: "Roommates", isFinalized: false, members: [{}, {}] },
        { id: 2, name: "Ski Trip", isFinalized: true, members: [{}] },
      ],
    });

    renderDashboard();

    expect(await screen.findByText("Roommates")).toBeInTheDocument();
    expect(screen.getByText("Ski Trip")).toBeInTheDocument();
    expect(screen.getByText("Finalized")).toBeInTheDocument();
    expect(screen.getByText("2 members")).toBeInTheDocument();
  });

  test("shows an empty state when there are no groups", async () => {
    mockApiGet({ groups: [] });

    renderDashboard();

    expect(await screen.findByText(/no groups yet/i)).toBeInTheDocument();
  });

  test("shows the personal spending breakdown fetched from /insights", async () => {
    mockApiGet({
      groups: [],
      insightItems: [
        { amount: 12, category: "Food & Drink", date: "2026-01-05", groupId: 1, groupName: "Roommates" },
      ],
    });

    renderDashboard();

    expect(await screen.findByText("Your Spending")).toBeInTheDocument();
    expect(screen.getByText("Roommates")).toBeInTheDocument();
    expect(screen.getByText("Food & Drink")).toBeInTheDocument();
  });

  test("creates a group with invited emails and refreshes the list", async () => {
    const user = userEvent.setup();
    mockApiGet({ groups: [] });
    api.post.mockResolvedValue({ data: { id: 3, unmatchedEmails: [] } });

    renderDashboard();
    await screen.findByText(/no groups yet/i);

    await user.type(screen.getByPlaceholderText("New group name"), "Cabin Weekend");
    await user.type(
      screen.getByPlaceholderText(/invite by email/i),
      "bob@example.com, carol@example.com"
    );
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/groups", {
        name: "Cabin Weekend",
        memberEmails: ["bob@example.com", "carol@example.com"],
      })
    );
    // Once on mount, once more after creating.
    await waitFor(() => expect(callsTo("/groups")).toBe(2));
  });

  test("surfaces unmatched invite emails as an error instead of silently dropping them", async () => {
    const user = userEvent.setup();
    mockApiGet({ groups: [] });
    api.post.mockResolvedValue({ data: { id: 3, unmatchedEmails: ["nobody@example.com"] } });

    renderDashboard();
    await screen.findByText(/no groups yet/i);

    await user.type(screen.getByPlaceholderText("New group name"), "Cabin Weekend");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText(/nobody@example.com/)).toBeInTheDocument();
  });
});

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

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ user: { id: 1, name: "Alice" }, logout: vi.fn() });
});

describe("DashboardPage", () => {
  test("lists the user's groups, with a Finalized badge on finalized ones", async () => {
    api.get.mockResolvedValue({
      data: [
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
    api.get.mockResolvedValue({ data: [] });

    renderDashboard();

    expect(await screen.findByText(/no groups yet/i)).toBeInTheDocument();
  });

  test("creates a group with invited emails and refreshes the list", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ data: [] });
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
    // Refetches after creating.
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  test("surfaces unmatched invite emails as an error instead of silently dropping them", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ data: [] });
    api.post.mockResolvedValue({ data: { id: 3, unmatchedEmails: ["nobody@example.com"] } });

    renderDashboard();
    await screen.findByText(/no groups yet/i);

    await user.type(screen.getByPlaceholderText("New group name"), "Cabin Weekend");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText(/nobody@example.com/)).toBeInTheDocument();
  });
});

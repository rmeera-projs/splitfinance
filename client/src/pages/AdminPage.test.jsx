import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AdminPage from "./AdminPage";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn() },
}));

function renderAdminPage() {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/" element={<div>Dashboard</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const STATS = {
  totals: { users: 42, groups: 10, expenses: 137, settlements: 25 },
  totalExpenseAmount: 456789,
  recentWindowDays: 7,
  newUsers: 3,
  newGroups: 2,
  recentUsers: [{ id: 1, name: "Alice", username: "alice1", createdAt: "2026-09-01T00:00:00.000Z" }],
  recentGroups: [{ id: 1, name: "Ski Trip", createdAt: "2026-09-02T00:00:00.000Z", memberCount: 3 }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminPage", () => {
  test("renders platform-wide stats", async () => {
    api.get.mockResolvedValue({ data: STATS });

    renderAdminPage();

    expect(await screen.findByText("42")).toBeInTheDocument(); // users
    expect(screen.getByText("10")).toBeInTheDocument(); // groups
    expect(screen.getByText("137")).toBeInTheDocument(); // expenses
    expect(screen.getByText("25")).toBeInTheDocument(); // settlements
    expect(screen.getByText("$4,567.89")).toBeInTheDocument();
    expect(screen.getByText(/\+3 in the last 7 days/)).toBeInTheDocument();
  });

  test("lists recent users and groups", async () => {
    api.get.mockResolvedValue({ data: STATS });

    renderAdminPage();

    expect(await screen.findByText(/alice1/)).toBeInTheDocument();
    expect(screen.getByText(/Ski Trip/)).toBeInTheDocument();
  });

  test("shows empty-state text instead of an empty list when there's no data yet", async () => {
    api.get.mockResolvedValue({
      data: { ...STATS, totals: { ...STATS.totals, users: 0 }, recentUsers: [], recentGroups: [] },
    });

    renderAdminPage();

    expect(await screen.findByText("No users yet.")).toBeInTheDocument();
    expect(screen.getByText("No groups yet.")).toBeInTheDocument();
  });

  // A non-admin should never actually reach this page (the NavBar link is
  // hidden - see NavBar.test.jsx), but the API is what actually enforces
  // it, so someone typing the URL directly gets bounced instead of seeing
  // a broken/empty admin page.
  test("redirects to the dashboard on a 403", async () => {
    api.get.mockRejectedValue({ response: { status: 403 } });

    renderAdminPage();

    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
  });
});

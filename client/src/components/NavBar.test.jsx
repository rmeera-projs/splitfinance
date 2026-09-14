import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import NavBar from "./NavBar";
import { useAuth } from "../context/AuthContext";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

function renderNavBar() {
  return render(
    <MemoryRouter>
      <NavBar />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NavBar", () => {
  test("shows the user's name, with the menu closed by default", () => {
    useAuth.mockReturnValue({ user: { name: "Alice" }, logout: vi.fn() });

    renderNavBar();

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Account" })).not.toBeInTheDocument();
  });

  test("opens the menu to reveal Account and Log out", async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ user: { name: "Alice" }, logout: vi.fn() });

    renderNavBar();
    await user.click(screen.getByText("Alice"));

    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  test("calls logout when clicked", async () => {
    const user = userEvent.setup();
    const logout = vi.fn();
    useAuth.mockReturnValue({ user: { name: "Alice" }, logout });

    renderNavBar();
    await user.click(screen.getByText("Alice"));
    await user.click(screen.getByRole("button", { name: "Log out" }));

    expect(logout).toHaveBeenCalled();
  });

  test("closes the menu after choosing Account", async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ user: { name: "Alice" }, logout: vi.fn() });

    renderNavBar();
    await user.click(screen.getByText("Alice"));
    await user.click(screen.getByRole("link", { name: "Account" }));

    expect(screen.queryByRole("link", { name: "Account" })).not.toBeInTheDocument();
  });
});

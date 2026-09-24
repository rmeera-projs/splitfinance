import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import LoginPage from "./LoginPage";
import { useAuth } from "../context/AuthContext";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

function renderLoginPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LoginPage", () => {
  test("submits email and password", async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ login, demoLogin: vi.fn() });

    renderLoginPage();

    await user.type(screen.getByPlaceholderText("Email"), "alice@example.com");
    await user.type(screen.getByPlaceholderText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(login).toHaveBeenCalledWith("alice@example.com", "password123");
  });

  test("shows the server's message on a failed login", async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockRejectedValue({ response: { data: { error: "Invalid email or password" } } });
    useAuth.mockReturnValue({ login, demoLogin: vi.fn() });

    renderLoginPage();

    await user.type(screen.getByPlaceholderText("Email"), "alice@example.com");
    await user.type(screen.getByPlaceholderText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
  });

  test("the demo button skips the form entirely", async () => {
    const user = userEvent.setup();
    const demoLogin = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ login: vi.fn(), demoLogin });

    renderLoginPage();
    await user.click(screen.getByRole("button", { name: /try the demo/i }));

    expect(demoLogin).toHaveBeenCalledWith();
  });

  test("disables the demo button and shows progress while it's setting up", async () => {
    const user = userEvent.setup();
    let resolve;
    const demoLogin = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
    useAuth.mockReturnValue({ login: vi.fn(), demoLogin });

    renderLoginPage();
    await user.click(screen.getByRole("button", { name: /try the demo/i }));

    expect(screen.getByRole("button", { name: /setting up your demo/i })).toBeDisabled();
    resolve();
  });

  test("shows the server's message when the demo can't be started", async () => {
    const user = userEvent.setup();
    const demoLogin = vi.fn().mockRejectedValue({ response: { data: { error: "Too many attempts - please try again later." } } });
    useAuth.mockReturnValue({ login: vi.fn(), demoLogin });

    renderLoginPage();
    await user.click(screen.getByRole("button", { name: /try the demo/i }));

    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
  });
});

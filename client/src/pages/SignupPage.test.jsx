import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import SignupPage from "./SignupPage";
import { useAuth } from "../context/AuthContext";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

function renderSignupPage() {
  return render(
    <MemoryRouter>
      <SignupPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SignupPage", () => {
  test("submits name, username, email, and password", async () => {
    const user = userEvent.setup();
    const signup = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ signup });

    renderSignupPage();

    await user.type(screen.getByPlaceholderText("Name"), "Alice");
    await user.type(screen.getByPlaceholderText(/username/i), "alice1");
    await user.type(screen.getByPlaceholderText("Email"), "alice@example.com");
    await user.type(screen.getByPlaceholderText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: "Sign up" }));

    expect(signup).toHaveBeenCalledWith("Alice", "alice1", "alice@example.com", "password123");
  });

  test("shows an error when the username is already taken", async () => {
    const user = userEvent.setup();
    const signup = vi.fn().mockRejectedValue({ response: { data: { error: "That username is taken" } } });
    useAuth.mockReturnValue({ signup });

    renderSignupPage();

    await user.type(screen.getByPlaceholderText("Name"), "Alice");
    await user.type(screen.getByPlaceholderText(/username/i), "bob");
    await user.type(screen.getByPlaceholderText("Email"), "alice@example.com");
    await user.type(screen.getByPlaceholderText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: "Sign up" }));

    expect(await screen.findByText("That username is taken")).toBeInTheDocument();
  });

  test("the demo button skips the form entirely", async () => {
    const user = userEvent.setup();
    const demoLogin = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ signup: vi.fn(), demoLogin });

    renderSignupPage();
    await user.click(screen.getByRole("button", { name: /try the demo/i }));

    expect(demoLogin).toHaveBeenCalledWith();
  });

  test("shows the server's message when the demo can't be started", async () => {
    const user = userEvent.setup();
    const demoLogin = vi.fn().mockRejectedValue({ response: { data: { error: "Too many attempts - please try again later." } } });
    useAuth.mockReturnValue({ signup: vi.fn(), demoLogin });

    renderSignupPage();
    await user.click(screen.getByRole("button", { name: /try the demo/i }));

    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
  });
});

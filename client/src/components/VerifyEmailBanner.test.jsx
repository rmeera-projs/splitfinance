import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VerifyEmailBanner from "./VerifyEmailBanner";
import { useAuth } from "../context/AuthContext";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VerifyEmailBanner", () => {
  test("shows nothing once the address is confirmed", () => {
    useAuth.mockReturnValue({ user: { id: 1, emailVerified: true }, resendVerification: vi.fn() });

    const { container } = render(<VerifyEmailBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  test("shows nothing when nobody is signed in", () => {
    useAuth.mockReturnValue({ user: null, resendVerification: vi.fn() });

    const { container } = render(<VerifyEmailBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  // The wording matters as much as the presence: nothing the user came here
  // to do is blocked, so the banner must not read like a lockout.
  test("offers to resend, and says the rest of the app still works", () => {
    useAuth.mockReturnValue({ user: { id: 1, emailVerified: false }, resendVerification: vi.fn() });

    render(<VerifyEmailBanner />);

    expect(screen.getByText(/everything else works as normal/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resend the link/i })).toBeInTheDocument();
  });

  test("reports back after sending a fresh link", async () => {
    const user = userEvent.setup();
    const resendVerification = vi.fn().mockResolvedValue("Confirmation link sent - check your inbox.");
    useAuth.mockReturnValue({ user: { id: 1, emailVerified: false }, resendVerification });

    render(<VerifyEmailBanner />);
    await user.click(screen.getByRole("button", { name: /resend the link/i }));

    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
  });

  // Resending is rate limited on the server (it sends mail), so a refusal
  // is an expected outcome, not an edge case.
  test("surfaces the server's message when resending is refused", async () => {
    const user = userEvent.setup();
    const resendVerification = vi
      .fn()
      .mockRejectedValue({ response: { data: { error: "Too many attempts - please try again later." } } });
    useAuth.mockReturnValue({ user: { id: 1, emailVerified: false }, resendVerification });

    render(<VerifyEmailBanner />);
    await user.click(screen.getByRole("button", { name: /resend the link/i }));

    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
  });

  test("disables the button while the request is in flight", async () => {
    const user = userEvent.setup();
    let resolve;
    const resendVerification = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
    useAuth.mockReturnValue({ user: { id: 1, emailVerified: false }, resendVerification });

    render(<VerifyEmailBanner />);
    await user.click(screen.getByRole("button", { name: /resend the link/i }));

    expect(screen.getByRole("button", { name: /sending/i })).toBeDisabled();

    resolve("Confirmation link sent - check your inbox.");
    await waitFor(() => expect(screen.getByText(/check your inbox/i)).toBeInTheDocument());
  });
});

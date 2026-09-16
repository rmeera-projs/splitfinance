import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "./AuthContext";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

// Surfaces the bits of context under test as plain text/buttons, so the
// assertions read as "what would the app see" rather than poking at hooks.
function Probe() {
  const { user, loading, login, logout } = useAuth();
  if (loading) return <p>loading</p>;
  return (
    <div>
      <p>{user ? `signed in as ${user.name}` : "signed out"}</p>
      <button onClick={() => login("alice@example.com", "password123")}>log in</button>
      <button onClick={logout}>log out</button>
    </div>
  );
}

function renderAuth() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuthContext session bootstrap", () => {
  // The session cookie is HttpOnly, so the browser genuinely cannot read it
  // to find out whether it's signed in - only the server can answer that.
  // This is the request that replaced reading `user` out of localStorage.
  test("asks the server who the user is on mount", async () => {
    api.get.mockResolvedValue({ data: { id: 1, name: "Alice", username: "alice1" } });

    renderAuth();

    expect(await screen.findByText("signed in as Alice")).toBeInTheDocument();
    // skipAuthRedirect matters: a 401 from this probe is the signed-out
    // answer, and without it the client would redirect to /login the moment
    // a logged-out visitor opened /signup.
    expect(api.get).toHaveBeenCalledWith("/users/me", { skipAuthRedirect: true });
  });

  // A 401 here is the ordinary signed-out case, not a failure worth
  // surfacing - it must resolve `loading` rather than leaving the app stuck
  // on a blank screen forever.
  test("treats a rejected /users/me as signed out, and stops loading", async () => {
    api.get.mockRejectedValue({ response: { status: 401 } });

    renderAuth();

    expect(await screen.findByText("signed out")).toBeInTheDocument();
  });

  test("shows a loading state until the server answers", async () => {
    let resolve;
    api.get.mockReturnValue(new Promise((r) => (resolve = r)));

    renderAuth();

    expect(screen.getByText("loading")).toBeInTheDocument();

    resolve({ data: { id: 1, name: "Alice" } });
    expect(await screen.findByText("signed in as Alice")).toBeInTheDocument();
  });
});

describe("AuthContext email verification", () => {
  // Its own probe: verifyEmail works signed out too, so this deliberately
  // does not depend on the signed-in Probe above.
  function VerifyProbe() {
    const { user, loading, verifyEmail } = useAuth();
    if (loading) return <p>loading</p>;
    return (
      <div>
        <p>{user ? `verified: ${String(user.emailVerified)}` : "signed out"}</p>
        <button onClick={() => verifyEmail("abc123")}>verify</button>
      </div>
    );
  }

  function renderVerify() {
    return render(
      <AuthProvider>
        <VerifyProbe />
      </AuthProvider>
    );
  }

  // The banner has to disappear without a reload, which means the local
  // user must be refreshed from the server after confirming.
  test("refreshes the user after confirming so the banner clears", async () => {
    const user = userEvent.setup();
    api.get
      .mockResolvedValueOnce({ data: { id: 1, name: "Alice", emailVerified: false } })
      .mockResolvedValueOnce({ data: { id: 1, name: "Alice", emailVerified: true } });
    api.post.mockResolvedValue({ data: { message: "Email confirmed" } });

    renderVerify();
    await screen.findByText("verified: false");
    await user.click(screen.getByRole("button", { name: "verify" }));

    expect(await screen.findByText("verified: true")).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith("/auth/verify-email", { token: "abc123" });
  });

  // Confirming from a phone with no session here is the ordinary case - the
  // refresh 401s and that must not be reported as a failed confirmation.
  test("still resolves when there is no session to refresh", async () => {
    const user = userEvent.setup();
    api.get.mockRejectedValue({ response: { status: 401 } });
    api.post.mockResolvedValue({ data: { message: "Email confirmed" } });

    renderVerify();
    await screen.findByText("signed out");
    await user.click(screen.getByRole("button", { name: "verify" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/auth/verify-email", { token: "abc123" }));
    expect(screen.getByText("signed out")).toBeInTheDocument();
  });
});

describe("AuthContext login and logout", () => {
  test("takes the user from the login response, with no token to store", async () => {
    const user = userEvent.setup();
    api.get.mockRejectedValue({ response: { status: 401 } });
    api.post.mockResolvedValue({ data: { user: { id: 1, name: "Alice" } } });

    renderAuth();
    await screen.findByText("signed out");
    await user.click(screen.getByRole("button", { name: "log in" }));

    expect(await screen.findByText("signed in as Alice")).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith("/auth/login", {
      email: "alice@example.com",
      password: "password123",
    });
    // Nothing is persisted client-side any more - the browser holds the
    // session as an HttpOnly cookie the app can't see.
    expect(localStorage.getItem("token")).toBeNull();
  });

  // An HttpOnly cookie can't be deleted from JavaScript, so signing out is
  // only real if the server is asked to expire it.
  test("calls the server to end the session on logout", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ data: { id: 1, name: "Alice" } });
    api.post.mockResolvedValue({ data: { message: "Signed out." } });

    renderAuth();
    await screen.findByText("signed in as Alice");
    await user.click(screen.getByRole("button", { name: "log out" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/auth/logout"));
    expect(await screen.findByText("signed out")).toBeInTheDocument();
  });

  // If the network is down the cookie survives, but the server will reject
  // it anyway once reachable - so the user should still end up looking
  // signed out rather than stuck in a half-state.
  test("still signs out locally when the logout request fails", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ data: { id: 1, name: "Alice" } });
    api.post.mockRejectedValue(new Error("network down"));

    renderAuth();
    await screen.findByText("signed in as Alice");
    await user.click(screen.getByRole("button", { name: "log out" }));

    expect(await screen.findByText("signed out")).toBeInTheDocument();
  });
});

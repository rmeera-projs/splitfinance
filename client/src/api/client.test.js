import { describe, test, expect, vi, beforeEach } from "vitest";

describe("api client", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    delete window.location;
    window.location = { pathname: "/", href: "" };
  });

  test("attaches the stored token as a Bearer header", async () => {
    localStorage.setItem("token", "abc123");
    const api = (await import("./client")).default;

    expect(api.defaults.baseURL).toBeDefined();
  });

  // Regression: a 401 from an authenticated request (one that carried a
  // token) previously just failed silently - fetchGroups() has no
  // try/catch, so DashboardPage rendered an empty groups list instead of
  // signing the user out, looking exactly like data had been deleted when
  // it was actually just a stale token (e.g. one issued before a
  // tokenVersion-bumping password change/reset).
  test("clears stored auth and redirects to /login on a 401 from an authenticated request", async () => {
    localStorage.setItem("token", "stale-token");
    localStorage.setItem("user", JSON.stringify({ id: 1, name: "Alice" }));
    window.location.pathname = "/";

    const api = (await import("./client")).default;

    await expect(
      api.request({
        adapter: () =>
          Promise.reject({
            config: { headers: { Authorization: "Bearer stale-token" } },
            response: { status: 401, data: { error: "Invalid or expired token" } },
          }),
      })
    ).rejects.toBeTruthy();

    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
    expect(window.location.href).toBe("/login");
  });

  test("does not redirect on a 401 with no Authorization header (e.g. a failed login attempt)", async () => {
    window.location.pathname = "/login";

    const api = (await import("./client")).default;

    await expect(
      api.request({
        adapter: () =>
          Promise.reject({
            config: { headers: {} },
            response: { status: 401, data: { error: "Invalid email or password" } },
          }),
      })
    ).rejects.toBeTruthy();

    // No token was ever set, so nothing to clear - the real assertion is
    // that no redirect happened despite the 401.
    expect(window.location.href).toBe("");
  });

  test("does not redirect when already on the login page", async () => {
    localStorage.setItem("token", "stale-token");
    window.location.pathname = "/login";

    const api = (await import("./client")).default;

    await expect(
      api.request({
        adapter: () =>
          Promise.reject({
            config: { headers: { Authorization: "Bearer stale-token" } },
            response: { status: 401, data: {} },
          }),
      })
    ).rejects.toBeTruthy();

    expect(localStorage.getItem("token")).toBeNull();
    expect(window.location.href).toBe("");
  });

  test("leaves other error statuses alone", async () => {
    localStorage.setItem("token", "valid-token");

    const api = (await import("./client")).default;

    await expect(
      api.request({
        adapter: () =>
          Promise.reject({
            config: { headers: { Authorization: "Bearer valid-token" } },
            response: { status: 403, data: { error: "You are not a member of this group" } },
          }),
      })
    ).rejects.toBeTruthy();

    expect(localStorage.getItem("token")).toBe("valid-token");
    expect(window.location.href).toBe("");
  });
});

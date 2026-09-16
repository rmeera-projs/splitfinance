import { describe, test, expect, vi, beforeEach } from "vitest";

describe("api client", () => {
  beforeEach(() => {
    vi.resetModules();
    delete window.location;
    window.location = { pathname: "/", href: "" };
  });

  // The browser only attaches cookies to cross-origin requests when the
  // request opts in. Without this every authenticated call to the API - a
  // different origin from the frontend - would arrive with no session and
  // 401, so it's worth pinning rather than assuming.
  test("sends credentials so the session cookie is attached", async () => {
    const api = (await import("./client")).default;

    expect(api.defaults.withCredentials).toBe(true);
    expect(api.defaults.baseURL).toBeDefined();
  });

  // Regression: a 401 on an authenticated request previously just failed
  // silently - fetchGroups() has no try/catch, so DashboardPage rendered an
  // empty groups list instead of signing the user out, looking exactly like
  // data had been deleted when the session had really just gone stale (e.g.
  // a tokenVersion-bumping password change elsewhere).
  test("redirects to /login on a 401 from an ordinary request", async () => {
    window.location.pathname = "/";
    const api = (await import("./client")).default;

    await expect(
      api.request({
        url: "/groups",
        adapter: () =>
          Promise.reject({
            config: { url: "/groups" },
            response: { status: 401, data: { error: "Not signed in" } },
          }),
      })
    ).rejects.toBeTruthy();

    expect(window.location.href).toBe("/login");
  });

  // A 401 from /auth/login is the API answering "those credentials are
  // wrong" - not a statement about the current session. Redirecting would
  // throw the user off the very form trying to display the error.
  //
  // This used to be distinguished by checking for an Authorization header
  // on the request; with cookies the client genuinely can't see whether it
  // sent credentials, so the endpoint is the signal instead.
  test("does not redirect on a 401 from a failed login", async () => {
    window.location.pathname = "/login";
    const api = (await import("./client")).default;

    await expect(
      api.request({
        url: "/auth/login",
        adapter: () =>
          Promise.reject({
            config: { url: "/auth/login" },
            response: { status: 401, data: { error: "Invalid email or password" } },
          }),
      })
    ).rejects.toBeTruthy();

    expect(window.location.href).toBe("");
  });

  // Regression, caught by the e2e suite rather than here: AuthContext asks
  // /users/me on every page load to find out whether anyone is signed in,
  // so a 401 there is the answer, not a failure. Without the opt-out, simply
  // opening /signup while logged out redirected the visitor to /login -
  // mid-typing, since the probe resolves after the form has rendered.
  test("does not redirect on a 401 when the request opted out", async () => {
    window.location.pathname = "/signup";
    const api = (await import("./client")).default;

    await expect(
      api.request({
        url: "/users/me",
        skipAuthRedirect: true,
        adapter: () =>
          Promise.reject({
            config: { url: "/users/me", skipAuthRedirect: true },
            response: { status: 401, data: { error: "Not signed in" } },
          }),
      })
    ).rejects.toBeTruthy();

    expect(window.location.href).toBe("");
  });

  test("does not redirect when already on the login page", async () => {
    window.location.pathname = "/login";
    const api = (await import("./client")).default;

    await expect(
      api.request({
        url: "/users/me",
        adapter: () =>
          Promise.reject({ config: { url: "/users/me" }, response: { status: 401, data: {} } }),
      })
    ).rejects.toBeTruthy();

    expect(window.location.href).toBe("");
  });

  test("leaves other error statuses alone", async () => {
    const api = (await import("./client")).default;

    await expect(
      api.request({
        url: "/groups/9",
        adapter: () =>
          Promise.reject({
            config: { url: "/groups/9" },
            response: { status: 403, data: { error: "You are not a member of this group" } },
          }),
      })
    ).rejects.toBeTruthy();

    expect(window.location.href).toBe("");
  });
});

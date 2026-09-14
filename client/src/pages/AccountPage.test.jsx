import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AccountPage from "./AccountPage";
import { useAuth } from "../context/AuthContext";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const ME = { id: 1, name: "Alice", username: "alice1", email: "alice@example.com" };

function renderPage() {
  return render(
    <MemoryRouter>
      <AccountPage />
    </MemoryRouter>
  );
}

// Scopes queries to whichever <section> contains the given heading, so
// "Save changes" (Profile) and "Update password" (Change Password) can't
// be confused for each other's error/success text.
function sectionFor(headingText) {
  return within(screen.getByText(headingText).closest("section"));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AccountPage - profile", () => {
  test("pre-fills the form with the current user's info", () => {
    useAuth.mockReturnValue({ user: ME, updateProfile: vi.fn(), changePassword: vi.fn() });

    renderPage();

    expect(screen.getByDisplayValue("Alice")).toBeInTheDocument();
    expect(screen.getByDisplayValue("alice1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("alice@example.com")).toBeInTheDocument();
  });

  test("submits edited fields and shows a success message", async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ user: ME, updateProfile, changePassword: vi.fn() });

    renderPage();
    const profile = sectionFor("Profile");

    await user.clear(profile.getByLabelText("Name"));
    await user.type(profile.getByLabelText("Name"), "Alicia");
    await user.click(profile.getByRole("button", { name: "Save changes" }));

    expect(updateProfile).toHaveBeenCalledWith({ name: "Alicia", username: "alice1", email: "alice@example.com" });
    expect(await profile.findByText("Profile updated.")).toBeInTheDocument();
  });

  test("shows an error from the API without touching the password section", async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn().mockRejectedValue({ response: { data: { error: "That username is taken" } } });
    useAuth.mockReturnValue({ user: ME, updateProfile, changePassword: vi.fn() });

    renderPage();
    await user.click(sectionFor("Profile").getByRole("button", { name: "Save changes" }));

    expect(await sectionFor("Profile").findByText("That username is taken")).toBeInTheDocument();
    expect(screen.queryByText("Password updated.")).not.toBeInTheDocument();
  });
});

describe("AccountPage - change password", () => {
  test("submits current/new password and shows a success message", async () => {
    const user = userEvent.setup();
    const changePassword = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ user: ME, updateProfile: vi.fn(), changePassword });

    renderPage();
    const section = sectionFor("Change Password");

    await user.type(section.getByLabelText("Current password"), "oldpassword");
    await user.type(section.getByLabelText("New password"), "newpassword123");
    await user.click(section.getByRole("button", { name: "Update password" }));

    expect(changePassword).toHaveBeenCalledWith("oldpassword", "newpassword123");
    expect(await section.findByText("Password updated.")).toBeInTheDocument();
  });

  test("clears the password fields after a successful change", async () => {
    const user = userEvent.setup();
    const changePassword = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ user: ME, updateProfile: vi.fn(), changePassword });

    renderPage();
    const section = sectionFor("Change Password");

    await user.type(section.getByLabelText("Current password"), "oldpassword");
    await user.type(section.getByLabelText("New password"), "newpassword123");
    await user.click(section.getByRole("button", { name: "Update password" }));
    await section.findByText("Password updated.");

    expect(section.getByLabelText("Current password")).toHaveValue("");
    expect(section.getByLabelText("New password")).toHaveValue("");
  });

  test("shows an error when the current password is wrong", async () => {
    const user = userEvent.setup();
    const changePassword = vi.fn().mockRejectedValue({ response: { data: { error: "Current password is incorrect" } } });
    useAuth.mockReturnValue({ user: ME, updateProfile: vi.fn(), changePassword });

    renderPage();
    const section = sectionFor("Change Password");

    await user.type(section.getByLabelText("Current password"), "wrongpassword");
    await user.type(section.getByLabelText("New password"), "newpassword123");
    await user.click(section.getByRole("button", { name: "Update password" }));

    expect(await section.findByText("Current password is incorrect")).toBeInTheDocument();
  });
});

// Every spec signs up its own account so specs stay independent and can run
// in parallel against one shared stack - no shared fixture user to contend
// over, and no cleanup step that could wipe a parallel spec's data.
function uniqueUser(prefix = "e2e") {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return {
    name: `${prefix} ${suffix}`,
    username: `${prefix}_${suffix}`.toLowerCase(),
    email: `${prefix}_${suffix}@example.com`.toLowerCase(),
    password: "correct-horse-battery",
  };
}

async function signUp(page, user = uniqueUser()) {
  await page.goto("/signup");
  // exact, or "Name" also matches the "Username (letters, numbers,
  // underscores)" field and Playwright fails on the ambiguity.
  await page.getByPlaceholder("Name", { exact: true }).fill(user.name);
  await page.getByPlaceholder("Username (letters, numbers, underscores)").fill(user.username);
  await page.getByPlaceholder("Email").fill(user.email);
  await page.getByPlaceholder("Password (min 8 characters)").fill(user.password);
  await page.getByRole("button", { name: "Sign up" }).click();

  // Signup drops you straight on the dashboard.
  await page.waitForURL("/");
  return user;
}

async function createGroup(page, name, invites = []) {
  await page.getByPlaceholder("New group name").fill(name);
  if (invites.length) {
    await page
      .getByPlaceholder(/Invite by email or username/)
      .fill(invites.join(","));
  }
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await page.waitForURL(/\/groups\/\d+/);
}

// The account menu in the NavBar. Scoped to the nav and matched by role,
// because the user's name also appears in the dashboard's "Hi, <name>"
// heading - a bare getByText would be ambiguous.
function accountMenu(page, user) {
  return page.getByRole("navigation").getByRole("button", { name: new RegExp(user.name) });
}

async function logOut(page, user) {
  await accountMenu(page, user).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL(/\/login/);
}

async function logIn(page, user) {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(user.email);
  await page.getByPlaceholder("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
}

module.exports = { uniqueUser, signUp, createGroup, accountMenu, logOut, logIn };

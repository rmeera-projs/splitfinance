const { test, expect } = require("@playwright/test");
const { uniqueUser, signUp, createGroup, accountMenu, logOut, logIn } = require("./helpers");

test("signup lands on the dashboard with the new account's name", async ({ page }) => {
  const user = await signUp(page);

  await expect(page.getByRole("heading", { name: `Hi, ${user.name}` })).toBeVisible();
});

test("signing up, logging out, and logging back in preserves your groups", async ({ page }) => {
  const user = await signUp(page);
  await createGroup(page, "Persistent Group");

  await page.goto("/");
  await logOut(page, user);
  await logIn(page, user);
  await page.waitForURL("/");

  await expect(page.getByRole("link", { name: /Persistent Group/ })).toBeVisible();
});

test("rejects a login with the wrong password", async ({ page }) => {
  const user = await signUp(page);

  await page.goto("/");
  await logOut(page, user);

  await logIn(page, { ...user, password: "definitely-not-the-password" });

  await expect(page.getByText(/invalid/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("adding an expense splits it and shows who owes whom", async ({ page, browser }) => {
  // A second, real account to split with - created in its own browser
  // context so both users genuinely exist before the group is made.
  const other = uniqueUser("friend");
  const otherContext = await browser.newContext();
  await signUp(await otherContext.newPage(), other);
  await otherContext.close();

  await signUp(page);
  await createGroup(page, "Dinner Club", [other.username]);

  await page.getByPlaceholder("Description").first().fill("Tasting menu");
  await page.getByPlaceholder("Amount").first().fill("80");
  await page.getByRole("button", { name: "Add expense" }).click();

  // $80 paid by me, split evenly with one other person -> they owe me $40.
  await expect(page.getByText("Tasting menu")).toBeVisible();
  await expect(page.getByText(/owes/).first()).toBeVisible();
  await expect(page.getByText(/\$40\.00/).first()).toBeVisible();
});

test("settling up clears the balance", async ({ page, browser }) => {
  // The payer creates the group and fronts the money, so the account under
  // test (in `page`) is the one who owes and therefore gets a Settle up
  // button - the UI only offers it to the person on the paying side.
  const debtor = uniqueUser("debtor");
  const debtorContext = await browser.newContext();
  await signUp(await debtorContext.newPage(), debtor);
  await debtorContext.close();

  const payerContext = await browser.newContext();
  const payerPage = await payerContext.newPage();
  await signUp(payerPage);
  await createGroup(payerPage, "Road Trip", [debtor.username]);
  await payerPage.getByPlaceholder("Description").first().fill("Gas");
  await payerPage.getByPlaceholder("Amount").first().fill("50");
  await payerPage.getByRole("button", { name: "Add expense" }).click();
  await expect(payerPage.getByText(/\$25\.00/).first()).toBeVisible();
  const groupUrl = payerPage.url();
  await payerContext.close();

  await logIn(page, debtor);
  await page.waitForURL("/");
  await page.goto(groupUrl);

  await expect(page.getByText(/\$25\.00/).first()).toBeVisible();

  // Settling asks for confirmation via window.confirm, which Playwright
  // auto-dismisses unless something opts in - without this the click is a
  // no-op and the balance silently stays put.
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Settle up" }).click();

  await expect(page.getByText(/Everyone is settled up/)).toBeVisible();
});

// Money is integer cents end to end, so the one case worth driving through
// a real browser is an amount that can't divide evenly: $0.05 between two
// people is 3c and 2c, and the API rejects splits that don't sum to the
// total exactly. If the dollars->cents->display round trip were wrong
// anywhere, this is where it would show.
test("splits an amount that doesn't divide evenly, down to the cent", async ({ page, browser }) => {
  const other = uniqueUser("friend");
  const otherContext = await browser.newContext();
  await signUp(await otherContext.newPage(), other);
  await otherContext.close();

  await signUp(page);
  await createGroup(page, "Corner Shop", [other.username]);

  await page.getByPlaceholder("Description").first().fill("Penny sweets");
  await page.getByPlaceholder("Amount").first().fill("0.05");
  await page.getByRole("button", { name: "Add expense" }).click();

  await expect(page.getByText("Penny sweets")).toBeVisible();
  // The expense renders as $0.05, and the other person owes the 2c half.
  await expect(page.getByText(/\$0\.05/).first()).toBeVisible();
  await expect(page.getByText(/owes/).first()).toBeVisible();
  await expect(page.getByText(/\$0\.02/).first()).toBeVisible();
});

test("a signed-out visitor is redirected to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("the admin dashboard is not reachable by a normal account", async ({ page }) => {
  const user = await signUp(page);

  // The nav link is hidden for non-admins...
  await accountMenu(page, user).click();
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);

  // ...and typing the URL directly bounces back to the dashboard.
  await page.goto("/admin");
  await expect(page).toHaveURL("/");
});

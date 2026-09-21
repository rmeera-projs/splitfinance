const { test, expect } = require("@playwright/test");
const fs = require("fs");
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

  // Settle up opens an amount field holding the full balance; recording it
  // unchanged pays the whole thing.
  await page.getByRole("button", { name: "Settle up" }).click();
  await expect(page.getByLabel("Settlement amount")).toHaveValue("25.00");
  await page.getByRole("button", { name: "Record payment" }).click();

  await expect(page.getByText(/Everyone is settled up/)).toBeVisible();
});

// Partial payments were always accepted by the API but unreachable from the
// UI. Driven in a real browser because the round trip is the point: the
// amount typed as dollars has to arrive as cents, be checked against the
// live balance, and leave the right remainder on screen.
test("records a partial settlement and leaves the remainder owing", async ({ page, browser }) => {
  const debtor = uniqueUser("debtor");
  const debtorContext = await browser.newContext();
  await signUp(await debtorContext.newPage(), debtor);
  await debtorContext.close();

  const payerContext = await browser.newContext();
  const payerPage = await payerContext.newPage();
  await signUp(payerPage);
  await createGroup(payerPage, "Partial Trip", [debtor.username]);
  await payerPage.getByPlaceholder("Description").first().fill("Hotel");
  await payerPage.getByPlaceholder("Amount").first().fill("100");
  await payerPage.getByRole("button", { name: "Add expense" }).click();
  await expect(payerPage.getByText(/\$50\.00/).first()).toBeVisible();
  const groupUrl = payerPage.url();
  await payerContext.close();

  await logIn(page, debtor);
  await page.waitForURL("/");
  await page.goto(groupUrl);

  await page.getByRole("button", { name: "Settle up" }).click();
  const amount = page.getByLabel("Settlement amount");
  await amount.fill("20.50");
  await page.getByRole("button", { name: "Record payment" }).click();

  // $50.00 owed, $20.50 paid: $29.50 remains, and the debt is still listed.
  await expect(page.getByText(/owes .* \$29\.50/)).toBeVisible();
  await expect(page.getByText(/Everyone is settled up/)).toHaveCount(0);
});

// The dashboard answers "who do I owe" across every group without opening
// each one. Both sides are checked because the sign is the easiest thing to
// get backwards, and backwards means telling someone they're owed money
// they actually owe.
test("shows per-person balances on the dashboard for both people", async ({ page, browser }) => {
  const friend = uniqueUser("friend");
  const friendContext = await browser.newContext();
  const friendPage = await friendContext.newPage();
  await signUp(friendPage, friend);

  const me = await signUp(page);
  await createGroup(page, "Balances Club", [friend.username]);
  // Not "Groceries" - that is also a category name, so it matches a hidden
  // <option> in the category dropdown before it matches the expense.
  await page.getByPlaceholder("Description").first().fill("Farmers market haul");
  await page.getByPlaceholder("Amount").first().fill("30");
  await page.getByRole("button", { name: "Add expense" }).click();
  await expect(page.getByText("Farmers market haul")).toBeVisible();

  await page.goto("/");
  // exact: the default is a case-insensitive substring match, which also
  // matches the assistant's "Ask about your balances" heading.
  await expect(page.getByRole("heading", { name: "Balances", exact: true })).toBeVisible();
  await expect(page.getByText(/owes you \$15\.00/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Balances Club" }).first()).toBeVisible();

  await friendPage.goto("/");
  await expect(friendPage.getByText(me.name, { exact: true })).toBeVisible();
  await expect(friendPage.getByText(/you owe \$15\.00/)).toBeVisible();

  await friendContext.close();
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

// The point of the whole cookie migration: the session must be genuinely
// unreachable from page JavaScript, which is something only a real browser
// can demonstrate. An HttpOnly cookie is absent from document.cookie while
// still being sent on every request.
test("keeps the session out of reach of page JavaScript", async ({ page }) => {
  await signUp(page);

  const exposed = await page.evaluate(() => ({
    documentCookie: document.cookie,
    localStorage: JSON.stringify(window.localStorage),
    sessionStorage: JSON.stringify(window.sessionStorage),
  }));

  expect(exposed.documentCookie).not.toContain("session");
  expect(exposed.localStorage).not.toContain("token");
  expect(exposed.sessionStorage).not.toContain("token");

  // ...and yet the session is real: the browser is holding an HttpOnly
  // cookie and sending it, which is why this authenticated page loads.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /^Hi, / })).toBeVisible();

  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "session");
  expect(session).toBeDefined();
  expect(session.httpOnly).toBe(true);
  expect(session.sameSite).toBe("Lax");
});

// The WebSocket authenticates from the handshake's Cookie header now rather
// than a token passed explicitly, and a broken handshake fails silently -
// the page still works, it just never receives live updates. So this drives
// two real browsers and checks one actually sees the other's change.
test("delivers a live update to another member over the socket", async ({ page, browser }) => {
  const other = uniqueUser("watcher");
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await signUp(otherPage, other);

  await signUp(page);
  await createGroup(page, "Live Updates", [other.username]);
  const groupUrl = page.url();

  // The second member opens the same group and just watches.
  await otherPage.goto(groupUrl);
  await expect(otherPage.getByRole("heading", { name: "Live Updates" })).toBeVisible();

  await page.getByPlaceholder("Description").first().fill("Concert tickets");
  await page.getByPlaceholder("Amount").first().fill("120");
  await page.getByRole("button", { name: "Add expense" }).click();
  await expect(page.getByText("Concert tickets")).toBeVisible();

  // No reload here - this only appears if the socket handshake authenticated
  // and the activity reached the other browser.
  await expect(otherPage.getByText(/added an expense/i)).toBeVisible({ timeout: 10000 });
  await expect(otherPage.getByText("Concert tickets")).toBeVisible();

  await otherContext.close();
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

// Email verification gates only the AI-powered features. A real browser is
// the only place that shows both halves at once: the account works normally
// and the one Cohere-backed control refuses, with a prompt rather than a
// dead end. Every e2e account is freshly signed up and therefore
// unconfirmed, so this is the default state for the whole suite.
test("an unconfirmed account can split expenses but not use the AI parser", async ({ page }) => {
  await signUp(page);

  await expect(page.getByText(/confirm your email address to unlock/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /resend the link/i })).toBeVisible();

  await createGroup(page, "Unverified Group");

  // The ordinary path is untouched - this is the whole reason verification
  // gates the AI rather than the app.
  await page.getByPlaceholder("Description").first().fill("Coffee");
  await page.getByPlaceholder("Amount").first().fill("6");
  await page.getByRole("button", { name: "Add expense" }).click();
  await expect(page.getByText("Coffee")).toBeVisible();

  // The AI-backed control is the only thing that refuses, and it explains
  // itself rather than just failing.
  await page.getByPlaceholder(/Dinner \$60/).fill("spent 12 on lunch");
  await page.getByRole("button", { name: "Fill in form" }).click();
  await expect(page.getByText(/confirm your email address/i).last()).toBeVisible();
});

// Same gate as the AI parser above, exercised through the balances/spending
// chat box on the dashboard instead - proves the real route (requireAuth +
// requireVerifiedEmail + the assistant rate limiter, see
// assistantRoutes.js) is actually mounted and reachable from the browser,
// and that the component displays the server's exact refusal rather than a
// generic failure. The e2e stack has no Cohere key configured (see
// docker-compose.e2e.yml/.yml), so this is also as far as any e2e run can
// exercise this feature - a real answer from the assistant is only ever
// checked by assistantService.test.js's mocked-model unit tests.
test("the assistant chat gates on a confirmed email, just like the AI parser", async ({ page }) => {
  await signUp(page);

  await page.getByLabel("Ask the assistant").fill("who do I owe?");
  await page.getByRole("button", { name: "Ask" }).click();

  await expect(page.getByText(/confirm your email address/i).last()).toBeVisible();
});

// The receipt scanner is gated exactly like the other AI features. Only the
// refusal is reachable end to end (no Cohere key in this stack, and no way to
// confirm an email), but it proves the multipart upload leaves a real browser,
// clears CORS and the session cookie, and that the page shows the server's
// reason. The extraction itself is covered by receiptService.test.js.
test("an unconfirmed account can't scan a receipt, and is told why", async ({ page }) => {
  await signUp(page);
  await createGroup(page, "Receipt Group");

  await page.getByLabel("Scan a receipt").setInputFiles({
    name: "receipt.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]),
  });

  await expect(page.getByText(/confirm your email address/i).last()).toBeVisible();
});

// Filtering runs entirely client-side against data the page already has, so
// the risk isn't the arithmetic (that's covered by expenseFilters.test.js)
// but whether the real DOM actually narrows and restores the list when a
// person types - jsdom's text-matching quirks in the component tests are
// exactly the kind of thing that can hide a real rendering bug.
test("searching narrows the expense list and clearing brings it back", async ({ page }) => {
  await signUp(page);
  await createGroup(page, "Camping Trip");

  await page.getByPlaceholder("Description").first().fill("Tent rental");
  await page.getByPlaceholder("Amount").first().fill("40");
  await page.getByRole("button", { name: "Add expense" }).click();
  await expect(page.getByText("Tent rental")).toBeVisible();

  await page.getByPlaceholder("Description").first().fill("Firewood");
  await page.getByPlaceholder("Amount").first().fill("15");
  await page.getByRole("button", { name: "Add expense" }).click();
  await expect(page.getByText("Firewood")).toBeVisible();

  await page.getByLabel("Search expenses").fill("tent");
  await expect(page.getByText("Tent rental")).toBeVisible();
  await expect(page.getByText("Firewood")).not.toBeVisible();
  await expect(page.getByText(/Showing 1 of 2 expenses/)).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByText("Tent rental")).toBeVisible();
  await expect(page.getByText("Firewood")).toBeVisible();
});

// Everything about CSV export - the CSV content, escaping, filenames - has
// dedicated unit coverage; the one thing that can only be proven in a real
// browser is that clicking the button actually triggers real file
// downloads, since jsdom has no Blob-backed <a download> to observe.
test("exporting a group downloads an expenses CSV and a settlements CSV", async ({ page, browser }) => {
  const debtor = uniqueUser("debtor");
  const debtorContext = await browser.newContext();
  await signUp(await debtorContext.newPage(), debtor);
  await debtorContext.close();

  await signUp(page);
  await createGroup(page, "Export Test Trip", [debtor.username]);

  await page.getByPlaceholder("Description").first().fill("Campsite fee");
  await page.getByPlaceholder("Amount").first().fill("60");
  await page.getByRole("button", { name: "Add expense" }).click();
  await expect(page.getByText("Campsite fee")).toBeVisible();

  const downloads = [];
  page.on("download", (d) => downloads.push(d));

  await page.getByRole("button", { name: "Export CSV" }).click();
  // Two separate <a download> clicks fire in sequence, not one - give both
  // a moment to land rather than asserting immediately after the UI click.
  await expect.poll(() => downloads.length).toBe(2);

  const filenames = downloads.map((d) => d.suggestedFilename()).sort();
  expect(filenames).toEqual(["Export-Test-Trip-expenses.csv", "Export-Test-Trip-settlements.csv"]);

  const expensesDownload = downloads.find((d) => d.suggestedFilename().endsWith("-expenses.csv"));
  const expensesPath = await expensesDownload.path();
  const expensesCsv = fs.readFileSync(expensesPath, "utf8");

  // Not full-content equality - just that the real values a person would
  // actually check (who was there, what it cost, how it split) survived
  // the whole round trip: the click, the Blob, the disk write, re-reading it.
  expect(expensesCsv).toContain("Campsite fee");
  expect(expensesCsv).toContain("60.00");
  expect(expensesCsv).toContain("30.00"); // each member's half of the split
});

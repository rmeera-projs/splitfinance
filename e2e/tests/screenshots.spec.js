const { test, expect } = require("@playwright/test");
const path = require("path");
const { signUp, createGroup, logIn } = require("./helpers");

// Generates the screenshots embedded at the top of the README, by driving
// the real app rather than mocking up a picture of it - so what a reader
// sees is genuinely what the app renders, and regenerating after a UI
// change is `npm run screenshots` rather than a manual crop.
//
// Skipped in normal runs (it writes files into the repo); the npm script
// sets CAPTURE_SCREENSHOTS.
test.skip(!process.env.CAPTURE_SCREENSHOTS, "set CAPTURE_SCREENSHOTS=1 to regenerate README images");

const OUT_DIR = path.join(__dirname, "..", "..", "docs", "screenshots");

// Fixed, human-looking identities rather than the random ones the
// functional specs use - a README screenshot full of "user_mu3aobfzk8pp"
// looks like a test fixture, which is exactly the impression to avoid. The
// e2e database is disposable (docker-compose.e2e.yml keeps no volume), so
// these can safely be stable; signUp falls back to logging in if a
// previous capture on a still-running stack already created them.
const SAM = {
  name: "Sam Rivera",
  username: "samrivera",
  email: "sam@example.com",
  password: "correct-horse-battery",
};
const JORDAN = {
  name: "Jordan Lee",
  username: "jordanlee",
  email: "jordan@example.com",
  password: "correct-horse-battery",
};

async function signUpOrLogIn(page, user) {
  try {
    await signUp(page, user);
  } catch {
    await logIn(page, user);
    await page.waitForURL("/");
  }
}

test.use({ viewport: { width: 1280, height: 800 } });

test("capture dashboard and group views", async ({ page, browser }) => {
  const jordanContext = await browser.newContext();
  await signUpOrLogIn(await jordanContext.newPage(), JORDAN);
  await jordanContext.close();

  await signUpOrLogIn(page, SAM);

  await createGroup(page, "Barcelona Trip", [JORDAN.username]);

  const expenses = [
    ["Airbnb - 4 nights", "820"],
    ["Tapas at Quimet", "64.50"],
    ["Sagrada Familia tickets", "52"],
    ["Airport taxi", "38.40"],
  ];
  for (const [description, amount] of expenses) {
    await page.getByPlaceholder("Description").first().fill(description);
    await page.getByPlaceholder("Amount").first().fill(amount);
    await page.getByRole("button", { name: "Add expense" }).click();
    await expect(page.getByText(description)).toBeVisible();
  }

  // Full page here: the expense list sits below the insights and the
  // add-expense form, so a viewport-sized shot would cut off the very thing
  // a reader wants to see.
  await page.screenshot({ path: path.join(OUT_DIR, "group.png"), fullPage: true });

  // A second group, so the dashboard isn't a one-item list.
  await page.goto("/");
  await createGroup(page, "Flat 2B - Utilities", [JORDAN.username]);
  await page.getByPlaceholder("Description").first().fill("October internet");
  await page.getByPlaceholder("Amount").first().fill("45");
  await page.getByRole("button", { name: "Add expense" }).click();
  await expect(page.getByText("October internet")).toBeVisible();

  await page.goto("/");
  // .first(): the balances panel links to the group as well as the group
  // card below it, so an unqualified match is ambiguous once a balance has
  // loaded - and racy before it has.
  await expect(page.getByRole("link", { name: /Barcelona Trip/ }).first()).toBeVisible();
  // Tall enough for the whole dashboard now that it is two columns - a
  // viewport shot rather than fullPage, so this height is what decides
  // whether the last group card is cut in half.
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.screenshot({ path: path.join(OUT_DIR, "dashboard.png") });
});

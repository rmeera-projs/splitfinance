const { z } = require("zod");
const fields = require("./validators");

function messageFor(schema, value) {
  const result = z.object({ field: schema }).safeParse(value === undefined ? {} : { field: value });
  if (result.success) return null;
  return result.error.issues.map((i) => i.message).join(", ");
}

describe("field wording", () => {
  test.each([
    ["missing name", fields.requiredText("Name"), undefined, "Name is required"],
    ["empty name", fields.requiredText("Name"), "", "Name is required"],
    ["short password", fields.newPassword(), "abc", "Password must be at least 8 characters"],
    ["labelled short password", fields.newPassword("New password"), "abc", "New password must be at least 8 characters"],
    ["bad email", fields.email(), "not-an-email", "Enter a valid email address"],
    ["missing email", fields.email(), undefined, "Enter a valid email address"],
    ["bad username", fields.username(), "no spaces!", "Username must be 3-20 characters: letters, numbers, and underscores only"],
    ["id as string", fields.id("Group"), "7", "Group must be a valid id"],
    ["amount as string", fields.amountInCents(), "12", "Amount must be a number"],
    ["fractional amount", fields.amountInCents(), 12.5, "Amounts must be given in whole cents"],
    ["zero amount", fields.amountInCents(), 0, "Amount must be greater than zero"],
    ["oversized amount", fields.amountInCents(), fields.MAX_AMOUNT_CENTS + 1, "Amount is too large"],
  ])("%s", (_label, schema, value, expected) => {
    expect(messageFor(schema, value)).toBe(expected);
  });
});

// The one place zod 4 could change *behaviour* rather than wording is which
// email addresses it accepts. A regression here would lock people out at
// login, since the login schema validates the address before any lookup -
// so ordinary real-world shapes are pinned explicitly.
describe("email acceptance", () => {
  test.each([
    "alice@example.com",
    "first.last+tag@mail.example.co.uk",
    "o'brien@example.com",
    "user_name-1@example.io",
    "UPPER@EXAMPLE.COM",
  ])("accepts %s", (address) => {
    expect(messageFor(fields.email(), address)).toBeNull();
  });

  test.each(["no-at-sign", "two@@example.com", "trailing-dot.@example.com", "missing-tld@example", "spaces in@example.com"])(
    "rejects %s",
    (address) => {
      expect(messageFor(fields.email(), address)).toBe("Enter a valid email address");
    }
  );
});

test("amounts accept the column's full range", () => {
  expect(messageFor(fields.amountInCents(), 1)).toBeNull();
  expect(messageFor(fields.amountInCents(), fields.MAX_AMOUNT_CENTS)).toBeNull();
});

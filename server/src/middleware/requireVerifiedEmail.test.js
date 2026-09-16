const { requireVerifiedEmail } = require("./requireVerifiedEmail");

function mockRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

test("lets a confirmed account through", () => {
  const next = jest.fn();
  const res = mockRes();

  requireVerifiedEmail({ emailVerified: true, userId: 1 }, res, next);

  expect(next).toHaveBeenCalled();
  expect(res.status).not.toHaveBeenCalled();
});

test("refuses an unconfirmed account with a machine-readable code", () => {
  const next = jest.fn();
  const res = mockRes();

  requireVerifiedEmail({ emailVerified: false, userId: 1, ip: "203.0.113.4", originalUrl: "/api/expenses/parse" }, res, next);

  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(403);
  // The client keys its "resend confirmation" prompt off the code rather
  // than the prose, so this is the part that must not drift.
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "EMAIL_NOT_VERIFIED" }));
});

// requireAuth is what sets req.emailVerified. If this middleware were ever
// mounted before it, the flag would be undefined - which must fail closed,
// not open.
test("refuses when the flag is missing entirely", () => {
  const next = jest.fn();
  const res = mockRes();

  requireVerifiedEmail({ userId: 1 }, res, next);

  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(403);
});

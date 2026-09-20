process.env.JWT_SECRET = "test-secret";

const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/prisma", () => ({
  user: { findUnique: jest.fn() },
}));

jest.mock("../services/receiptService", () => ({ extractReceipt: jest.fn() }));

const app = require("../app");
const prisma = require("../config/prisma");
const { extractReceipt } = require("../services/receiptService");
const { MAX_RECEIPT_BYTES } = require("./receiptController");

const AUTH = { Cookie: `session=${jwt.sign({ userId: 1, tokenVersion: 0 }, process.env.JWT_SECRET)}` };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue({ tokenVersion: 0, emailVerifiedAt: new Date() });
});

function upload(buffer, filename = "receipt.jpg") {
  return request(app).post("/api/expenses/receipt").set(AUTH).attach("receipt", buffer, filename);
}

describe("POST /api/expenses/receipt", () => {
  test("returns the extracted merchant and total in cents", async () => {
    extractReceipt.mockResolvedValue({ merchant: "Olive Garden", total: 6050 });

    const res = await upload(JPEG);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ merchant: "Olive Garden", total: 6050 });
    expect(extractReceipt).toHaveBeenCalledWith(expect.any(Buffer), "image/jpeg");
  });

  test("trusts the bytes, not the filename or declared type", async () => {
    const res = await upload(Buffer.from("<html>not an image, however it is named</html>"), "receipt.jpg");

    expect(res.status).toBe(400);
    expect(extractReceipt).not.toHaveBeenCalled();
  });

  test("400s when no file is attached", async () => {
    const res = await request(app).post("/api/expenses/receipt").set(AUTH);

    expect(res.status).toBe(400);
  });

  test("413s an oversized upload without calling the model", async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(MAX_RECEIPT_BYTES)]);

    const res = await upload(big);

    expect(res.status).toBe(413);
    expect(extractReceipt).not.toHaveBeenCalled();
  });

  test("422s when nothing usable could be read", async () => {
    extractReceipt.mockResolvedValue(null);

    const res = await upload(JPEG);

    expect(res.status).toBe(422);
  });

  test("403s an unconfirmed account before reading the upload", async () => {
    prisma.user.findUnique.mockResolvedValue({ tokenVersion: 0, emailVerifiedAt: null });

    const res = await upload(JPEG);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
    expect(extractReceipt).not.toHaveBeenCalled();
  });

  test("401s with no session", async () => {
    const res = await request(app).post("/api/expenses/receipt").attach("receipt", JPEG, "r.jpg");

    expect(res.status).toBe(401);
  });
});

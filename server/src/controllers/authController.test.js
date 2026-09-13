process.env.JWT_SECRET = "test-secret";

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/prisma", () => ({
  user: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
}));

const app = require("../app");
const prisma = require("../config/prisma");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /api/auth/signup", () => {
  const validBody = { name: "Alice", username: "alice1", email: "alice@example.com", password: "password123" };

  test("creates an account and returns a token with the username included", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 1,
      name: "Alice",
      username: "alice1",
      email: "alice@example.com",
      passwordHash: "hashed",
    });

    const res = await request(app).post("/api/auth/signup").send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({ id: 1, name: "Alice", username: "alice1", email: "alice@example.com" });
    expect(jwt.verify(res.body.token, process.env.JWT_SECRET)).toMatchObject({ userId: 1 });
  });

  test("rejects a username with invalid characters", async () => {
    const res = await request(app).post("/api/auth/signup").send({ ...validBody, username: "al!ce" });

    expect(res.status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test("rejects a username shorter than 3 characters", async () => {
    const res = await request(app).post("/api/auth/signup").send({ ...validBody, username: "al" });

    expect(res.status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test("rejects a duplicate email with a specific message", async () => {
    prisma.user.findFirst.mockResolvedValue({ email: "alice@example.com", username: "someoneelse" });

    const res = await request(app).post("/api/auth/signup").send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/email already exists/i);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test("rejects a duplicate username with a specific message", async () => {
    prisma.user.findFirst.mockResolvedValue({ email: "someone-else@example.com", username: "alice1" });

    const res = await request(app).post("/api/auth/signup").send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/username is taken/i);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/login", () => {
  test("logs in with the correct password and returns the username", async () => {
    const passwordHash = await bcrypt.hash("password123", 10);
    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      name: "Alice",
      username: "alice1",
      email: "alice@example.com",
      passwordHash,
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "alice@example.com", password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: 1, name: "Alice", username: "alice1", email: "alice@example.com" });
  });

  test("rejects an unknown email", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "password123" });

    expect(res.status).toBe(401);
  });

  test("rejects the wrong password", async () => {
    const passwordHash = await bcrypt.hash("password123", 10);
    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      name: "Alice",
      username: "alice1",
      email: "alice@example.com",
      passwordHash,
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "alice@example.com", password: "wrong-password" });

    expect(res.status).toBe(401);
  });
});

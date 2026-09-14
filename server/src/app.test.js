process.env.JWT_SECRET = "test-secret";

const request = require("supertest");

jest.mock("./config/prisma", () => ({}));

const app = require("./app");

describe("app", () => {
  // Security-review regression: without this, express-rate-limit
  // (middleware/rateLimit.js) keys every visitor by Caddy's own address
  // (the only thing Express's socket actually sees in production), not
  // their real IP - "10 requests per IP" silently becomes "10 requests
  // total" for every visitor behind Caddy. `1` trusts exactly the one
  // reverse-proxy hop Caddy adds; see the comment in app.js for why that's
  // safe given this deployment's actual network topology.
  test("trusts exactly one reverse-proxy hop (Caddy) for client IP resolution", () => {
    expect(app.get("trust proxy")).toBe(1);
  });

  test("/health responds ok without authentication", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

const request = require("supertest");
const app = require("../../src/app");

// Creates a real account through the real signup endpoint - hashed
// password, real row, real JWT - rather than seeding Prisma directly, so
// the tests exercise the same path a user would.
async function signUp(overrides = {}) {
  const unique = Math.random().toString(36).slice(2, 10);
  const body = {
    name: overrides.name || `User ${unique}`,
    username: overrides.username || `user_${unique}`,
    email: overrides.email || `${unique}@example.com`,
    password: overrides.password || "correct-horse-battery",
  };

  const res = await request(app).post("/api/auth/signup").send(body);
  if (res.status !== 201) {
    throw new Error(`signUp failed (${res.status}): ${JSON.stringify(res.body)}`);
  }

  return {
    ...body,
    id: res.body.user.id,
    token: res.body.token,
    auth: { Authorization: `Bearer ${res.body.token}` },
  };
}

async function createGroup(user, { name = "Test Group", memberIdentifiers = [] } = {}) {
  const res = await request(app)
    .post("/api/groups")
    .set(user.auth)
    .send({ name, memberIdentifiers });

  if (res.status !== 201) {
    throw new Error(`createGroup failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function addExpense(user, { groupId, amount, description = "Test expense", paidBy, splits }) {
  const res = await request(app)
    .post("/api/expenses")
    .set(user.auth)
    .send({ groupId, amount, description, paidBy: paidBy ?? user.id, splits });

  return res;
}

module.exports = { signUp, createGroup, addExpense };

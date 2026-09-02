// Prisma `select` shape for exposing a User over the API. Always use this
// (never `include: { user: true }` / `{ payer: true }`, which pulls the
// bcrypt passwordHash along with everything else) wherever a related user
// is nested into a response.
const publicUserSelect = { id: true, name: true, email: true, createdAt: true };

module.exports = { publicUserSelect };

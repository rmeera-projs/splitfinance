// Prisma `select` shapes for exposing a User over the API. Always use one of
// these (never `include: { user: true }` / `{ payer: true }`, which pulls
// the bcrypt passwordHash along with everything else) wherever a related
// user is nested into a response.
//
// publicUserSelect includes email/createdAt and is only for the
// authenticated user's OWN account (see userController's getMe/
// updateProfile) - other group members don't need it to use the app, and
// exposing it to them turns every group member/expense payer field into an
// account-enumeration and PII leak, worse still once combined with a
// broken-object-level-authorization bug (a user id that isn't actually
// checked against group membership before being trusted).
//
// groupUserSelect is what every *other* user nested in a response should
// use instead - group members, expense payers, split participants - name/
// username only, no email or account-creation timestamp.
const publicUserSelect = { id: true, name: true, username: true, email: true, isAdmin: true, createdAt: true };
const groupUserSelect = { id: true, name: true, username: true };

module.exports = { publicUserSelect, groupUserSelect };

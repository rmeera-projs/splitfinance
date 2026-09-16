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
const publicUserSelect = {
  id: true,
  name: true,
  username: true,
  email: true,
  isAdmin: true,
  emailVerifiedAt: true,
  createdAt: true,
};
const groupUserSelect = { id: true, name: true, username: true };

// The signed-in user as the client sees them. Two jobs:
//
// It names the fields explicitly rather than spreading whatever it was
// given, so handing it a full Prisma row - which signup and login do - can
// never put passwordHash or tokenVersion in a response.
//
// And it converts emailVerifiedAt into the yes/no the client actually asks.
// Doing that here means signup, login and GET /users/me cannot disagree
// about what "verified" means, which is exactly the kind of drift that ends
// with a banner that will not go away after someone verifies.
function presentUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    isAdmin: user.isAdmin,
    emailVerified: Boolean(user.emailVerifiedAt),
    ...(user.createdAt !== undefined && { createdAt: user.createdAt }),
  };
}

module.exports = { publicUserSelect, groupUserSelect, presentUser };

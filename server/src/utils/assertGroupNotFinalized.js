const prisma = require("../config/prisma");
const { ApiError } = require("../middleware/errorHandler");

// A finalized group is a closed ledger: no new/edited/deleted expenses and
// no new members, but settlements (see settlementController) are still
// allowed against it. Shared between expenseController and groupController.
async function assertGroupNotFinalized(groupId) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { isFinalized: true },
  });
  if (group?.isFinalized) {
    throw new ApiError(400, "This group is finalized - reopen it to make changes");
  }
}

module.exports = { assertGroupNotFinalized };

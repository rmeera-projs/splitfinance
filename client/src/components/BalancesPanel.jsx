import { Link } from "react-router-dom";
import { formatCents } from "../utils/money";

// What the user owes, and is owed, per person across all their groups.
//
// Amounts arrive signed from the user's point of view (positive: they owe
// you; negative: you owe them), already netted across groups by the server
// (see balanceService.summarizeUserBalances). This component only presents
// them; it does no arithmetic of its own beyond taking an absolute value, so
// it can't disagree with the group pages.
//
// Each person keeps a per-group breakdown with links, because settling still
// happens one group at a time - the net figure says where you stand, the
// breakdown says where to go to clear it.

function describe(amount) {
  if (amount > 0) return { text: `owes you $${formatCents(amount)}`, tone: "text-emerald-700" };
  if (amount < 0) return { text: `you owe $${formatCents(-amount)}`, tone: "text-red-700" };
  return { text: "even", tone: "text-gray-500" };
}

export default function BalancesPanel({ balances }) {
  if (!balances) return null;

  const { totalOwedToYou, totalYouOwe, people } = balances;

  if (people.length === 0) {
    return <p className="text-sm text-gray-500">{"You're all settled up with everyone 🎉"}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white border rounded-lg p-3">
          <p className="text-xs text-gray-500">{"You're owed"}</p>
          <p className="text-lg font-semibold text-emerald-700">${formatCents(totalOwedToYou)}</p>
        </div>
        <div className="bg-white border rounded-lg p-3">
          <p className="text-xs text-gray-500">You owe</p>
          <p className="text-lg font-semibold text-red-700">${formatCents(totalYouOwe)}</p>
        </div>
      </div>

      <ul className="space-y-2">
        {people.map((person) => {
          const net = describe(person.net);
          return (
            <li key={person.user.id} className="bg-white border rounded-lg p-3">
              <p className="text-sm">
                <span className="font-medium">{person.user.name}</span>{" "}
                <span className={net.tone}>
                  {person.net === 0 ? "— you're even overall" : `— ${net.text}`}
                </span>
              </p>

              {/* A single group needs no breakdown: the line above already
                  says everything, and repeating it is just noise. */}
              {(person.groups.length > 1 || person.net === 0) && (
                <ul className="mt-1 space-y-0.5">
                  {person.groups.map((group) => {
                    const g = describe(group.amount);
                    return (
                      <li key={group.id} className="text-xs text-gray-600">
                        in{" "}
                        <Link to={`/groups/${group.id}`} className="text-emerald-600 hover:underline">
                          {group.name}
                        </Link>
                        : <span className={g.tone}>{g.text}</span>
                      </li>
                    );
                  })}
                </ul>
              )}

              {person.groups.length === 1 && person.net !== 0 && (
                <p className="mt-1 text-xs text-gray-600">
                  in{" "}
                  <Link to={`/groups/${person.groups[0].id}`} className="text-emerald-600 hover:underline">
                    {person.groups[0].name}
                  </Link>
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

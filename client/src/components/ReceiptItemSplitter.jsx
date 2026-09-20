import { useMemo, useState } from "react";
import { formatCents } from "../utils/money";
import { computeReceiptSplit } from "../utils/receiptSplit";

// Lets the person adding an expense say who had which item on a scanned
// receipt, and shows what that makes each person owe. It only presents and
// collects: all the arithmetic is receiptSplit.js, which guarantees the
// per-person amounts add up to the receipt total exactly.
//
// Every item starts assigned to everyone, because "shared" is right more often
// than any guess, and the person then unticks who didn't have it. Applying the
// split hands the amounts back to the add-expense form as an exact split - the
// person still reviews it there and presses Add expense themselves.
export default function ReceiptItemSplitter({ receipt, members, currentUserId, onApply, onCancel }) {
  const memberIds = useMemo(() => members.map((m) => m.id), [members]);
  const [assignments, setAssignments] = useState(() => receipt.items.map(() => memberIds));

  const result = useMemo(
    () => computeReceiptSplit(receipt.items, assignments, memberIds, receipt.total),
    [receipt, assignments, memberIds]
  );

  const labelFor = (m) => (m.id === currentUserId ? "You" : m.name);

  function toggle(itemIndex, memberId) {
    setAssignments((prev) =>
      prev.map((people, i) => {
        if (i !== itemIndex) return people;
        return people.includes(memberId) ? people.filter((id) => id !== memberId) : [...people, memberId];
      })
    );
  }

  const blocked = result.unassigned.length > 0;

  return (
    <div className="bg-white border border-emerald-200 rounded p-3 space-y-3" data-testid="receipt-splitter">
      <div className="flex justify-between items-start gap-2">
        <div>
          <p className="text-sm font-medium">Split {receipt.merchant || "this receipt"} by item</p>
          <p className="text-xs text-gray-500">Untick anyone who didn&apos;t have an item. Shared items split evenly.</p>
        </div>
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 hover:underline">
          Cancel
        </button>
      </div>

      <ul className="space-y-2">
        {receipt.items.map((item, i) => (
          <li key={i} className="text-sm">
            <div className="flex justify-between">
              <span>{item.description}</span>
              <span className="text-gray-700">${formatCents(item.amount)}</span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-0.5">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-1 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    aria-label={`${item.description} - ${labelFor(m)}`}
                    checked={assignments[i].includes(m.id)}
                    onChange={() => toggle(i, m.id)}
                  />
                  {labelFor(m)}
                </label>
              ))}
            </div>
          </li>
        ))}
      </ul>

      <div className="border-t pt-2 space-y-1 text-sm">
        <div className="flex justify-between text-gray-600">
          <span>Items</span>
          <span>${formatCents(result.itemsCents)}</span>
        </div>
        {result.extrasCents !== 0 && (
          <div className="flex justify-between text-gray-600">
            <span>{result.extrasCents > 0 ? "Tax, tip & other" : "Discounts & adjustments"}</span>
            <span>
              {result.extrasCents < 0 ? "-" : ""}${formatCents(Math.abs(result.extrasCents))}
            </span>
          </div>
        )}
        <div className="flex justify-between font-medium">
          <span>Receipt total</span>
          <span>${formatCents(receipt.total)}</span>
        </div>
        {result.extrasCents !== 0 && (
          <p className="text-xs text-gray-500">
            The difference is spread in proportion to what each person ordered, not evenly.
          </p>
        )}
      </div>

      <ul className="space-y-0.5 text-sm" aria-label="Each person owes">
        {members.map((m) => (
          <li key={m.id} className="flex justify-between">
            <span>{labelFor(m)}</span>
            <span className="font-medium">${formatCents(result.shares[m.id])}</span>
          </li>
        ))}
      </ul>

      {blocked && (
        <p className="text-sm text-red-600">
          {result.unassigned.length === 1 ? "One item isn't" : `${result.unassigned.length} items aren't`} assigned to anyone yet.
        </p>
      )}

      <button
        type="button"
        disabled={blocked}
        onClick={() => onApply({ shares: result.shares, total: receipt.total, merchant: receipt.merchant })}
        className="bg-emerald-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
      >
        Use this split
      </button>
    </div>
  );
}

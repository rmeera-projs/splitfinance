// Turns "who had which item on this receipt" into what each person owes.
//
// The whole point of this module is that the answer reconciles to the cent.
// The API rejects an expense whose splits do not add up to its total, with no
// tolerance, so every step here is integer cents and the final amounts sum to
// the receipt total exactly - never "close enough".
//
// The approach:
//   1. Each item's price is split evenly among the people assigned to it
//      (splitEvenly hands out any odd cents, so the parts equal the price).
//   2. Adding those up gives each person's share of the *items*.
//   3. Whatever is left between the items and the printed total - tax, tip,
//      service charge, rounding, or a discount if it is negative - is spread
//      in proportion to each person's item share, not evenly. Someone who
//      ordered the $40 steak carries more of the tip than someone who had a
//      $6 salad. The leftover is derived as (total - items), not read off the
//      receipt, which is what guarantees the result reconciles even when the
//      scan missed a line.

import { splitEvenly } from "./money";

// Splits a signed integer amount across weights so the parts sum to it
// exactly, using the largest-remainder method: everyone gets the floor of
// their exact share, then the cents still unassigned go one at a time to
// whoever was rounded down the most.
//
// BigInt for the multiplication only: an amount can be up to ~2.1 billion
// cents and a weight likewise, so the product overflows the 2^53 that a
// double represents exactly - and an inexact intermediate here would mean a
// split that silently fails to reconcile.
export function distributeProportionally(amount, weights) {
  if (weights.length === 0) return [];

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  // Nobody ordered anything (or every weight is zero): there is no basis for
  // proportions, so fall back to an even split rather than dividing by zero.
  if (totalWeight === 0) {
    const even = splitEvenly(Math.abs(amount), weights.length);
    return even.map((n) => (amount < 0 ? -n : n));
  }

  const sign = amount < 0 ? -1 : 1;
  const magnitude = BigInt(Math.abs(amount));
  const W = BigInt(totalWeight);

  const shares = weights.map((w) => {
    const product = magnitude * BigInt(w);
    return { floor: product / W, remainder: product % W };
  });

  const assigned = shares.reduce((sum, s) => sum + s.floor, BigInt(0));
  let leftover = Number(magnitude - assigned);

  // Largest remainder first; ties go to the earlier person so the result is
  // deterministic rather than depending on sort stability.
  const order = shares
    .map((s, i) => ({ i, remainder: s.remainder }))
    .sort((a, b) => (a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1));

  const result = shares.map((s) => Number(s.floor));
  for (let k = 0; k < leftover; k++) result[order[k].i] += 1;

  return result.map((n) => sign * n);
}

/**
 * @param {{amount: number}[]} items - line items, amounts in cents
 * @param {number[][]} assignments - for each item, the ids of the people who
 *   had it. Same length and order as `items`.
 * @param {number[]} memberIds - everyone who could owe something; the result
 *   has an entry for each of them (0 if they had nothing)
 * @param {number} totalCents - the receipt's printed total
 * @returns {{
 *   shares: Object<number, number>,
 *   itemsCents: number,
 *   extrasCents: number,
 *   unassigned: number[],
 * }} `shares` maps each member id to what they owe, summing to `totalCents`.
 *   `extrasCents` is the tax/tip/other spread across people (negative for a
 *   net discount). `unassigned` lists indexes of items nobody was given - if
 *   it is non-empty the shares are not meaningful yet.
 */
export function computeReceiptSplit(items, assignments, memberIds, totalCents) {
  const itemShare = Object.fromEntries(memberIds.map((id) => [id, 0]));
  const unassigned = [];

  items.forEach((item, index) => {
    const people = (assignments[index] || []).filter((id) => id in itemShare);
    if (people.length === 0) {
      unassigned.push(index);
      return;
    }
    const parts = splitEvenly(item.amount, people.length);
    people.forEach((id, i) => {
      itemShare[id] += parts[i];
    });
  });

  const itemsCents = memberIds.reduce((sum, id) => sum + itemShare[id], 0);
  // Unassigned items are excluded from itemsCents, so their price lands in the
  // extras and is spread proportionally. That keeps the sum exact while the
  // caller is still mid-assignment; the UI blocks applying until none remain.
  const extrasCents = totalCents - itemsCents;

  const extraParts = distributeProportionally(
    extrasCents,
    memberIds.map((id) => itemShare[id])
  );

  const shares = {};
  memberIds.forEach((id, i) => {
    shares[id] = itemShare[id] + extraParts[i];
  });

  return { shares, itemsCents, extrasCents, unassigned };
}

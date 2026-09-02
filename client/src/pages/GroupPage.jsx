import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function GroupPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [group, setGroup] = useState(null);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState(user.id);
  const [splitType, setSplitType] = useState("equal"); // "equal" | "exact" | "percentage"
  const [splitValues, setSplitValues] = useState({}); // userId -> string (exact $ or %)
  const [expenseError, setExpenseError] = useState("");

  useEffect(() => {
    fetchGroup();
  }, [id]);

  async function fetchGroup() {
    const { data } = await api.get(`/groups/${id}`);
    setGroup(data);
  }

  function setSplitValue(userId, value) {
    setSplitValues((prev) => ({ ...prev, [userId]: value }));
  }

  // Builds the {userId, amountOwed} list to send to the API, based on the
  // selected split type. Returns null (and sets expenseError) if invalid.
  function buildSplits(members, total) {
    if (splitType === "equal") {
      const share = Math.round((total / members.length) * 100) / 100;
      const splits = members.map((m) => ({ userId: m.id, amountOwed: share }));
      // Rounding may leave a cent or two unaccounted for; dump the remainder
      // on the first split so the total always matches exactly.
      const diff = Math.round((total - share * members.length) * 100) / 100;
      splits[0].amountOwed = Math.round((splits[0].amountOwed + diff) * 100) / 100;
      return splits;
    }

    if (splitType === "exact") {
      const splits = members
        .map((m) => ({ userId: m.id, amountOwed: Number(splitValues[m.id] || 0) }))
        .filter((s) => s.amountOwed > 0);
      const sum = splits.reduce((s, x) => s + x.amountOwed, 0);
      if (Math.abs(sum - total) > 0.01) {
        setExpenseError(`Exact amounts must add up to $${total.toFixed(2)} (currently $${sum.toFixed(2)})`);
        return null;
      }
      return splits;
    }

    // percentage
    const pctEntries = members
      .map((m) => ({ userId: m.id, pct: Number(splitValues[m.id] || 0) }))
      .filter((s) => s.pct > 0);
    const pctSum = pctEntries.reduce((s, x) => s + x.pct, 0);
    if (Math.abs(pctSum - 100) > 0.01) {
      setExpenseError(`Percentages must add up to 100% (currently ${pctSum}%)`);
      return null;
    }
    const splits = pctEntries.map((s) => ({
      userId: s.userId,
      amountOwed: Math.round(((total * s.pct) / 100) * 100) / 100,
    }));
    // Fix rounding so the split total matches the expense total exactly.
    const sum = splits.reduce((s, x) => s + x.amountOwed, 0);
    const diff = Math.round((total - sum) * 100) / 100;
    splits[0].amountOwed = Math.round((splits[0].amountOwed + diff) * 100) / 100;
    return splits;
  }

  async function handleAddExpense(e) {
    e.preventDefault();
    setExpenseError("");
    if (!description.trim() || !amount) return;

    const total = Number(amount);
    const members = group.members.map((m) => m.user);
    const splits = buildSplits(members, total);
    if (!splits) return;

    try {
      await api.post("/expenses", {
        groupId: Number(id),
        paidBy: Number(paidBy),
        amount: total,
        description,
        splits,
      });

      setDescription("");
      setAmount("");
      setSplitValues({});
      fetchGroup();
    } catch (err) {
      setExpenseError(err.response?.data?.error || "Failed to add expense");
    }
  }

  function nameFor(userId) {
    return group.members.find((m) => m.user.id === userId)?.user.name || "Unknown";
  }

  if (!group) return null;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <Link to="/" className="text-sm text-emerald-600 hover:underline">
        &larr; Back to groups
      </Link>
      <h1 className="text-2xl font-bold mt-2 mb-6">{group.name}</h1>

      <section className="mb-8">
        <h2 className="font-semibold mb-2">Balances</h2>
        {group.balances.length === 0 && (
          <p className="text-sm text-gray-500">Everyone is settled up 🎉</p>
        )}
        <ul className="space-y-1">
          {group.balances.map((b, i) => (
            <li key={i} className="text-sm bg-white border rounded p-2">
              <span className="font-medium">{nameFor(b.from)}</span> owes{" "}
              <span className="font-medium">{nameFor(b.to)}</span> ${b.amount.toFixed(2)}
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="font-semibold mb-2">Add expense</h2>
        <form onSubmit={handleAddExpense} className="space-y-3">
          <div className="flex gap-2">
            <input
              className="flex-1 border rounded px-3 py-2"
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <input
              className="w-28 border rounded px-3 py-2"
              type="number"
              step="0.01"
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="flex gap-2 items-center text-sm">
            <label className="text-gray-600">Paid by</label>
            <select
              className="border rounded px-2 py-1"
              value={paidBy}
              onChange={(e) => setPaidBy(Number(e.target.value))}
            >
              {group.members.map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.id === user.id ? "You" : m.user.name}
                </option>
              ))}
            </select>

            <label className="text-gray-600 ml-4">Split</label>
            <select
              className="border rounded px-2 py-1"
              value={splitType}
              onChange={(e) => setSplitType(e.target.value)}
            >
              <option value="equal">Equally</option>
              <option value="exact">By exact amount</option>
              <option value="percentage">By percentage</option>
            </select>
          </div>

          {splitType !== "equal" && (
            <div className="space-y-1 bg-white border rounded p-3">
              {group.members.map((m) => (
                <div key={m.user.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">{m.user.id === user.id ? "You" : m.user.name}</span>
                  <input
                    className="w-24 border rounded px-2 py-1"
                    type="number"
                    step="0.01"
                    placeholder={splitType === "exact" ? "$" : "%"}
                    value={splitValues[m.user.id] || ""}
                    onChange={(e) => setSplitValue(m.user.id, e.target.value)}
                  />
                  <span className="text-gray-400">{splitType === "exact" ? "$" : "%"}</span>
                </div>
              ))}
            </div>
          )}

          {expenseError && <p className="text-sm text-red-600">{expenseError}</p>}

          <button className="bg-emerald-600 text-white px-4 py-2 rounded font-medium hover:bg-emerald-700">
            Add expense
          </button>
        </form>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Activity</h2>
        <ul className="space-y-2">
          {group.expenses.map((exp) => (
            <li key={exp.id} className="bg-white border rounded p-3 text-sm">
              <span className="font-medium">{exp.payer.name}</span> paid{" "}
              <span className="font-medium">${Number(exp.amount).toFixed(2)}</span> for{" "}
              {exp.description}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

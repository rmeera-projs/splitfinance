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

  useEffect(() => {
    fetchGroup();
  }, [id]);

  async function fetchGroup() {
    const { data } = await api.get(`/groups/${id}`);
    setGroup(data);
  }

  // Simplest possible split: equally among all current group members.
  async function handleAddExpense(e) {
    e.preventDefault();
    if (!description.trim() || !amount) return;

    const members = group.members.map((m) => m.user);
    const share = Math.round((Number(amount) / members.length) * 100) / 100;
    const splits = members.map((m) => ({ userId: m.id, amountOwed: share }));

    await api.post("/expenses", {
      groupId: Number(id),
      paidBy: user.id,
      amount: Number(amount),
      description,
      splits,
    });

    setDescription("");
    setAmount("");
    fetchGroup();
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
        <h2 className="font-semibold mb-2">Add expense (split equally)</h2>
        <form onSubmit={handleAddExpense} className="flex gap-2">
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
          <button className="bg-emerald-600 text-white px-4 rounded font-medium hover:bg-emerald-700">
            Add
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

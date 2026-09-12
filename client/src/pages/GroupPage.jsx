import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import InsightsPanel from "../components/InsightsPanel";
import { getSocket } from "../realtime/socket";

// Human-readable text for the "someone else changed this group" banner -
// deliberately generic (not "Alice added an expense") since the payload
// only carries an actorId, not a name; nameFor() below fills that in.
const ACTIVITY_MESSAGES = {
  "expense-added": "added an expense",
  "expense-updated": "edited an expense",
  "expense-deleted": "deleted an expense",
  "expense-category": "changed an expense's category",
  settlement: "recorded a settlement",
  finalize: "finalized this group",
  reopen: "reopened this group",
  "member-added": "added a member",
};

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

  // Fixed category list from the server (see categorizationService),
  // used to populate the manual-override dropdown on each expense.
  const [categories, setCategories] = useState([]);

  const [editingId, setEditingId] = useState(null);
  const [editDescription, setEditDescription] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editPaidBy, setEditPaidBy] = useState(null);
  const [editSplitType, setEditSplitType] = useState("exact");
  const [editSplitValues, setEditSplitValues] = useState({});
  const [editError, setEditError] = useState("");

  const [memberEmails, setMemberEmails] = useState("");
  const [memberError, setMemberError] = useState("");

  // Set when a socket "group-activity" event arrives for this group from
  // someone else - shown as a dismissable banner rather than silently
  // refetching, so an in-progress edit/add form is never yanked out from
  // under the person using it.
  const [activityNotice, setActivityNotice] = useState(null);

  useEffect(() => {
    fetchGroup();
    api
      .get("/expenses/categories")
      .then(({ data }) => setCategories(data.categories))
      .catch(() => {});
  }, [id]);

  // Live "someone changed this group" notice via WebSocket. Joins this
  // group's room on mount and leaves it on unmount/id change - a socket
  // only ever needs to hear about the one group currently on screen.
  useEffect(() => {
    const socket = getSocket();
    socket.connect();
    socket.emit("join-group", id);

    function handleActivity(payload) {
      if (String(payload.groupId) !== String(id)) return;
      // It was our own action from this same tab - we already have the
      // fresh data from the API response that triggered it.
      if (payload.actorId === user.id) return;
      setActivityNotice(payload);
    }

    socket.on("group-activity", handleActivity);

    return () => {
      socket.emit("leave-group", id);
      socket.off("group-activity", handleActivity);
    };
  }, [id, user.id]);

  async function fetchGroup() {
    const { data } = await api.get(`/groups/${id}`);
    setGroup(data);
  }

  function setSplitValue(userId, value) {
    setSplitValues((prev) => ({ ...prev, [userId]: value }));
  }

  function setEditSplitValue(userId, value) {
    setEditSplitValues((prev) => ({ ...prev, [userId]: value }));
  }

  // Builds the {userId, amountOwed} list to send to the API, based on the
  // given split type/values. Returns null (and reports via onError) if
  // invalid. Shared by both the add-expense and edit-expense forms.
  function buildSplits(members, total, type, values, onError) {
    if (type === "equal") {
      const share = Math.round((total / members.length) * 100) / 100;
      const splits = members.map((m) => ({ userId: m.id, amountOwed: share }));
      // Rounding may leave a cent or two unaccounted for; dump the remainder
      // on the first split so the total always matches exactly.
      const diff = Math.round((total - share * members.length) * 100) / 100;
      splits[0].amountOwed = Math.round((splits[0].amountOwed + diff) * 100) / 100;
      return splits;
    }

    if (type === "exact") {
      const splits = members
        .map((m) => ({ userId: m.id, amountOwed: Number(values[m.id] || 0) }))
        .filter((s) => s.amountOwed > 0);
      const sum = splits.reduce((s, x) => s + x.amountOwed, 0);
      if (Math.abs(sum - total) > 0.01) {
        onError(`Exact amounts must add up to $${total.toFixed(2)} (currently $${sum.toFixed(2)})`);
        return null;
      }
      return splits;
    }

    // percentage
    const pctEntries = members
      .map((m) => ({ userId: m.id, pct: Number(values[m.id] || 0) }))
      .filter((s) => s.pct > 0);
    const pctSum = pctEntries.reduce((s, x) => s + x.pct, 0);
    if (Math.abs(pctSum - 100) > 0.01) {
      onError(`Percentages must add up to 100% (currently ${pctSum}%)`);
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
    const splits = buildSplits(members, total, splitType, splitValues, setExpenseError);
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

  function startEdit(exp) {
    setEditingId(exp.id);
    setEditDescription(exp.description);
    setEditAmount(String(exp.amount));
    setEditPaidBy(exp.payer.id);
    // Default to "exact" and prefill with the expense's actual current
    // splits, so editing preserves the existing distribution unless the
    // user deliberately switches split type.
    setEditSplitType("exact");
    const initialValues = {};
    exp.splits.forEach((s) => {
      initialValues[s.userId] = String(s.amountOwed);
    });
    setEditSplitValues(initialValues);
    setEditError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError("");
  }

  async function handleSaveEdit(e, expenseId) {
    e.preventDefault();
    setEditError("");
    if (!editDescription.trim() || !editAmount) return;

    const total = Number(editAmount);
    const members = group.members.map((m) => m.user);
    const splits = buildSplits(members, total, editSplitType, editSplitValues, setEditError);
    if (!splits) return;

    try {
      await api.patch(`/expenses/${expenseId}`, {
        paidBy: Number(editPaidBy),
        amount: total,
        description: editDescription,
        splits,
      });

      setEditingId(null);
      fetchGroup();
    } catch (err) {
      setEditError(err.response?.data?.error || "Failed to update expense");
    }
  }

  async function handleDeleteExpense(expenseId) {
    if (!window.confirm("Delete this expense?")) return;
    try {
      await api.delete(`/expenses/${expenseId}`);
      fetchGroup();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to delete expense");
    }
  }

  // Any group member can correct a mis-categorized expense (not just the
  // payer) and it works even on a finalized group, since it's metadata
  // rather than a financial change - see updateExpenseCategory on the server.
  async function handleCategoryChange(expenseId, category) {
    try {
      await api.patch(`/expenses/${expenseId}/category`, { category });
      fetchGroup();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update category");
    }
  }

  // Settlements are always recorded as "the current user paid" - the API
  // takes fromUser from the auth token, not the request body, so this is
  // only ever shown for balances where the current user is the one who owes.
  async function handleSettleUp(balance) {
    if (!window.confirm(`Record that you paid ${nameFor(balance.to)} $${balance.amount.toFixed(2)}?`)) return;
    try {
      await api.post("/settlements", {
        groupId: Number(id),
        toUser: balance.to,
        amount: balance.amount,
      });
      fetchGroup();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to record settlement");
    }
  }

  // Same comma/newline-separated pattern as creating a group (DashboardPage) -
  // only emails that already belong to a registered user get added, and any
  // that don't (or that are already members) are reported back and skipped.
  async function handleAddMembers(e) {
    e.preventDefault();
    setMemberError("");
    const emails = memberEmails
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (emails.length === 0) return;

    try {
      const { data } = await api.post(`/groups/${id}/members`, { memberEmails: emails });
      setMemberEmails("");
      if (data.unmatchedEmails?.length) {
        setMemberError(
          `Added, but these emails have no account yet so weren't added: ${data.unmatchedEmails.join(", ")}`
        );
      }
      fetchGroup();
    } catch (err) {
      setMemberError(err.response?.data?.error || "Failed to add member");
    }
  }

  async function handleToggleFinalize() {
    const finalized = !group.isFinalized;
    const message = finalized
      ? "Finalize this group? No one will be able to add, edit, or delete expenses until it's reopened."
      : "Reopen this group so expenses can be added again?";
    if (!window.confirm(message)) return;
    try {
      await api.patch(`/groups/${id}/finalize`, { finalized });
      fetchGroup();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update group");
    }
  }

  function nameFor(userId) {
    return group.members.find((m) => m.user.id === userId)?.user.name || "Unknown";
  }

  function refreshFromNotice() {
    setActivityNotice(null);
    fetchGroup();
  }

  if (!group) return null;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <Link to="/" className="text-sm text-emerald-600 hover:underline">
        &larr; Back to groups
      </Link>
      <div className="flex items-center justify-between mt-2 mb-6">
        <h1 className="text-2xl font-bold">
          {group.name}
          {group.isFinalized && (
            <span className="ml-2 inline-block text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full align-middle">
              Finalized
            </span>
          )}
        </h1>
        <button
          onClick={handleToggleFinalize}
          className="text-sm border px-3 py-1 rounded hover:bg-gray-50"
        >
          {group.isFinalized ? "Reopen group" : "Finalize group"}
        </button>
      </div>

      {activityNotice && (
        <div className="mb-6 flex items-center justify-between gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded px-3 py-2">
          <span>
            {nameFor(activityNotice.actorId)}{" "}
            {ACTIVITY_MESSAGES[activityNotice.type] || "made a change"} - refresh to see it.
          </span>
          <div className="flex gap-3 shrink-0">
            <button onClick={refreshFromNotice} className="font-medium hover:underline">
              Refresh
            </button>
            <button
              onClick={() => setActivityNotice(null)}
              aria-label="Dismiss"
              className="text-amber-500 hover:text-amber-700"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <section className="mb-8">
        <h2 className="font-semibold mb-2">Balances</h2>
        {group.balances.length === 0 && (
          <p className="text-sm text-gray-500">Everyone is settled up 🎉</p>
        )}
        <ul className="space-y-1">
          {group.balances.map((b, i) => (
            <li key={i} className="text-sm bg-white border rounded p-2 flex items-center justify-between gap-2">
              <span>
                <span className="font-medium">{nameFor(b.from)}</span> owes{" "}
                <span className="font-medium">{nameFor(b.to)}</span> ${b.amount.toFixed(2)}
              </span>
              {b.from === user.id && (
                <button
                  onClick={() => handleSettleUp(b)}
                  className="text-xs text-emerald-600 hover:underline shrink-0"
                >
                  Settle up
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="font-semibold mb-2">Members</h2>
        <ul className="flex flex-wrap gap-2 mb-3">
          {group.members.map((m) => (
            <li
              key={m.user.id}
              className="text-sm bg-white border rounded-full px-3 py-1"
            >
              {m.user.id === user.id ? "You" : m.user.name}
            </li>
          ))}
        </ul>
        {group.isFinalized ? (
          <p className="text-sm text-gray-500">
            This group is finalized. Reopen it to add members.
          </p>
        ) : (
          <form onSubmit={handleAddMembers} className="flex gap-2">
            <input
              className="flex-1 border rounded px-3 py-2 text-sm"
              placeholder="Add by email, comma separated (must already have an account)"
              value={memberEmails}
              onChange={(e) => setMemberEmails(e.target.value)}
            />
            <button className="text-sm border px-3 py-2 rounded hover:bg-gray-50">
              Add
            </button>
          </form>
        )}
        {memberError && <p className="text-sm text-red-600 mt-2">{memberError}</p>}
      </section>

      <section className="mb-8">
        <h2 className="font-semibold mb-2">Insights</h2>
        <InsightsPanel
          items={group.expenses.map((exp) => ({
            amount: Number(exp.amount),
            category: exp.category,
            date: exp.date,
            payer: exp.payer.name,
          }))}
          dimensionLabel="Member"
          dimension={(item) => item.payer}
          dimensionValues={group.members.map((m) => m.user.name)}
        />
      </section>

      <section className="mb-8">
        <h2 className="font-semibold mb-2">Add expense</h2>
        {group.isFinalized ? (
          <p className="text-sm text-gray-500">
            This group is finalized. Reopen it to add expenses.
          </p>
        ) : (
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
        )}
      </section>

      <section>
        <h2 className="font-semibold mb-2">Activity</h2>
        <ul className="space-y-2">
          {group.expenses.map((exp) =>
            editingId === exp.id ? (
              <li key={exp.id} className="bg-white border rounded p-3 text-sm">
                <form onSubmit={(e) => handleSaveEdit(e, exp.id)} className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      className="flex-1 border rounded px-2 py-1"
                      placeholder="Description"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                    />
                    <input
                      className="w-24 border rounded px-2 py-1"
                      type="number"
                      step="0.01"
                      placeholder="Amount"
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                    />
                  </div>

                  <div className="flex gap-2 items-center text-xs">
                    <label className="text-gray-600">Paid by</label>
                    <select
                      className="border rounded px-2 py-1"
                      value={editPaidBy ?? ""}
                      onChange={(e) => setEditPaidBy(Number(e.target.value))}
                    >
                      {group.members.map((m) => (
                        <option key={m.user.id} value={m.user.id}>
                          {m.user.id === user.id ? "You" : m.user.name}
                        </option>
                      ))}
                    </select>

                    <label className="text-gray-600 ml-2">Split</label>
                    <select
                      className="border rounded px-2 py-1"
                      value={editSplitType}
                      onChange={(e) => setEditSplitType(e.target.value)}
                    >
                      <option value="equal">Equally</option>
                      <option value="exact">By exact amount</option>
                      <option value="percentage">By percentage</option>
                    </select>
                  </div>

                  {editSplitType !== "equal" && (
                    <div className="space-y-1 bg-gray-50 border rounded p-2">
                      {group.members.map((m) => (
                        <div key={m.user.id} className="flex items-center gap-2 text-xs">
                          <span className="flex-1">{m.user.id === user.id ? "You" : m.user.name}</span>
                          <input
                            className="w-20 border rounded px-2 py-1"
                            type="number"
                            step="0.01"
                            placeholder={editSplitType === "exact" ? "$" : "%"}
                            value={editSplitValues[m.user.id] || ""}
                            onChange={(e) => setEditSplitValue(m.user.id, e.target.value)}
                          />
                          <span className="text-gray-400">{editSplitType === "exact" ? "$" : "%"}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {editError && <p className="text-xs text-red-600">{editError}</p>}

                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="text-xs bg-emerald-600 text-white px-3 py-1 rounded font-medium hover:bg-emerald-700"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="text-xs border px-3 py-1 rounded hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </li>
            ) : (
              <li key={exp.id} className="bg-white border rounded p-3 text-sm flex items-start justify-between gap-2">
                <div>
                  <span className="font-medium">{exp.payer.name}</span> paid{" "}
                  <span className="font-medium">${Number(exp.amount).toFixed(2)}</span> for{" "}
                  {exp.description}
                  {exp.category && categories.length > 0 && (
                    <select
                      value={exp.category}
                      onChange={(e) => handleCategoryChange(exp.id, e.target.value)}
                      title="Change category"
                      className="ml-2 inline-block text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full align-middle border-0 cursor-pointer"
                    >
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  )}
                  {exp.category && categories.length === 0 && (
                    <span className="ml-2 inline-block text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full align-middle">
                      {exp.category}
                    </span>
                  )}
                </div>
                {exp.payer.id === user.id && !group.isFinalized && (
                  <div className="flex gap-2 shrink-0 text-xs">
                    <button onClick={() => startEdit(exp)} className="text-emerald-600 hover:underline">
                      Edit
                    </button>
                    <button onClick={() => handleDeleteExpense(exp.id)} className="text-red-600 hover:underline">
                      Delete
                    </button>
                  </div>
                )}
              </li>
            )
          )}
        </ul>
      </section>
    </div>
  );
}

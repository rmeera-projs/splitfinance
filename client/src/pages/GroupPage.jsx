import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import InsightsPanel from "../components/InsightsPanel";
import { getSocket } from "../realtime/socket";
import { parseAmountToCents, formatCents, centsToInputValue, splitEvenly } from "../utils/money";

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
  // null means "everyone currently in the group" - the common case, and one
  // that shouldn't go stale if someone else is added to the group while
  // this form is open. Only becomes an explicit array once the user (or a
  // parsed sentence) actually excludes someone.
  const [splitMembers, setSplitMembers] = useState(null);
  const [expenseError, setExpenseError] = useState("");

  // Natural-language expense entry - parses free text into the same
  // description/amount/paidBy/split state above rather than creating the
  // expense directly, so a bad parse just means editing the pre-filled
  // form, not a wrong charge silently going through.
  const [nlText, setNlText] = useState("");
  const [nlLoading, setNlLoading] = useState(false);
  const [nlError, setNlError] = useState("");

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

  // Settling up is an inline form on the balance row rather than a confirm()
  // dialog, because it now takes an amount: the field is pre-filled with the
  // full balance, so paying in full is still one click, and editing it down
  // records a partial payment. Only one row is open at a time, keyed by the
  // debt's from/to pair.
  const [settlingKey, setSettlingKey] = useState(null);
  const [settleAmount, setSettleAmount] = useState("");
  const [settleError, setSettleError] = useState("");
  const [settleSaving, setSettleSaving] = useState(false);

  const [memberIdentifiers, setMemberIdentifiers] = useState("");
  const [memberError, setMemberError] = useState("");

  // Set when a socket "group-activity" event arrives for this group from
  // someone else - shown as a dismissable banner naming what changed. The
  // group itself is refetched immediately (see handleActivity below), so
  // the banner is purely informational, not a prompt to act; add/edit form
  // fields are separate local state, not derived from `group`, so a
  // refetch while one is open doesn't disturb it.
  const [activityNotice, setActivityNotice] = useState(null);

  // useCallback so the effects below can depend on it honestly - as a plain
  // function declaration it'd be a new reference every render, so listing it
  // as a dependency would re-run those effects (and refetch, and rejoin the
  // socket room) on every single render.
  const fetchGroup = useCallback(async () => {
    const { data } = await api.get(`/groups/${id}`);
    setGroup(data);
  }, [id]);

  useEffect(() => {
    fetchGroup();
    api
      .get("/expenses/categories")
      .then(({ data }) => setCategories(data.categories))
      .catch(() => {});
  }, [fetchGroup]);

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
      fetchGroup();
    }

    socket.on("group-activity", handleActivity);

    return () => {
      socket.emit("leave-group", id);
      socket.off("group-activity", handleActivity);
    };
  }, [id, user.id, fetchGroup]);

  function setSplitValue(userId, value) {
    setSplitValues((prev) => ({ ...prev, [userId]: value }));
  }

  // Resolves the "everyone" default to an actual id list at the moment
  // it's needed, rather than baking it into state - so it always reflects
  // the group's current membership until someone actually excludes a
  // member.
  function allMemberIds() {
    return group.members.map((m) => m.user.id);
  }

  function toggleSplitMember(userId) {
    setSplitMembers((prev) => {
      const current = prev === null ? allMemberIds() : prev;
      return current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId];
    });
  }

  function setEditSplitValue(userId, value) {
    setEditSplitValues((prev) => ({ ...prev, [userId]: value }));
  }

  // Builds the {userId, amountOwed} list to send to the API, based on the
  // given split type/values. Returns null (and reports via onError) if
  // invalid. Shared by both the add-expense and edit-expense forms.
  //
  // `total` and every amountOwed are integer cents. The API compares the
  // split total against the expense total with exact equality now, so every
  // branch here has to land on the total exactly - no leftover fraction of
  // a cent is tolerated.
  function buildSplits(members, total, type, values, onError) {
    if (type === "equal") {
      // splitEvenly hands out the remainder cent by cent, so this sums to
      // `total` by construction rather than needing a correction afterwards.
      const shares = splitEvenly(total, members.length);
      return members.map((m, i) => ({ userId: m.id, amountOwed: shares[i] }));
    }

    if (type === "exact") {
      // Each field is a typed dollar amount, so it has to be parsed rather
      // than coerced - a value like "12.345" is a mistake worth reporting,
      // not something to silently round.
      const entries = members.map((m) => ({ userId: m.id, raw: values[m.id] }));
      const invalid = entries.find((e) => e.raw && parseAmountToCents(e.raw) === null);
      if (invalid) {
        onError(`"${invalid.raw}" isn't a valid amount - use up to 2 decimal places`);
        return null;
      }

      const splits = entries
        .map((e) => ({ userId: e.userId, amountOwed: parseAmountToCents(e.raw) || 0 }))
        .filter((s) => s.amountOwed > 0);
      const sum = splits.reduce((s, x) => s + x.amountOwed, 0);
      if (sum !== total) {
        onError(`Exact amounts must add up to $${formatCents(total)} (currently $${formatCents(sum)})`);
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
      amountOwed: Math.round((total * s.pct) / 100),
    }));
    // A percentage of a cent total rarely divides evenly, so the rounding
    // above can leave the parts a cent or two off. Put the difference on the
    // first split to land on the total exactly.
    const sum = splits.reduce((s, x) => s + x.amountOwed, 0);
    splits[0].amountOwed += total - sum;
    return splits;
  }

  // Pre-fills the add-expense form from a parsed sentence - never submits
  // anything itself, so the user always reviews the result (and the
  // description auto-categorization, split math, etc.) before it's real.
  async function handleParseExpense() {
    if (!nlText.trim()) return;
    setNlError("");
    setNlLoading(true);
    try {
      const { data } = await api.post("/expenses/parse", { groupId: Number(id), text: nlText });

      if (data.description) setDescription(data.description);
      setAmount(centsToInputValue(data.amount));
      if (data.payerId) setPaidBy(data.payerId);
      // A mentioned subset just becomes the split-member selection now -
      // "equal" (or whatever split type is already chosen) applies to
      // exactly those people. null falls back to "everyone" as usual.
      setSplitMembers(data.splitWithIds && data.splitWithIds.length > 0 ? data.splitWithIds : null);

      setNlText("");
    } catch (err) {
      setNlError(err.response?.data?.error || "Couldn't understand that - try rephrasing, or fill in the form below");
    } finally {
      setNlLoading(false);
    }
  }

  async function handleAddExpense(e) {
    e.preventDefault();
    setExpenseError("");
    if (!description.trim() || !amount) return;

    const total = parseAmountToCents(amount);
    if (total === null || total <= 0) {
      setExpenseError("Enter a valid amount, like 12.34");
      return;
    }
    const members = group.members.map((m) => m.user).filter((m) => splitMembers === null || splitMembers.includes(m.id));
    if (members.length === 0) {
      setExpenseError("Select at least one person to split with");
      return;
    }
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
      setSplitMembers(null);
      fetchGroup();
    } catch (err) {
      setExpenseError(err.response?.data?.error || "Failed to add expense");
    }
  }

  function startEdit(exp) {
    setEditingId(exp.id);
    setEditDescription(exp.description);
    // Stored cents become editable dollars in the form fields, and get
    // parsed back on save.
    setEditAmount(centsToInputValue(exp.amount));
    setEditPaidBy(exp.payer.id);
    // Default to "exact" and prefill with the expense's actual current
    // splits, so editing preserves the existing distribution unless the
    // user deliberately switches split type.
    setEditSplitType("exact");
    const initialValues = {};
    exp.splits.forEach((s) => {
      initialValues[s.userId] = centsToInputValue(s.amountOwed);
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

    const total = parseAmountToCents(editAmount);
    if (total === null || total <= 0) {
      setEditError("Enter a valid amount, like 12.34");
      return;
    }
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

  const balanceKey = (b) => `${b.from}-${b.to}`;

  function openSettle(balance) {
    setSettlingKey(balanceKey(balance));
    setSettleAmount(centsToInputValue(balance.amount));
    setSettleError("");
  }

  function closeSettle() {
    setSettlingKey(null);
    setSettleError("");
  }

  // Settlements are always recorded as "the current user paid" - the API
  // takes fromUser from the auth token, not the request body, so this is
  // only ever shown for balances where the current user is the one who owes.
  //
  // The checks here mirror settlementController's, so an obvious mistake is
  // caught before a round trip - but they are a convenience, not the
  // boundary. The server re-checks against the live balance, which matters
  // because someone else may have changed the group since this page loaded.
  async function handleSettleUp(e, balance) {
    e.preventDefault();
    setSettleError("");

    const cents = parseAmountToCents(settleAmount);
    if (cents === null || cents <= 0) {
      setSettleError("Enter a valid amount, like 12.34");
      return;
    }
    if (cents > balance.amount) {
      setSettleError(`That's more than you owe - the balance is $${formatCents(balance.amount)}`);
      return;
    }

    setSettleSaving(true);
    try {
      await api.post("/settlements", { groupId: Number(id), toUser: balance.to, amount: cents });
      closeSettle();
      fetchGroup();
    } catch (err) {
      setSettleError(err.response?.data?.error || "Failed to record settlement");
    } finally {
      setSettleSaving(false);
    }
  }

  // Same comma/newline-separated pattern as creating a group (DashboardPage) -
  // only emails/usernames that already belong to a registered user get
  // added, and any that don't (or that are already members) are reported
  // back and skipped.
  async function handleAddMembers(e) {
    e.preventDefault();
    setMemberError("");
    const identifiers = memberIdentifiers
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (identifiers.length === 0) return;

    try {
      const { data } = await api.post(`/groups/${id}/members`, { memberIdentifiers: identifiers });
      setMemberIdentifiers("");
      if (data.unmatchedIdentifiers?.length) {
        setMemberError(
          `Added, but these don't match an account so weren't added: ${data.unmatchedIdentifiers.join(", ")}`
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
            {nameFor(activityNotice.actorId)} {ACTIVITY_MESSAGES[activityNotice.type] || "made a change"}.
          </span>
          <button
            onClick={() => setActivityNotice(null)}
            aria-label="Dismiss"
            className="text-amber-500 hover:text-amber-700 shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      <section className="mb-8">
        <h2 className="font-semibold mb-2">Balances</h2>
        {group.balances.length === 0 && (
          <p className="text-sm text-gray-500">Everyone is settled up 🎉</p>
        )}
        <ul className="space-y-1">
          {group.balances.map((b) => (
            <li key={balanceKey(b)} className="text-sm bg-white border rounded p-2">
              <div className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{nameFor(b.from)}</span> owes{" "}
                  <span className="font-medium">{nameFor(b.to)}</span> ${formatCents(b.amount)}
                </span>
                {b.from === user.id && settlingKey !== balanceKey(b) && (
                  <button
                    onClick={() => openSettle(b)}
                    className="text-xs text-emerald-600 hover:underline shrink-0"
                  >
                    Settle up
                  </button>
                )}
              </div>

              {settlingKey === balanceKey(b) && (
                <form onSubmit={(e) => handleSettleUp(e, b)} className="mt-2 space-y-2">
                  <label className="block text-xs text-gray-600" htmlFor={`settle-${balanceKey(b)}`}>
                    How much did you pay {nameFor(b.to)}? Less than ${formatCents(b.amount)} records a partial
                    payment.
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-gray-500">$</span>
                    <input
                      id={`settle-${balanceKey(b)}`}
                      className="w-28 border rounded px-2 py-1"
                      inputMode="decimal"
                      aria-label="Settlement amount"
                      value={settleAmount}
                      onChange={(e) => setSettleAmount(e.target.value)}
                      autoFocus
                    />
                    <button
                      type="submit"
                      disabled={settleSaving}
                      className="bg-emerald-600 text-white text-xs px-3 py-1.5 rounded font-medium hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {settleSaving ? "Recording..." : "Record payment"}
                    </button>
                    <button type="button" onClick={closeSettle} className="text-xs text-gray-500 hover:underline">
                      Cancel
                    </button>
                  </div>
                  {settleError && <p className="text-xs text-red-600">{settleError}</p>}
                </form>
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
              <span>{m.user.id === user.id ? "You" : m.user.name}</span>
              <span className="text-gray-400"> @{m.user.username}</span>
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
              placeholder="Add by email or username, comma separated (must already have an account)"
              value={memberIdentifiers}
              onChange={(e) => setMemberIdentifiers(e.target.value)}
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
            amount: exp.amount,
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
          <div className="bg-emerald-50 border border-emerald-200 rounded p-3 space-y-2">
            <label className="block text-sm font-medium text-emerald-900">
              Describe it in plain English
            </label>
            <div className="flex gap-2">
              <input
                className="flex-1 border rounded px-3 py-2"
                placeholder='e.g. "Dinner $60, I paid, split with Bob and Charlie"'
                value={nlText}
                onChange={(e) => setNlText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleParseExpense();
                  }
                }}
              />
              <button
                type="button"
                onClick={handleParseExpense}
                disabled={nlLoading || !nlText.trim()}
                className="bg-emerald-600 text-white px-4 rounded font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                {nlLoading ? "Thinking…" : "Fill in form"}
              </button>
            </div>
            {nlError && <p className="text-sm text-red-600">{nlError}</p>}
          </div>

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
              aria-label="Paid by"
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

          <div className="space-y-1 bg-white border rounded p-3">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Split between</p>
            {group.members.map((m) => {
              const checked = splitMembers === null || splitMembers.includes(m.user.id);
              return (
                <label key={m.user.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={checked} onChange={() => toggleSplitMember(m.user.id)} />
                  <span className="flex-1">{m.user.id === user.id ? "You" : m.user.name}</span>
                  {splitType !== "equal" && checked && (
                    <>
                      <input
                        className="w-24 border rounded px-2 py-1"
                        type="number"
                        step="0.01"
                        placeholder={splitType === "exact" ? "$" : "%"}
                        value={splitValues[m.user.id] || ""}
                        onChange={(e) => setSplitValue(m.user.id, e.target.value)}
                      />
                      <span className="text-gray-400">{splitType === "exact" ? "$" : "%"}</span>
                    </>
                  )}
                </label>
              );
            })}
          </div>

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
                  <span className="font-medium">${formatCents(exp.amount)}</span> for{" "}
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

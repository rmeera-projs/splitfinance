import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import InsightsPanel from "../components/InsightsPanel";
import BalancesPanel from "../components/BalancesPanel";
import AssistantChat from "../components/AssistantChat";

export default function DashboardPage() {
  const { user } = useAuth();
  const [groups, setGroups] = useState([]);
  const [insightItems, setInsightItems] = useState([]);
  // null until loaded, and left null if the request fails - the panel then
  // simply doesn't render, rather than showing a misleading "all settled up".
  const [balances, setBalances] = useState(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [memberIdentifiers, setMemberIdentifiers] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchGroups();
    api
      .get("/insights")
      .then(({ data }) => setInsightItems(data.items))
      .catch(() => {});
    api
      .get("/users/me/balances")
      .then(({ data }) => setBalances(data))
      .catch(() => {});
  }, []);

  async function fetchGroups() {
    const { data } = await api.get("/groups");
    setGroups(data);
  }

  async function handleCreateGroup(e) {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setError("");

    // Comma or newline separated list of emails/usernames to invite. Only
    // ones that already belong to a registered user are added (see README).
    const identifiers = memberIdentifiers
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const { data } = await api.post("/groups", { name: newGroupName, memberIdentifiers: identifiers });
      setNewGroupName("");
      setMemberIdentifiers("");
      if (data.unmatchedIdentifiers?.length) {
        setError(
          `Group created, but these don't match an account so weren't added: ${data.unmatchedIdentifiers.join(", ")}`
        );
      }
      fetchGroups();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create group");
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Hi, {user?.name}</h1>
      </div>

      {/* Same split as a group page: what you owe and where to go in the
          main column, the things you study or ask alongside it. Collapses to
          one column below `lg`, balances first. */}
      <div className="lg:grid lg:grid-cols-3 lg:gap-8 lg:items-start">
        <div className="lg:order-1 lg:col-span-2">
      {/* Above spending on purpose: who you owe is the thing you open a
          bill-splitting app to find out. */}
      {balances && (
        <section className="mb-8">
          <h2 className="font-semibold mb-2">Balances</h2>
          <BalancesPanel balances={balances} />
        </section>
      )}

      <form onSubmit={handleCreateGroup} className="mb-6 space-y-2">
        <div className="flex gap-2">
          <input
            className="flex-1 border rounded px-3 py-2"
            placeholder="New group name"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
          />
          <button className="bg-emerald-600 text-white px-4 rounded font-medium hover:bg-emerald-700">
            Create
          </button>
        </div>
        <input
          className="w-full border rounded px-3 py-2 text-sm"
          placeholder="Invite by email or username, comma separated (must already have an account)"
          value={memberIdentifiers}
          onChange={(e) => setMemberIdentifiers(e.target.value)}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      <div className="space-y-2">
        {groups.map((group) => (
          <Link
            key={group.id}
            to={`/groups/${group.id}`}
            className="block bg-white border rounded-lg p-4 hover:shadow"
          >
            <p className="font-medium">
              {group.name}
              {group.isFinalized && (
                <span className="ml-2 inline-block text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full align-middle">
                  Finalized
                </span>
              )}
            </p>
            <p className="text-sm text-gray-500">{group.members.length} members</p>
          </Link>
        ))}
        {groups.length === 0 && (
          <p className="text-gray-500 text-sm">No groups yet — create one above.</p>
        )}
      </div>
        </div>

        <aside className="lg:order-2 mt-8 lg:mt-0">
          <section className="mb-8">
            <h2 className="font-semibold mb-2">Your Spending</h2>
            <InsightsPanel
              items={insightItems}
              dimensionLabel="Group"
              dimension={(item) => item.groupName}
              stacked
            />
          </section>

          <section>
            <h2 className="font-semibold mb-2">Ask about your balances</h2>
            <AssistantChat />
          </section>
        </aside>
      </div>
    </div>
  );
}

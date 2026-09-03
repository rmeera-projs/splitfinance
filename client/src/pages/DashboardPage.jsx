import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [groups, setGroups] = useState([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [memberEmails, setMemberEmails] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchGroups();
  }, []);

  async function fetchGroups() {
    const { data } = await api.get("/groups");
    setGroups(data);
  }

  async function handleCreateGroup(e) {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setError("");

    // Comma or newline separated list of emails to invite. Only emails
    // that already belong to a registered user are added (see README).
    const emails = memberEmails
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const { data } = await api.post("/groups", { name: newGroupName, memberEmails: emails });
      setNewGroupName("");
      setMemberEmails("");
      if (data.unmatchedEmails?.length) {
        setError(
          `Group created, but these emails have no account yet so weren't added: ${data.unmatchedEmails.join(", ")}`
        );
      }
      fetchGroups();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create group");
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Hi, {user?.name}</h1>
        <button onClick={logout} className="text-sm text-gray-500 hover:underline">
          Log out
        </button>
      </div>

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
          placeholder="Invite by email, comma separated (must already have an account)"
          value={memberEmails}
          onChange={(e) => setMemberEmails(e.target.value)}
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
  );
}

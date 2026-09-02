import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [groups, setGroups] = useState([]);
  const [newGroupName, setNewGroupName] = useState("");

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
    await api.post("/groups", { name: newGroupName });
    setNewGroupName("");
    fetchGroups();
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Hi, {user?.name}</h1>
        <button onClick={logout} className="text-sm text-gray-500 hover:underline">
          Log out
        </button>
      </div>

      <form onSubmit={handleCreateGroup} className="flex gap-2 mb-6">
        <input
          className="flex-1 border rounded px-3 py-2"
          placeholder="New group name"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
        />
        <button className="bg-emerald-600 text-white px-4 rounded font-medium hover:bg-emerald-700">
          Create
        </button>
      </form>

      <div className="space-y-2">
        {groups.map((group) => (
          <Link
            key={group.id}
            to={`/groups/${group.id}`}
            className="block bg-white border rounded-lg p-4 hover:shadow"
          >
            <p className="font-medium">{group.name}</p>
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

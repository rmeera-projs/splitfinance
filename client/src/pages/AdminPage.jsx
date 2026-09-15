import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import api from "../api/client";

function StatCard({ label, value, sublabel }) {
  return (
    <div className="bg-white border rounded-lg p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {sublabel && <p className="text-xs text-gray-400 mt-1">{sublabel}</p>}
    </div>
  );
}

export default function AdminPage() {
  const [stats, setStats] = useState(null);
  // null = still loading, true = confirmed not allowed here (bounces to
  // the dashboard) - the NavBar already hides this link from non-admins,
  // this is just for whoever types the URL directly.
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    api
      .get("/admin/stats")
      .then(({ data }) => setStats(data))
      .catch((err) => {
        if (err.response?.status === 403) setForbidden(true);
      });
  }, []);

  if (forbidden) return <Navigate to="/" replace />;
  if (!stats) return null;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Admin Dashboard</h1>

      <section className="grid grid-cols-2 gap-3 mb-8">
        <StatCard
          label="Users"
          value={stats.totals.users}
          sublabel={`+${stats.newUsers} in the last ${stats.recentWindowDays} days`}
        />
        <StatCard
          label="Groups"
          value={stats.totals.groups}
          sublabel={`+${stats.newGroups} in the last ${stats.recentWindowDays} days`}
        />
        <StatCard label="Expenses logged" value={stats.totals.expenses} />
        <StatCard label="Settlements recorded" value={stats.totals.settlements} />
      </section>

      <section className="mb-8">
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          <p className="text-sm text-emerald-900">Total money moved through expenses</p>
          <p className="text-3xl font-bold text-emerald-700">
            ${stats.totalExpenseAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </section>

      <div className="grid sm:grid-cols-2 gap-6">
        <section>
          <h2 className="font-semibold mb-2">Recent Users</h2>
          <ul className="space-y-2">
            {stats.recentUsers.map((u) => (
              <li key={u.id} className="bg-white border rounded p-3 text-sm flex justify-between">
                <span>
                  {u.name} <span className="text-gray-400">@{u.username}</span>
                </span>
                <span className="text-gray-400">{new Date(u.createdAt).toLocaleDateString()}</span>
              </li>
            ))}
            {stats.recentUsers.length === 0 && <p className="text-sm text-gray-500">No users yet.</p>}
          </ul>
        </section>

        <section>
          <h2 className="font-semibold mb-2">Recent Groups</h2>
          <ul className="space-y-2">
            {stats.recentGroups.map((g) => (
              <li key={g.id} className="bg-white border rounded p-3 text-sm flex justify-between">
                <span>
                  {g.name} <span className="text-gray-400">({g.memberCount} members)</span>
                </span>
                <span className="text-gray-400">{new Date(g.createdAt).toLocaleDateString()}</span>
              </li>
            ))}
            {stats.recentGroups.length === 0 && <p className="text-sm text-gray-500">No groups yet.</p>}
          </ul>
        </section>
      </div>
    </div>
  );
}

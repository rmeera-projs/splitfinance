import { useState } from "react";
import { useAuth } from "../context/AuthContext";

export default function AccountPage() {
  const { user, updateProfile, changePassword } = useAuth();

  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [profileError, setProfileError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  async function handleProfileSubmit(e) {
    e.preventDefault();
    setProfileError("");
    setProfileSuccess("");
    setSavingProfile(true);
    try {
      await updateProfile({ name, username, email });
      setProfileSuccess("Profile updated.");
    } catch (err) {
      setProfileError(err.response?.data?.error || "Failed to update profile");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");
    setSavingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordSuccess("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setPasswordError(err.response?.data?.error || "Failed to change password");
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Account</h1>

      <section className="mb-8">
        <h2 className="font-semibold mb-2">Profile</h2>
        <form onSubmit={handleProfileSubmit} className="space-y-3 bg-white border rounded-lg p-4">
          <label className="block text-sm">
            Name
            <input
              className="w-full border rounded px-3 py-2 mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Username
            <input
              className="w-full border rounded px-3 py-2 mt-1"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Email
            <input
              type="email"
              className="w-full border rounded px-3 py-2 mt-1"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {profileError && <p className="text-sm text-red-600">{profileError}</p>}
          {profileSuccess && <p className="text-sm text-emerald-600">{profileSuccess}</p>}
          <button
            disabled={savingProfile}
            className="bg-emerald-600 text-white px-4 py-2 rounded font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            Save changes
          </button>
        </form>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Change Password</h2>
        <form onSubmit={handlePasswordSubmit} className="space-y-3 bg-white border rounded-lg p-4">
          <label className="block text-sm">
            Current password
            <input
              type="password"
              className="w-full border rounded px-3 py-2 mt-1"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            New password
            <input
              type="password"
              className="w-full border rounded px-3 py-2 mt-1"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
          {passwordSuccess && <p className="text-sm text-emerald-600">{passwordSuccess}</p>}
          <button
            disabled={savingPassword}
            className="bg-emerald-600 text-white px-4 py-2 rounded font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            Update password
          </button>
        </form>
      </section>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Persistent top bar for every protected page (see App.jsx's ProtectedRoute) -
// the app's one main menu, rather than each page inventing its own
// account/logout controls.
export default function NavBar() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <nav className="border-b bg-white">
      <div className="max-w-2xl mx-auto px-6 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-bold text-emerald-700">
          <img src="/splitfinance-logo-nav.png" alt="" className="w-8 h-8 rounded-lg" />
          SplitFinance
        </Link>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((open) => !open)}
            className="flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            {user?.name}
            <span aria-hidden="true">▾</span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-40 bg-white border rounded shadow-lg py-1 text-sm z-10">
              <Link
                to="/account"
                onClick={() => setMenuOpen(false)}
                className="block px-3 py-2 hover:bg-gray-50"
              >
                Account
              </Link>
              <button onClick={logout} className="block w-full text-left px-3 py-2 hover:bg-gray-50 text-red-600">
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

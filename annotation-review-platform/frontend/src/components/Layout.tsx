import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, FolderOpen, LogOut } from "lucide-react";

export default function Layout() {
  const navigate = useNavigate();

  function logout() {
    localStorage.removeItem("access_token");
    navigate("/login");
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 border-r border-slate-700 flex flex-col">
        <div className="p-4 border-b border-slate-700">
          <span className="text-sm font-semibold text-slate-300 uppercase tracking-widest">
            Annotation Review
          </span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <NavLink
            to="/projects"
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`
            }
          >
            <FolderOpen size={16} /> Projects
          </NavLink>
        </nav>
        <div className="p-3 border-t border-slate-700">
          <button
            onClick={logout}
            className="flex items-center gap-2 px-3 py-2 rounded text-sm text-slate-400 hover:text-white hover:bg-slate-800 w-full transition-colors"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto bg-slate-950">
        <Outlet />
      </main>
    </div>
  );
}

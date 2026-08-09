import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { FolderOpen, LogOut } from "lucide-react";

export default function Layout() {
  const navigate = useNavigate();

  function logout() {
    localStorage.removeItem("access_token");
    navigate("/login");
  }

  return (
    <div className="flex h-screen bg-neo-bg">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r-4 border-black flex flex-col">
        <div className="p-4 border-b-4 border-black">
          <span className="text-sm font-black text-black uppercase tracking-widest">
            Annotation Review
          </span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <NavLink
            to="/projects"
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold border-2 transition-all ${
                isActive
                  ? "bg-neo-lavender border-black shadow-neo-sm text-black"
                  : "border-transparent text-gray-600 hover:bg-neo-peach hover:border-black hover:shadow-neo-sm hover:text-black"
              }`
            }
          >
            <FolderOpen size={16} /> Projects
          </NavLink>
        </nav>
        <div className="p-3 border-t-4 border-black">
          <button
            onClick={logout}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold border-2 border-transparent text-gray-600 hover:bg-neo-pink hover:border-black hover:shadow-neo-sm hover:text-black w-full transition-all"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto bg-neo-bg">
        <Outlet />
      </main>
    </div>
  );
}

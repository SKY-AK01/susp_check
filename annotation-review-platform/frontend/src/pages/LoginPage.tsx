import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../api/client";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const form = new URLSearchParams();
      form.append("username", email);
      form.append("password", password);
      const res = await api.post<{ access_token: string }>("/auth/token", form, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      localStorage.setItem("access_token", res.data.access_token);
      navigate("/projects");
    } catch {
      setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neo-lavender p-4">
      <form
        onSubmit={submit}
        className="bg-white border-4 border-black shadow-neo rounded-2xl p-8 w-full max-w-sm space-y-6"
      >
        <div className="text-center">
          <h1 className="text-3xl font-bold text-black mb-2 tracking-tight">Welcome Back!</h1>
          <p className="text-sm font-semibold text-gray-700">Sign in to the Annotation Review Platform</p>
        </div>

        {error && (
          <div className="bg-neo-pink border-2 border-black text-black text-sm font-bold rounded-lg px-4 py-3 shadow-neo-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-black mb-2">Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-neo-bg border-2 border-black rounded-xl px-4 py-3 text-sm text-black font-semibold focus:outline-none focus:ring-0 focus:bg-white transition-colors"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-black mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-neo-bg border-2 border-black rounded-xl px-4 py-3 text-sm text-black font-semibold focus:outline-none focus:ring-0 focus:bg-white transition-colors"
              placeholder="••••••••"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-black hover:bg-gray-800 disabled:opacity-70 text-white text-base font-bold rounded-full px-6 py-3 transition-transform hover:-translate-y-1 shadow-neo-hover"
        >
          {loading ? "Signing in…" : "Sign in to your account"}
        </button>

        <p className="text-center text-sm font-bold text-gray-700 mt-6">
          Don't have an account?{" "}
          <Link
            to="/register"
            className="text-black underline decoration-2 underline-offset-2 hover:text-gray-700"
          >
            Create one
          </Link>
        </p>
      </form>
    </div>
  );
}

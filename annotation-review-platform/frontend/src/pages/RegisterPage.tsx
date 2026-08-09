import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../api/client";

type Step = "details" | "success";

export default function RegisterPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("details");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      await api.post("/auth/register-public", {
        name,
        email,
        password,
        invite_code: inviteCode,
      });
      setStep("success");
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const status = err?.response?.status;
      if (detail === "Invalid invite code") {
        setError("Invalid invite code. Please check and try again.");
      } else if (detail === "Email already registered") {
        setError("This email is already registered. Try signing in.");
      } else if (typeof detail === "string") {
        setError(detail);
      } else {
        setError(`Something went wrong (${status ?? "network error"}). Please try again.`);
      }
    } finally {
      setLoading(false);
    }
  }

  /* ── Success screen ─────────────────────────────────────────── */
  if (step === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neo-mint p-4">
        <div className="bg-white border-4 border-black rounded-2xl shadow-neo p-10 w-full max-w-sm text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-neo-mint border-4 border-black flex items-center justify-center shadow-neo-sm">
              <svg className="w-8 h-8 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <div>
            <h2 className="text-2xl font-black text-black">Account Created!</h2>
            <p className="text-sm font-semibold text-gray-700 mt-1">
              Welcome, <span className="text-black font-black">{name}</span>. Your supervisor account is ready.
            </p>
          </div>
          <button
            onClick={() => navigate("/login")}
            className="w-full bg-black hover:bg-gray-800 text-white font-black text-sm rounded-full py-3 transition-transform hover:-translate-y-1 shadow-neo"
          >
            Go to Sign In →
          </button>
        </div>
      </div>
    );
  }

  /* ── Registration form ──────────────────────────────────────── */
  return (
    <div className="min-h-screen flex items-center justify-center bg-neo-lavender p-4">
      <div className="bg-white border-4 border-black rounded-2xl shadow-neo p-8 w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-black text-black tracking-tight">Create Account</h1>
          <p className="text-sm font-semibold text-gray-700 mt-1">Join the Annotation Review Platform</p>
        </div>

        {/* Error banner */}
        {error && (
          <div className="bg-red-100 border-2 border-black text-black text-sm font-bold rounded-xl px-4 py-3 shadow-neo-sm">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          {/* Full Name */}
          <div>
            <label className="block text-sm font-black text-black mb-2">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Jane Smith"
              className="w-full bg-neo-bg border-2 border-black rounded-xl px-4 py-3 text-sm text-black font-semibold focus:outline-none focus:bg-white transition-colors"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-black text-black mb-2">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="jane@example.com"
              className="w-full bg-neo-bg border-2 border-black rounded-xl px-4 py-3 text-sm text-black font-semibold focus:outline-none focus:bg-white transition-colors"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-black text-black mb-2">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Min. 6 characters"
                className="w-full bg-neo-bg border-2 border-black rounded-xl px-4 py-3 pr-10 text-sm text-black font-semibold focus:outline-none focus:bg-white transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-black transition-colors"
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-sm font-black text-black mb-2">Confirm Password</label>
            <input
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              placeholder="Re-enter your password"
              className={`w-full bg-neo-bg border-2 rounded-xl px-4 py-3 text-sm text-black font-semibold focus:outline-none focus:bg-white transition-colors ${
                confirmPassword && confirmPassword !== password ? "border-red-500" : "border-black"
              }`}
            />
            {confirmPassword && confirmPassword !== password && (
              <p className="text-xs font-bold text-red-600 mt-1">Passwords don't match</p>
            )}
          </div>

          {/* Invite Code */}
          <div>
            <label className="block text-sm font-black text-black mb-2">Invite Code</label>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              required
              placeholder="Enter your invite code"
              className="w-full bg-neo-bg border-2 border-black rounded-xl px-4 py-3 text-sm text-black font-black font-mono tracking-widest focus:outline-none focus:bg-white transition-colors"
            />
            <p className="text-xs font-semibold text-gray-500 mt-1">
              Contact your administrator for an invite code.
            </p>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black hover:bg-gray-800 disabled:opacity-60 text-white font-black text-base rounded-full py-3 transition-transform hover:-translate-y-1 shadow-neo mt-2"
          >
            {loading ? "Creating Account…" : "Create Account"}
          </button>
        </form>

        <p className="text-center text-sm font-bold text-gray-700">
          Already have an account?{" "}
          <Link to="/login" className="text-black underline decoration-2 underline-offset-2 hover:text-gray-700">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

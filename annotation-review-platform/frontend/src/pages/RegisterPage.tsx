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
      if (detail === "Invalid invite code") {
        setError("Invalid invite code. Please check and try again.");
      } else if (detail === "Email already registered") {
        setError("This email is already registered. Try signing in.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  /* ── Success screen ─────────────────────────────────────────── */
  if (step === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-10 w-full max-w-sm text-center space-y-5 shadow-2xl">
          {/* Animated check circle */}
          <div className="flex justify-center">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, #22c55e22, #16a34a44)",
                border: "2px solid #22c55e66",
                boxShadow: "0 0 24px #22c55e33",
              }}
            >
              <svg
                className="w-8 h-8 text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-100">Account Created!</h2>
            <p className="text-sm text-slate-400 mt-1">
              Welcome, <span className="text-slate-200 font-medium">{name}</span>.
              Your supervisor account is ready.
            </p>
          </div>

          <button
            onClick={() => navigate("/login")}
            className="w-full text-sm font-semibold py-2.5 rounded-lg transition-all"
            style={{
              background: "linear-gradient(135deg, #3b82f6, #6366f1)",
              color: "#fff",
              boxShadow: "0 4px 15px #3b82f633",
            }}
          >
            Go to Sign In →
          </button>
        </div>
      </div>
    );
  }

  /* ── Registration form ──────────────────────────────────────── */
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{
        background: "radial-gradient(ellipse at 60% 0%, #0f172a 0%, #020617 70%)",
      }}
    >
      {/* Subtle grid overlay */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(51,65,85,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(51,65,85,0.15) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative w-full max-w-md px-4 py-10">
        {/* Glow card */}
        <div
          className="rounded-2xl p-8 space-y-6 shadow-2xl"
          style={{
            background: "rgba(15,23,42,0.85)",
            border: "1px solid rgba(99,102,241,0.2)",
            backdropFilter: "blur(16px)",
            boxShadow: "0 0 0 1px rgba(99,102,241,0.1), 0 25px 50px rgba(0,0,0,0.6)",
          }}
        >
          {/* Header */}
          <div className="text-center space-y-1">
            <div className="flex justify-center mb-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, #3b82f6, #6366f1)",
                  boxShadow: "0 4px 15px #3b82f640",
                }}
              >
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
              </div>
            </div>
            <h1 className="text-2xl font-bold text-slate-100 tracking-tight">
              Create Account
            </h1>
            <p className="text-sm text-slate-400">
              Join the Annotation Review Platform
            </p>
          </div>

          {/* Error banner */}
          {error && (
            <div
              className="text-sm rounded-lg px-4 py-3 flex items-start gap-2"
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                color: "#fca5a5",
              }}
            >
              <svg
                className="w-4 h-4 mt-0.5 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16A2 2 0 005.07 19z"
                />
              </svg>
              {error}
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {/* Full Name */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Full Name
              </label>
              <input
                id="reg-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Jane Smith"
                className="w-full text-sm text-slate-100 placeholder-slate-600 rounded-lg px-3.5 py-2.5 focus:outline-none transition-all"
                style={{
                  background: "rgba(30,41,59,0.7)",
                  border: "1px solid rgba(71,85,105,0.6)",
                }}
                onFocus={(e) =>
                  (e.currentTarget.style.borderColor = "rgba(99,102,241,0.7)")
                }
                onBlur={(e) =>
                  (e.currentTarget.style.borderColor = "rgba(71,85,105,0.6)")
                }
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Email Address
              </label>
              <input
                id="reg-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="jane@example.com"
                className="w-full text-sm text-slate-100 placeholder-slate-600 rounded-lg px-3.5 py-2.5 focus:outline-none transition-all"
                style={{
                  background: "rgba(30,41,59,0.7)",
                  border: "1px solid rgba(71,85,105,0.6)",
                }}
                onFocus={(e) =>
                  (e.currentTarget.style.borderColor = "rgba(99,102,241,0.7)")
                }
                onBlur={(e) =>
                  (e.currentTarget.style.borderColor = "rgba(71,85,105,0.6)")
                }
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="reg-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Min. 6 characters"
                  className="w-full text-sm text-slate-100 placeholder-slate-600 rounded-lg px-3.5 py-2.5 pr-10 focus:outline-none transition-all"
                  style={{
                    background: "rgba(30,41,59,0.7)",
                    border: "1px solid rgba(71,85,105,0.6)",
                  }}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = "rgba(99,102,241,0.7)")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = "rgba(71,85,105,0.6)")
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
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
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Confirm Password
              </label>
              <input
                id="reg-confirm-password"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                placeholder="Re-enter your password"
                className="w-full text-sm text-slate-100 placeholder-slate-600 rounded-lg px-3.5 py-2.5 focus:outline-none transition-all"
                style={{
                  background: "rgba(30,41,59,0.7)",
                  border: `1px solid ${
                    confirmPassword && confirmPassword !== password
                      ? "rgba(239,68,68,0.5)"
                      : "rgba(71,85,105,0.6)"
                  }`,
                }}
                onFocus={(e) =>
                  (e.currentTarget.style.borderColor = "rgba(99,102,241,0.7)")
                }
                onBlur={(e) =>
                  (e.currentTarget.style.borderColor =
                    confirmPassword && confirmPassword !== password
                      ? "rgba(239,68,68,0.5)"
                      : "rgba(71,85,105,0.6)")
                }
              />
              {confirmPassword && confirmPassword !== password && (
                <p className="text-xs text-red-400 mt-1">Passwords don't match</p>
              )}
            </div>

            {/* Invite Code */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Invite Code
              </label>
              <input
                id="reg-invite-code"
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                required
                placeholder="Enter your invite code"
                className="w-full text-sm text-slate-100 placeholder-slate-600 rounded-lg px-3.5 py-2.5 font-mono tracking-widest focus:outline-none transition-all"
                style={{
                  background: "rgba(30,41,59,0.7)",
                  border: "1px solid rgba(71,85,105,0.6)",
                }}
                onFocus={(e) =>
                  (e.currentTarget.style.borderColor = "rgba(99,102,241,0.7)")
                }
                onBlur={(e) =>
                  (e.currentTarget.style.borderColor = "rgba(71,85,105,0.6)")
                }
              />
              <p className="text-xs text-slate-500 mt-1">
                Contact your administrator for an invite code.
              </p>
            </div>

            {/* Submit */}
            <button
              id="reg-submit"
              type="submit"
              disabled={loading}
              className="w-full text-sm font-semibold py-2.5 rounded-lg transition-all mt-2"
              style={{
                background: loading
                  ? "rgba(99,102,241,0.4)"
                  : "linear-gradient(135deg, #3b82f6, #6366f1)",
                color: "#fff",
                boxShadow: loading ? "none" : "0 4px 15px rgba(99,102,241,0.35)",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Creating Account…
                </span>
              ) : (
                "Create Account"
              )}
            </button>
          </form>

          {/* Footer link */}
          <p className="text-center text-xs text-slate-500">
            Already have an account?{" "}
            <Link
              to="/login"
              className="font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

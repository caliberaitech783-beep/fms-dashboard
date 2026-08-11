import { useState } from "react";
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../ui/Button";

export function LoginForm() {
  const { login, rememberedUserId, updateMessage } = useAuth();
  const [userId, setUserId] = useState(rememberedUserId);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(Boolean(rememberedUserId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await login(userId, password, remember);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page min-h-screen px-4 py-8 text-white sm:px-6 lg:py-10">
      <div className="login-page__backdrop" aria-hidden="true">
        <div className="login-page__glow" />
        <svg
          className="login-page__landscape"
          viewBox="0 0 1600 520"
          preserveAspectRatio="xMidYMax slice"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="mine-ridge" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#26353b" stopOpacity="0.9" />
              <stop offset="1" stopColor="#0b151b" stopOpacity="0.98" />
            </linearGradient>
            <linearGradient id="mine-floor" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#17252b" />
              <stop offset="0.55" stopColor="#101c22" />
              <stop offset="1" stopColor="#1a292f" />
            </linearGradient>
          </defs>
          <path d="M0 236 176 164l133 44 181-101 158 101 182-52 151 81 182-110 175 56 262-94v431H0Z" fill="url(#mine-ridge)" />
          <path d="m0 332 195-68 181 30 169-65 178 52 184-54 191 61 181-50 140 42 181-65v295H0Z" fill="url(#mine-floor)" />
          <g fill="none" stroke="#c8811a" strokeLinecap="round">
            <path d="M-20 374c203-72 382-60 550-5 206 68 371 61 555 0 197-66 357-57 535-2" opacity="0.2" strokeWidth="2" />
            <path d="M-26 413c203-72 392-59 565-3 201 65 361 59 541 2 205-65 367-60 556-4" opacity="0.12" />
          </g>
          <g transform="translate(1184 300)" fill="#060d11" opacity="0.82">
            <path d="M0 78h185v44H0zM36 45h96l25 33H17zM72 13h39v33H72z" />
            <circle cx="42" cy="123" r="24" />
            <circle cx="145" cy="123" r="24" />
            <circle cx="42" cy="123" r="9" fill="#34434a" />
            <circle cx="145" cy="123" r="9" fill="#34434a" />
            <path d="M109 13h9v35h-9zM114 11h42v5h-42z" />
          </g>
          <g fill="#d58a21" opacity="0.85">
            <circle cx="267" cy="317" r="3" />
            <circle cx="922" cy="312" r="3" />
            <circle cx="1368" cy="284" r="3" />
          </g>
        </svg>
      </div>

      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-10 lg:min-h-[calc(100vh-5rem)] lg:grid-cols-[1.1fr_0.9fr]">
        <section className="login-page__intro">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#e7a94e] backdrop-blur-sm">
            <ShieldCheck className="h-4 w-4" />
            Secure Access
          </div>
          <h1 className="mt-5 max-w-2xl text-4xl font-semibold leading-tight tracking-[-0.02em] lg:text-5xl">
            Unified Mining Fleet Fuel Monitoring Portal
          </h1>
          <div className="mt-5 h-1 w-16 rounded-full bg-ore-500" aria-hidden="true" />
          <p className="mt-4 max-w-xl text-sm leading-6 text-coal-200 lg:text-base">
            Login is required for dashboard, fleet, fuel, production, reports, integrations, WhatsApp delivery, master data, settings, and user administration.
          </p>
        </section>

        <section className="login-page__card p-5 text-coal-900 sm:p-6">
          <div className="login-page__card-accent" aria-hidden="true" />
          <div className="mb-5 flex items-center gap-3">
            <div className="login-page__lock flex h-11 w-11 items-center justify-center rounded-lg text-white">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-coal-950">Login</h2>
              <p className="text-sm text-coal-600">Use mobile number as user ID.</p>
            </div>
          </div>

          {updateMessage && (
            <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
              {updateMessage}
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-coal-600">Mobile Number / User ID</span>
              <input
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                className="login-page__field h-11 w-full rounded-md border px-3 text-sm text-coal-900 outline-none transition"
                autoComplete="username"
                inputMode="numeric"
                required
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-coal-600">Password</span>
              <div className="relative">
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  className="login-page__field h-11 w-full rounded-md border px-3 pr-11 text-sm text-coal-900 outline-none transition"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-coal-500 hover:bg-[#eadcc5] hover:text-coal-900 focus:outline-none focus:ring-2 focus:ring-ore-200"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>

            <label className="flex items-center gap-2 text-sm font-medium text-coal-700">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="h-4 w-4 rounded border-coal-300 text-ore-600 focus:ring-ore-500"
              />
              Remember user ID
            </label>

            <Button type="submit" variant="primary" className="login-page__submit h-11 w-full font-semibold" disabled={submitting}>
              {submitting ? "Signing in..." : "Login"}
            </Button>
          </form>

          <p className="mt-4 text-xs text-coal-500">Contact administrator to reset your password.</p>
        </section>
      </div>
    </main>
  );
}

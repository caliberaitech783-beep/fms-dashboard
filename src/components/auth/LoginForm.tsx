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
    <main className="min-h-screen bg-coal-950 px-4 py-10 text-white">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <section>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-ore-300">
            <ShieldCheck className="h-4 w-4" />
            Secure Access
          </div>
          <h1 className="mt-5 max-w-2xl text-4xl font-semibold leading-tight lg:text-5xl">
            Unified Mining Fleet Fuel Monitoring Portal
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-coal-200">
            Login is required for dashboard, fleet, fuel, production, reports, integrations, WhatsApp delivery, master data, settings, and user administration.
          </p>
        </section>

        <section className="rounded-lg border border-white/10 bg-white p-5 text-coal-900 shadow-command">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-ore-600 text-white">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Login</h2>
              <p className="text-sm text-coal-500">Use mobile number as user ID.</p>
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
              <span className="mb-1 block text-xs font-semibold text-coal-500">Mobile Number / User ID</span>
              <input
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                className="h-11 w-full rounded-md border border-coal-200 px-3 text-sm outline-none focus:border-ore-600 focus:ring-2 focus:ring-ore-100"
                autoComplete="username"
                inputMode="numeric"
                required
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-coal-500">Password</span>
              <div className="relative">
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  className="h-11 w-full rounded-md border border-coal-200 px-3 pr-11 text-sm outline-none focus:border-ore-600 focus:ring-2 focus:ring-ore-100"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-coal-500 hover:bg-coal-100 hover:text-coal-800 focus:outline-none focus:ring-2 focus:ring-ore-100"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>

            <label className="flex items-center gap-2 text-sm text-coal-700">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="h-4 w-4 rounded border-coal-300 text-ore-600 focus:ring-ore-500"
              />
              Remember user ID
            </label>

            <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
              {submitting ? "Signing in..." : "Login"}
            </Button>
          </form>

          <p className="mt-4 text-xs text-coal-500">Contact administrator to reset your password.</p>
        </section>
      </div>
    </main>
  );
}

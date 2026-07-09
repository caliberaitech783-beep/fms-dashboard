import { useState } from "react";
import { LogOut, ShieldAlert } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../ui/Button";

export function ChangePasswordForm() {
  const { currentUser, changePassword, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await changePassword(currentPassword, newPassword, confirmPassword);
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "Could not change password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-coal-50 px-4 py-10">
      <div className="mx-auto max-w-xl rounded-lg border border-coal-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-amber-100 text-amber-700">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-coal-950">Change password required</h1>
            <p className="text-sm text-coal-500">{currentUser?.name} must change password before opening the dashboard.</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <form className="space-y-4" onSubmit={handleSubmit}>
          <PasswordInput label="Current password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
          <PasswordInput label="New password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
          <PasswordInput label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />

          <div className="rounded-md border border-coal-200 bg-coal-50 p-3 text-xs text-coal-600">
            <p className="font-semibold text-coal-800">Password rules</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>At least 8 characters.</li>
              <li>Use letters and numbers.</li>
              <li>Cannot match mobile number, user ID, current password, or an old password.</li>
            </ul>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" variant="primary" className="flex-1" disabled={submitting}>
              {submitting ? "Changing..." : "Change Password"}
            </Button>
            <Button type="button" icon={<LogOut className="h-4 w-4" />} onClick={logout}>
              Logout
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}

function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-coal-500">{label}</span>
      <input
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        className="h-11 w-full rounded-md border border-coal-200 px-3 text-sm outline-none focus:border-ore-600 focus:ring-2 focus:ring-ore-100"
        required
      />
    </label>
  );
}

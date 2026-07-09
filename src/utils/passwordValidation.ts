import type { AppUser, PasswordHistoryRecord } from "../types/auth";
import { verifyPassword } from "../auth/passwordService";

export async function validateNewPassword(
  user: AppUser,
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
  history: PasswordHistoryRecord[],
): Promise<string[]> {
  const errors: string[] = [];
  const trimmedNewPassword = newPassword.trim();

  if (trimmedNewPassword.length < 8) {
    errors.push("New password must be at least 8 characters.");
  }

  if (!/[a-z]/i.test(trimmedNewPassword) || !/\d/.test(trimmedNewPassword)) {
    errors.push("New password should include both letters and numbers.");
  }

  if (trimmedNewPassword !== confirmPassword.trim()) {
    errors.push("Confirm password must match the new password.");
  }

  if (trimmedNewPassword === user.mobile || trimmedNewPassword === user.userId) {
    errors.push("New password cannot be the mobile number or user ID.");
  }

  if (trimmedNewPassword === currentPassword.trim()) {
    errors.push("New password cannot be the current password.");
  }

  const matchingOldPassword = await Promise.all(
    history.map((entry) => verifyPassword(trimmedNewPassword, entry.passwordHash)),
  );

  if (matchingOldPassword.some(Boolean)) {
    errors.push("New password cannot match a previous password.");
  }

  return errors;
}

const recoveryUserId = String(process.env.SECURITY_RECOVERY_ADMIN_USER_ID || "").trim();
const recoveryPassword = String(process.env.SECURITY_RECOVERY_TEMP_PASSWORD || "");

if (!recoveryUserId || recoveryPassword.length < 16) {
  console.error("Secure bootstrap is not configured. Set SECURITY_RECOVERY_ADMIN_USER_ID and a random 16+ character SECURITY_RECOVERY_TEMP_PASSWORD in Azure settings.");
  process.exitCode = 1;
} else {
  console.log("Secure recovery-admin bootstrap configuration is valid.");
  console.log("No employee identities or passwords are read from source files.");
  console.log("Remove SECURITY_RECOVERY_TEMP_PASSWORD from Azure immediately after the recovery administrator changes their password.");
}

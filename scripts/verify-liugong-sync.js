// Verify the actual production table after deployment, without logging settings.
const { execFileSync } = require("node:child_process");
const az = args => JSON.parse(execFileSync("az", args, { encoding: "utf8" }));
async function main() {
  const resources = az(["resource", "list", "--name", "cmll-fms-api-b3-783", "--resource-type", "Microsoft.Web/sites", "-o", "json"]);
  const settings = az(["functionapp", "config", "appsettings", "list", "--name", "cmll-fms-api-b3-783", "--resource-group", resources[0].resourceGroup, "-o", "json"]);
  for (const name of ["AzureWebJobsStorage", "STORAGE_ACCOUNT_NAME", "STORAGE_ACCOUNT_KEY", "LIUGONG_DAILY_TABLE_NAME"]) {
    const value = settings.find(s => s.name === name)?.value;
    if (value) process.env[name] = value;
  }
  if (!["LIUGONG_ACCESS_KEY", "LIUGONG_ACCESS_SECRET"].every(name => settings.some(s => s.name === name && s.value))) throw Error("LiuGong backend credentials are missing.");
  const service = require("../src/lib/liugong/service");
  const store = require("../src/lib/liugong/store");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const from = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() - 13 * 86400000));
  for (let attempt = 0; attempt < 32; attempt++) {
    const report = await service.report(from, today);
    const populated = report.rows.filter(row => row.daysReported > 0);
    console.log(JSON.stringify({ from, to: today, machinesWithReadings: populated.length, configuredMachines: report.rows.length }));
    const snapshots = await Promise.all(service.fleet.map(machine => store.loadSnapshot(machine.serialNumber)));
    if (populated.length === report.rows.length && snapshots.every(snapshot => snapshot?.payload?.bootstrapComplete)) {
      const dailyCoverage = {};
      for (const snapshot of snapshots) for (const row of snapshot.payload.rows) {
        if (row.date >= from && row.date <= today && (row.fuelLitres !== null || row.engineHours !== null)) dailyCoverage[row.date] = (dailyCoverage[row.date] || 0) + 1;
      }
      console.log(JSON.stringify({ dailyCoverage }));
      console.log(JSON.stringify({ verified: true, daysReported: populated.reduce((sum, row) => sum + row.daysReported, 0), machinesWithFuel: populated.filter(row => row.fuelLitres !== null).length }));
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  throw Error("LiuGong collection did not populate all configured machines. Check the timer execution.");
}
main().catch(() => { console.error("LiuGong production readings verification failed; no secrets logged."); process.exitCode = 1; });

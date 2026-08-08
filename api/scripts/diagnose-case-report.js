const { fetchCaseReport } = require("../src/lib/case/caseReportClient");

const from = process.argv[2];
const to = process.argv[3];

if (!from || !to) {
  console.error("Usage: node scripts/diagnose-case-report.js <from-iso> <to-iso>");
  process.exit(1);
}

const fields = [
  "totalFuel",
  "averageFuelPerHour",
  "workingHours",
  "idleHours",
  "utilization",
];

const startedAt = Date.now();
fetchCaseReport({ from, to, force: true })
  .then((payload) => {
    const availability = Object.fromEntries(fields.map((field) => [
      field,
      payload.rows.filter((row) => row[field] !== null).length,
    ]));
    console.log(JSON.stringify({
      source: payload.source,
      equipmentCount: payload.equipmentCount,
      durationMs: Date.now() - startedAt,
      availability,
    }));
  })
  .catch((error) => {
    console.error(JSON.stringify({
      name: error?.name || "Error",
      kind: error?.kind || "unknown",
      statusCode: error?.statusCode || null,
    }));
    process.exitCode = 1;
  });

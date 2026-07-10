#!/usr/bin/env node
const path = require("node:path");
const { syncTrackingSheet } = require("../src/lib/tracking/syncWorkflow");
const { safeErrorMessage } = require("../src/lib/tracking/masking");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--real") {
      args.dryRun = false;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      args[key] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args.file ? path.resolve(args.file) : "";
  if (!inputPath) {
    throw new Error("Usage: node scripts/sync-tracking-sheet.js --file <Tracking sheet.xlsx> [--dry-run] [--real] [--output <path>] [--site <site>] [--timestamp <iso>]");
  }

  const dryRun = args.dryRun ?? (process.env.DRY_RUN !== "false");
  const summary = await syncTrackingSheet({
    inputPath,
    outputPath: args.output ? path.resolve(args.output) : null,
    dryRun,
    defaultSite: args.site || process.env.TRACKING_DEFAULT_SITE || "",
    defaultTimestamp: args.timestamp || process.env.TRACKING_DEFAULT_TIMESTAMP || "",
  });

  console.log(JSON.stringify({
    dryRun: summary.dryRun,
    totalRows: summary.totalRows,
    syncedRows: summary.syncedRows,
    failedRows: summary.failedRows,
    results: summary.results.map((result) => ({
      rowNumber: result.rowNumber,
      status: result.status,
      responseId: result.responseId,
      error: result.error,
      validationErrors: result.validationErrors,
      payloadPreview: result.payloadPreview,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(safeErrorMessage(error, [
    process.env.TRACKING_API_USERNAME,
    process.env.TRACKING_API_PASSWORD,
  ]));
  process.exit(1);
});

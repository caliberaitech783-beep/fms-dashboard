const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  ensureResultColumns,
  loadTrackingWorkbook,
  loadTrackingWorkbookBuffer,
  validateTrackingRow,
  writeSyncResult,
} = require("./excelTrackingSheet");
const { resolveShift } = require("./shiftResolver");
const { createTrackingApiClientFromEnv } = require("./trackingApiClient");
const { safeErrorMessage } = require("./masking");

const SITE_KEYS = ["site", "site name", "sites", "mine"];
const TIMESTAMP_KEYS = ["timestamp", "date time", "datetime", "event time", "event timestamp"];
const DATE_KEYS = ["date", "event date"];
const TIME_KEYS = ["time", "event time only"];

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== ""));
}

function firstValue(extraFields, keys) {
  for (const key of keys) {
    if (extraFields[key]) {
      return extraFields[key];
    }
  }
  return "";
}

function shiftInput(row, options) {
  const site = firstValue(row.extraFields, SITE_KEYS) || options.defaultSite || "";
  const timestamp = firstValue(row.extraFields, TIMESTAMP_KEYS)
    || [firstValue(row.extraFields, DATE_KEYS), firstValue(row.extraFields, TIME_KEYS)].filter(Boolean).join(" ")
    || options.defaultTimestamp
    || "";

  return { site, timestamp };
}

function buildPayload(row, options) {
  const { site, timestamp } = shiftInput(row, options);
  const shift = site && timestamp ? resolveShift(site, timestamp) : null;

  return compactObject({
    firmName: row.firmName,
    status: row.status,
    revert: row.revert,
    contactPhone: row.contactPhone,
    sourceRowNumber: row.rowNumber,
    site: site || null,
    eventTimestamp: timestamp || null,
    shift,
  });
}

function previewPayload(payload) {
  return {
    ...payload,
    contactPhone: payload.contactPhone ? "[present]" : "",
  };
}

function trackingSecretsFromEnv() {
  const username = process.env.TRACKING_API_USERNAME;
  const password = process.env.TRACKING_API_PASSWORD;
  const basic = username && password ? Buffer.from(`${username}:${password}`).toString("base64") : "";
  return [username, password, basic].filter(Boolean);
}

async function runSync(parsedWorkbook, {
  client,
  dryRun = false,
  outputPath = null,
  defaultSite = "",
  defaultTimestamp = "",
  now = () => new Date(),
  secrets = [],
} = {}) {
  const resultColumns = ensureResultColumns(parsedWorkbook.worksheet);
  const syncResults = [];
  const apiClient = dryRun ? null : client || createTrackingApiClientFromEnv();

  for (const row of parsedWorkbook.rows) {
    const validationErrors = validateTrackingRow(row);
    const payload = buildPayload(row, { defaultSite, defaultTimestamp });
    const syncedAt = now().toISOString();
    const result = {
      rowNumber: row.rowNumber,
      dryRun,
      payloadPreview: previewPayload(payload),
      validationErrors,
      status: "Pending",
      responseId: "",
      error: "",
    };

    if (validationErrors.length) {
      result.status = "Validation Failed";
      result.error = validationErrors.join(" ");
    } else if (dryRun) {
      result.status = "Dry Run";
    } else {
      try {
        const response = await apiClient.upsertRecord(payload);
        result.status = "Synced";
        result.responseId = response.responseId || "";
      } catch (error) {
        result.status = "Failed";
        result.error = safeErrorMessage(error, secrets);
      }
    }

    writeSyncResult(parsedWorkbook.worksheet, row.rowNumber, {
      status: result.status,
      lastSyncAt: syncedAt,
      responseId: result.responseId,
      error: result.error,
    }, resultColumns);
    syncResults.push(result);
  }

  if (outputPath) {
    await parsedWorkbook.workbook.xlsx.writeFile(outputPath);
  }

  return {
    dryRun,
    totalRows: parsedWorkbook.rows.length,
    syncedRows: syncResults.filter((result) => result.status === "Synced").length,
    failedRows: syncResults.filter((result) => result.status === "Failed" || result.status === "Validation Failed").length,
    results: syncResults,
  };
}

async function syncTrackingSheet({
  inputPath,
  outputPath = null,
  dryRun = process.env.DRY_RUN === "true",
  client,
  defaultSite = "",
  defaultTimestamp = "",
  now,
} = {}) {
  if (!inputPath) {
    throw new Error("inputPath is required.");
  }

  const parsedWorkbook = await loadTrackingWorkbook(inputPath);
  const finalOutputPath = outputPath || (dryRun ? null : inputPath);

  return runSync(parsedWorkbook, {
    client,
    dryRun,
    outputPath: finalOutputPath,
    defaultSite,
    defaultTimestamp,
    now,
    secrets: trackingSecretsFromEnv(),
  });
}

async function syncTrackingWorkbookBuffer(buffer, options = {}) {
  const parsedWorkbook = await loadTrackingWorkbookBuffer(buffer);
  const tempPath = path.join(os.tmpdir(), `tracking-sync-${crypto.randomUUID()}.xlsx`);
  const summary = await runSync(parsedWorkbook, {
    ...options,
    outputPath: tempPath,
    secrets: trackingSecretsFromEnv(),
  });
  const updatedWorkbook = await fs.readFile(tempPath);
  await fs.rm(tempPath, { force: true });

  return {
    ...summary,
    updatedWorkbook,
  };
}

module.exports = {
  buildPayload,
  syncTrackingSheet,
  syncTrackingWorkbookBuffer,
};

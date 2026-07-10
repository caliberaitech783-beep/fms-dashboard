const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const ExcelJS = require("exceljs");
const { syncTrackingSheet } = require("../src/lib/tracking/syncWorkflow");

async function workbookFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tracking-sync-test-"));
  const inputPath = path.join(dir, "tracking.xlsx");
  const outputPath = path.join(dir, "tracking-output.xlsx");
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Sheet1");
  worksheet.addRow(["firm name", "status", "revert", "contact / phone number"]);
  worksheet.addRow(["Sample Firm", "Open", "Pending", "9423604667"]);
  await workbook.xlsx.writeFile(inputPath);
  return { inputPath, outputPath };
}

test("dry-run validates and writes local result without calling API", async () => {
  const { inputPath, outputPath } = await workbookFixture();
  const summary = await syncTrackingSheet({
    inputPath,
    outputPath,
    dryRun: true,
    client: {
      upsertRecord() {
        throw new Error("API should not be called in dry-run mode.");
      },
    },
    defaultSite: "Sasti",
    defaultTimestamp: "2026-07-10T05:00:00+05:30",
    now: () => new Date("2026-07-10T06:00:00.000Z"),
  });

  assert.equal(summary.dryRun, true);
  assert.equal(summary.totalRows, 1);
  assert.equal(summary.results[0].status, "Dry Run");
  assert.equal(summary.results[0].payloadPreview.contactPhone, "[present]");
  assert.equal(summary.results[0].payloadPreview.shift.shiftName, "A");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(outputPath);
  const worksheet = workbook.getWorksheet("Sheet1");
  assert.equal(worksheet.getCell("E1").value, "API Sync Status");
  assert.equal(worksheet.getCell("E2").value, "Dry Run");
});

test("real sync uses supplied client and writes response id", async () => {
  const { inputPath, outputPath } = await workbookFixture();
  let capturedPayload = null;
  const summary = await syncTrackingSheet({
    inputPath,
    outputPath,
    dryRun: false,
    client: {
      async upsertRecord(payload) {
        capturedPayload = payload;
        return { responseId: "remote-123" };
      },
    },
    defaultSite: "Majri",
    defaultTimestamp: "2026-07-10T20:30:00+05:30",
    now: () => new Date("2026-07-10T06:00:00.000Z"),
  });

  assert.equal(summary.syncedRows, 1);
  assert.equal(summary.results[0].status, "Synced");
  assert.equal(capturedPayload.shift.active, false);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(outputPath);
  const worksheet = workbook.getWorksheet("Sheet1");
  assert.equal(worksheet.getCell("E2").value, "Synced");
  assert.equal(worksheet.getCell("G2").value, "remote-123");
});


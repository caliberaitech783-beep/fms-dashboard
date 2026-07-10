const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const ExcelJS = require("exceljs");
const {
  ensureResultColumns,
  loadTrackingWorkbook,
  normalizeHeader,
  validateTrackingRow,
  writeSyncResult,
} = require("../src/lib/tracking/excelTrackingSheet");

async function tempWorkbookPath(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tracking-excel-test-"));
  return path.join(dir, name);
}

async function createWorkbook(filePath, { blankPhoneHeader = false, withExtraSite = false } = {}) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Sheet1");
  worksheet.getCell("A1").value = "firm name";
  worksheet.getCell("B1").value = "status";
  worksheet.getCell("C1").value = "revert";
  worksheet.getCell("D1").value = blankPhoneHeader ? "" : "contact / phone number";
  if (withExtraSite) {
    worksheet.getCell("E1").value = "site";
  }
  worksheet.getCell("A2").value = "Sample Firm";
  worksheet.getCell("B2").value = "Open";
  worksheet.getCell("C2").value = "Pending";
  worksheet.getCell("D2").value = "9423604667";
  if (withExtraSite) {
    worksheet.getCell("E2").value = "Sasti";
  }
  worksheet.getCell("A3").value = "";
  worksheet.getCell("B3").value = "";
  await workbook.xlsx.writeFile(filePath);
}

test("parses Sheet1 while preserving A-D semantics and phone text", async () => {
  const filePath = await tempWorkbookPath("tracking.xlsx");
  await createWorkbook(filePath, { blankPhoneHeader: true, withExtraSite: true });

  const parsed = await loadTrackingWorkbook(filePath);

  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].firmName, "Sample Firm");
  assert.equal(parsed.rows[0].status, "Open");
  assert.equal(parsed.rows[0].revert, "Pending");
  assert.equal(parsed.rows[0].contactPhone, "9423604667");
  assert.equal(parsed.rows[0].extraFields.site, "Sasti");
  assert.deepEqual(validateTrackingRow(parsed.rows[0]), []);
});

test("adds sync result columns after existing user columns", async () => {
  const filePath = await tempWorkbookPath("tracking-results.xlsx");
  await createWorkbook(filePath, { withExtraSite: true });

  const parsed = await loadTrackingWorkbook(filePath);
  const resultColumns = ensureResultColumns(parsed.worksheet);
  writeSyncResult(parsed.worksheet, 2, {
    status: "Dry Run",
    lastSyncAt: "2026-07-10T06:00:00.000Z",
    responseId: "remote-1",
    error: "",
  }, resultColumns);

  assert.equal(resultColumns[normalizeHeader("API Sync Status")], 6);
  assert.equal(parsed.worksheet.getCell("E1").value, "site");
  assert.equal(parsed.worksheet.getCell("F1").value, "API Sync Status");
  assert.equal(parsed.worksheet.getCell("F2").value, "Dry Run");
  assert.equal(parsed.worksheet.getCell("H2").value, "remote-1");
});


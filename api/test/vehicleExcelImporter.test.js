const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const ExcelJS = require("exceljs");
const { parseVehicleWorkbook } = require("../src/lib/vehicles/vehicleExcelImporter");

test("parses every vehicle workbook column and preserves identifiers as text", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fms-vehicles-"));
  const filePath = path.join(directory, "vehicles.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow(["Name", "Vehicle Model", "Sites", "VIN", "Service Status"]);
  sheet.addRow([421, "Volvo FMXB384R", "Dudhichua West", "YV2XBZ0GXS8994175", "Active"]);
  await workbook.xlsx.writeFile(filePath);

  const result = await parseVehicleWorkbook(filePath);
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0].sourceColumns, {
    Name: "421",
    "Vehicle Model": "Volvo FMXB384R",
    Sites: "Dudhichua West",
    VIN: "YV2XBZ0GXS8994175",
    "Service Status": "Active",
  });
  assert.equal(result.records[0].vehicleNumber, "421");
});

test("rejects duplicate VINs before database import", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fms-vehicles-"));
  const filePath = path.join(directory, "duplicates.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow(["Name", "Vehicle Model", "Sites", "VIN", "Service Status"]);
  sheet.addRow(["V1", "FMX", "Sasti", "VIN-1", "Active"]);
  sheet.addRow(["V2", "FMX", "Majri", "vin-1", "Active"]);
  await workbook.xlsx.writeFile(filePath);
  await assert.rejects(() => parseVehicleWorkbook(filePath), /VIN .* duplicated/);
});

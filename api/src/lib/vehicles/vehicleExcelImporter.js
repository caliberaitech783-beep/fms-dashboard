const path = require("node:path");
const ExcelJS = require("exceljs");

const COLUMN_DEFINITIONS = [
  { header: "Name", field: "vehicleNumber" },
  { header: "Vehicle Model", field: "vehicleModel" },
  { header: "Sites", field: "rawSiteName" },
  { header: "VIN", field: "vin" },
  { header: "Service Status", field: "serviceStatus" },
];

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function cellText(cell) {
  const text = String(cell?.text || "").trim();
  if (text) return text;
  const value = cell?.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && value.text) return String(value.text).trim();
  return String(value).trim();
}

function assertUnique(records, field, label) {
  const seen = new Map();
  for (const record of records) {
    const key = String(record[field] || "").trim().toUpperCase();
    if (!key) continue;
    if (seen.has(key)) {
      throw new Error(`${label} ${record[field]} is duplicated on rows ${seen.get(key)} and ${record.sourceRow}.`);
    }
    seen.set(key, record.sourceRow);
  }
}

async function parseVehicleWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet("Sheet1") || workbook.worksheets[0];
  if (!worksheet) throw new Error("The workbook does not contain a worksheet.");

  const headerIndexes = new Map();
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    const key = normalizeHeader(cellText(cell));
    if (key) headerIndexes.set(key, columnNumber);
  });

  for (const definition of COLUMN_DEFINITIONS) {
    if (!headerIndexes.has(normalizeHeader(definition.header))) {
      throw new Error(`Required column '${definition.header}' is missing from ${worksheet.name}.`);
    }
  }

  const records = [];
  for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const sourceColumns = {};
    const record = { sourceRow: rowNumber };
    for (const definition of COLUMN_DEFINITIONS) {
      const value = cellText(row.getCell(headerIndexes.get(normalizeHeader(definition.header))));
      sourceColumns[definition.header] = value;
      record[definition.field] = value;
    }
    if (Object.values(sourceColumns).every((value) => !value)) continue;
    if (!record.vehicleNumber) throw new Error(`Name is required on row ${rowNumber}.`);
    if (!record.vehicleModel) throw new Error(`Vehicle Model is required on row ${rowNumber}.`);
    if (!record.rawSiteName) throw new Error(`Sites is required on row ${rowNumber}.`);
    if (!record.vin) throw new Error(`VIN is required on row ${rowNumber}.`);
    if (!record.serviceStatus) throw new Error(`Service Status is required on row ${rowNumber}.`);
    record.sourceColumns = sourceColumns;
    records.push(record);
  }

  assertUnique(records, "vin", "VIN");
  assertUnique(records, "vehicleNumber", "Vehicle number");
  return {
    fileName: path.basename(filePath),
    sheetName: worksheet.name,
    headers: COLUMN_DEFINITIONS.map((definition) => definition.header),
    records,
  };
}

module.exports = {
  COLUMN_DEFINITIONS,
  normalizeHeader,
  parseVehicleWorkbook,
};

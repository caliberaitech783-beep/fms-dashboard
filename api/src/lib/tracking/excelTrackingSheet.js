const ExcelJS = require("exceljs");

const SHEET_NAME = "Sheet1";
const RESULT_HEADERS = ["API Sync Status", "Last Sync At", "API Response ID", "API Error"];
const RESULT_HEADER_KEYS = new Set(RESULT_HEADERS.map(normalizeHeader));

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function cellText(cell) {
  if (!cell || cell.value === null || cell.value === undefined) {
    return "";
  }

  if (typeof cell.value === "number") {
    return Number.isInteger(cell.value) ? String(cell.value) : String(cell.value);
  }

  if (cell.value instanceof Date) {
    return cell.value.toISOString();
  }

  if (typeof cell.value === "object") {
    if (cell.value.text) {
      return String(cell.value.text);
    }
    if (cell.value.result !== undefined && cell.value.result !== null) {
      return String(cell.value.result);
    }
    if (Array.isArray(cell.value.richText)) {
      return cell.value.richText.map((part) => part.text || "").join("");
    }
  }

  return String(cell.text || cell.value || "");
}

function getColumnLetter(columnNumber) {
  let dividend = columnNumber;
  let columnName = "";
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return columnName;
}

function rowHasAnyValue(row, lastColumn) {
  for (let column = 1; column <= lastColumn; column += 1) {
    if (cellText(row.getCell(column)).trim()) {
      return true;
    }
  }
  return false;
}

function readHeaders(worksheet) {
  const headerRow = worksheet.getRow(1);
  const maxColumn = Math.max(4, worksheet.actualColumnCount || 4);
  return Array.from({ length: maxColumn }, (_, index) => {
    const column = index + 1;
    return {
      column,
      header: cellText(headerRow.getCell(column)).trim(),
      key: normalizeHeader(cellText(headerRow.getCell(column))),
    };
  });
}

function isSyncResultColumn(header) {
  return RESULT_HEADER_KEYS.has(header.key);
}

function extraFieldsForRow(row, headers) {
  const fields = {};
  headers
    .filter((header) => header.column > 4 && header.key && !isSyncResultColumn(header))
    .forEach((header) => {
      fields[header.key] = cellText(row.getCell(header.column)).trim();
    });
  return fields;
}

function parseTrackingWorksheet(worksheet) {
  const headers = readHeaders(worksheet);
  const lastColumn = Math.max(4, worksheet.actualColumnCount || 4);
  const rows = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || !rowHasAnyValue(row, lastColumn)) {
      return;
    }

    rows.push({
      rowNumber,
      firmName: cellText(row.getCell(1)).trim(),
      status: cellText(row.getCell(2)).trim(),
      revert: cellText(row.getCell(3)).trim(),
      contactPhone: cellText(row.getCell(4)).trim(),
      extraFields: extraFieldsForRow(row, headers),
    });
  });

  return { headers, rows };
}

async function loadTrackingWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet(SHEET_NAME);

  if (!worksheet) {
    throw new Error(`${SHEET_NAME} not found in tracking workbook.`);
  }

  return {
    workbook,
    worksheet,
    ...parseTrackingWorksheet(worksheet),
  };
}

async function loadTrackingWorkbookBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet(SHEET_NAME);

  if (!worksheet) {
    throw new Error(`${SHEET_NAME} not found in tracking workbook.`);
  }

  return {
    workbook,
    worksheet,
    ...parseTrackingWorksheet(worksheet),
  };
}

function ensureResultColumns(worksheet) {
  const headers = readHeaders(worksheet);
  const existing = new Map(headers.filter(isSyncResultColumn).map((header) => [header.key, header.column]));
  const resultColumns = {};
  let nextColumn = Math.max(4, worksheet.actualColumnCount || 4) + 1;

  for (const header of RESULT_HEADERS) {
    const key = normalizeHeader(header);
    if (existing.has(key)) {
      resultColumns[key] = existing.get(key);
      continue;
    }

    worksheet.getRow(1).getCell(nextColumn).value = header;
    resultColumns[key] = nextColumn;
    nextColumn += 1;
  }

  worksheet.getRow(1).commit?.();
  return resultColumns;
}

function writeSyncResult(worksheet, rowNumber, result, resultColumns = ensureResultColumns(worksheet)) {
  const row = worksheet.getRow(rowNumber);
  row.getCell(resultColumns[normalizeHeader("API Sync Status")]).value = result.status || "";
  row.getCell(resultColumns[normalizeHeader("Last Sync At")]).value = result.lastSyncAt || "";
  row.getCell(resultColumns[normalizeHeader("API Response ID")]).value = result.responseId || "";
  row.getCell(resultColumns[normalizeHeader("API Error")]).value = result.error || "";
  row.commit?.();
}

function validateTrackingRow(row) {
  const errors = [];
  if (!row.firmName) errors.push("Firm name is required.");
  if (!row.contactPhone) errors.push("Contact / phone number is required.");
  return errors;
}

module.exports = {
  RESULT_HEADERS,
  SHEET_NAME,
  ensureResultColumns,
  getColumnLetter,
  loadTrackingWorkbook,
  loadTrackingWorkbookBuffer,
  normalizeHeader,
  parseTrackingWorksheet,
  validateTrackingRow,
  writeSyncResult,
};

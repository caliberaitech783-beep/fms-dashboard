const ExcelJS = require("exceljs");
const { createScaniaClientFromEnv } = require("./scaniaClient");
const defaultAnalyticsStore = require("./scaniaAnalyticsStore");
const defaultStateStore = require("./scaniaStateStore");
const { normalizeMaster, normalizePosition } = require("./scaniaSyncService");
const { DEFAULT_SITE_GEOFENCES, resolveScaniaSite } = require("./scaniaSiteResolver");

const IMPORT_CURSOR = "scania-connected-fleet-import";
const SNAPSHOT_RESOURCE = "connected-fleet-workbook";

function text(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map((item) => item.text || "").join("");
    if (value.text !== undefined) return String(value.text).trim();
    if (value.result !== undefined) return text(value.result);
  }
  return String(value).trim();
}

function compactKey(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function workbookRecord(values, rowNumber) {
  const record = {
    rowNumber,
    equipment: text(values[0]),
    chassisNumber: text(values[1]),
    registrationNumber: text(values[2]),
    model: text(values[3]),
    vehicleType: text(values[4]),
    subscriptionType: text(values[5]),
    subscriptionStartDate: text(values[6]),
    subscriptionEndDate: text(values[7]),
    durationMonths: text(values[8]),
    commercialType: text(values[9]),
    workbookSite: text(values[10]),
  };
  if (!record.chassisNumber && !record.registrationNumber) return null;
  return record;
}

async function parseConnectedFleetWorkbook(workbookPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const worksheet = workbook.getWorksheet("Scania") || workbook.worksheets[0];
  if (!worksheet) throw new Error("The Scania Connected Fleet workbook has no worksheets.");
  const records = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = Array.from({ length: 11 }, (_, index) => row.getCell(index + 1).value);
    const record = workbookRecord(values, rowNumber);
    if (record) records.push(record);
  });
  return records;
}

function duplicateValues(records, field) {
  const seen = new Set();
  const duplicates = new Set();
  for (const record of records) {
    const value = compactKey(record[field]);
    if (!value) continue;
    if (seen.has(value)) duplicates.add(record[field]);
    seen.add(value);
  }
  return [...duplicates];
}

function findLiveMaster(record, liveMasters) {
  const chassis = compactKey(record.chassisNumber);
  const registration = compactKey(record.registrationNumber);
  return liveMasters.find((master) => (
    (chassis && compactKey(master.vin).endsWith(chassis))
    || (registration && compactKey(master.vehicleNumber) === registration)
  )) || null;
}

function siteDefinition(name) {
  return DEFAULT_SITE_GEOFENCES.find((site) => site.name === name) || null;
}

function assignedSite(record, position, env = process.env) {
  const workbookSite = compactKey(record.workbookSite);
  if (workbookSite === "sasti" || workbookSite === "sastiocm") {
    return siteDefinition("Sasti OCM");
  }
  if (workbookSite === "dudhichua" || workbookSite === "dch") {
    const liveSite = resolveScaniaSite(position, env);
    return liveSite?.name === "DCH East" || liveSite?.name === "DCH West"
      ? siteDefinition(liveSite.name)
      : null;
  }
  return null;
}

function mergeConnectedFleetMaster(master, record, position, env = process.env) {
  const site = assignedSite(record, position, env);
  if (!site) return null;
  return {
    ...master,
    vehicleNumber: record.registrationNumber || master.vehicleNumber,
    siteId: site.id,
    siteName: site.name,
    siteGroup: site.group || null,
    contractType: site.contractType || null,
    siteAssignment: {
      method: "connected-fleet-workbook+live-gps",
      workbookSite: record.workbookSite,
      assignedAt: new Date().toISOString(),
    },
    connectedFleet: record,
  };
}

async function importConnectedFleetWorkbook(options = {}) {
  const workbookPath = options.workbookPath;
  if (!workbookPath) throw new Error("A Scania Connected Fleet workbook path is required.");
  const env = options.env || process.env;
  const client = options.client || createScaniaClientFromEnv({ env });
  const stateStore = options.stateStore || defaultStateStore;
  const analyticsStore = options.analyticsStore || defaultAnalyticsStore;
  const records = await parseConnectedFleetWorkbook(workbookPath);
  if (
    duplicateValues(records, "chassisNumber").length
    || duplicateValues(records, "registrationNumber").length
  ) {
    throw new Error("The Scania Connected Fleet workbook contains duplicate vehicle identifiers.");
  }

  const [vehicleResult, positionResult, persistedMasters] = await Promise.all([
    client.getVehicles(),
    client.getLatestPositions(),
    stateStore.loadMasterRecords(),
  ]);
  const liveMasters = vehicleResult.records.map(normalizeMaster).filter(Boolean);
  const positions = positionResult.records
    .map((record) => normalizePosition(record, new Date().toISOString()))
    .filter(Boolean);
  const positionByVin = new Map(positions.map((position) => [position.vin, position]));
  const persistedByVin = new Map(persistedMasters.map((master) => [master.vin, master]));
  const matchedVins = new Set();
  const importedMasters = [];
  const unmatched = [];
  const unresolvedSites = [];

  for (const record of records) {
    const liveMaster = findLiveMaster(record, liveMasters);
    if (!liveMaster) {
      unmatched.push(record.registrationNumber || record.chassisNumber);
      continue;
    }
    matchedVins.add(liveMaster.vin);
    const merged = mergeConnectedFleetMaster(
      { ...persistedByVin.get(liveMaster.vin), ...liveMaster },
      record,
      positionByVin.get(liveMaster.vin),
      env,
    );
    if (!merged) {
      unresolvedSites.push(record.registrationNumber || record.chassisNumber);
      continue;
    }
    importedMasters.push(merged);
  }

  const importedAt = new Date().toISOString();
  const siteCounts = importedMasters.reduce((counts, master) => ({
    ...counts,
    [master.siteName]: (counts[master.siteName] || 0) + 1,
  }), {});
  const liveWithoutWorkbook = liveMasters
    .filter((master) => !matchedVins.has(master.vin))
    .map((master) => master.vehicleNumber || master.vin);
  const summary = {
    importedAt,
    workbookRows: records.length,
    liveVehicles: liveMasters.length,
    matchedVehicles: matchedVins.size,
    importedVehicles: importedMasters.length,
    unmatchedWorkbookVehicles: unmatched,
    liveWithoutWorkbook,
    unresolvedSites,
    siteCounts,
  };

  await Promise.all([
    importedMasters.length
      ? stateStore.saveMasterRecords(importedMasters)
      : Promise.resolve({ saved: 0 }),
    analyticsStore.saveSnapshot(SNAPSHOT_RESOURCE, { records, summary }, {
      fetchedAt: importedAt,
      recordCount: records.length,
      httpStatus: 200,
      endpoint: "local://Scania Connected Fleet.xlsx",
    }),
  ]);
  await stateStore.saveCursor(IMPORT_CURSOR, { cursorTime: importedAt, ...summary });
  return summary;
}

module.exports = {
  IMPORT_CURSOR,
  SNAPSHOT_RESOURCE,
  assignedSite,
  compactKey,
  duplicateValues,
  findLiveMaster,
  importConnectedFleetWorkbook,
  mergeConnectedFleetMaster,
  parseConnectedFleetWorkbook,
  workbookRecord,
};

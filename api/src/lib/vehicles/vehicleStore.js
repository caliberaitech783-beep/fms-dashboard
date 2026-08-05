const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");
const { normalizeKey, normalizeVehicleIdentifier } = require("./vehicleMasterIntegration");

const PARTITION_KEY = "VEHICLE_MASTER";
let setupPromise = null;
let table = null;

function tableName() {
  return process.env.VEHICLES_TABLE_NAME || "FmsVehicles";
}

function makeTableClient() {
  const connectionString = process.env.AzureWebJobsStorage;
  if (!connectionString) throw Object.assign(new Error("AzureWebJobsStorage is not configured."), { statusCode: 500 });
  if (connectionString === "UseDevelopmentStorage=true" || connectionString.startsWith("DefaultEndpointsProtocol=")) {
    return TableClient.fromConnectionString(connectionString, tableName());
  }
  const accountName = process.env.STORAGE_ACCOUNT_NAME;
  const accountKey = process.env.STORAGE_ACCOUNT_KEY;
  if (!accountName || !accountKey) {
    throw Object.assign(new Error("Storage account credentials are not configured."), { statusCode: 500 });
  }
  return new TableClient(
    `https://${accountName}.table.core.windows.net`,
    tableName(),
    new AzureNamedKeyCredential(accountName, accountKey),
  );
}

function ignoreConflict(error) {
  if (error?.statusCode !== 409) throw error;
}

async function setup() {
  if (!setupPromise) {
    setupPromise = (async () => {
      table = makeTableClient();
      await table.createTable().catch(ignoreConflict);
    })();
  }
  await setupPromise;
}

function rowKeyFor(value) {
  return Buffer.from(String(value), "utf8").toString("base64url");
}

function fromEntity(entity) {
  return {
    rowKey: entity.rowKey,
    sourceRow: Number(entity.sourceRow),
    vehicleNumber: entity.vehicleNumber,
    vehicleModel: entity.vehicleModel,
    rawSiteName: entity.rawSiteName,
    vin: entity.vin,
    serviceStatus: entity.serviceStatus,
    siteId: entity.siteId || null,
    siteName: entity.siteName || null,
    siteGroup: entity.siteGroup || null,
    contractType: entity.contractType || null,
    active: Boolean(entity.active),
    sourceColumns: JSON.parse(entity.sourceColumnsJson || "{}"),
    sourceFileName: entity.sourceFileName || "",
    createdAt: entity.createdAt || null,
    importedAt: entity.importedAt || null,
  };
}

async function listVehicles() {
  await setup();
  const records = [];
  for await (const entity of table.listEntities({
    queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` },
  })) {
    records.push(fromEntity(entity));
  }
  return records;
}

function sameRecord(existing, record, sourceFileName) {
  return existing.sourceRow === record.sourceRow
    && existing.vehicleNumber === record.vehicleNumber
    && existing.vehicleModel === record.vehicleModel
    && existing.rawSiteName === record.rawSiteName
    && existing.vin === record.vin
    && existing.serviceStatus === record.serviceStatus
    && existing.siteId === record.siteId
    && existing.siteName === record.siteName
    && existing.siteGroup === record.siteGroup
    && existing.contractType === record.contractType
    && existing.active === record.active
    && existing.sourceFileName === sourceFileName
    && JSON.stringify(existing.sourceColumns) === JSON.stringify(record.sourceColumns);
}

async function upsertVehicles(records, options = {}) {
  await setup();
  const sourceFileName = String(options.sourceFileName || "").trim();
  const existingRecords = await listVehicles();
  const byVin = new Map(existingRecords.map((record) => [normalizeKey(record.vin), record]));
  const byNumber = new Map(existingRecords.map((record) => [normalizeVehicleIdentifier(record.vehicleNumber), record]));
  const result = { created: 0, updated: 0, unchanged: 0, total: records.length, tableName: tableName() };

  for (const record of records) {
    const existing = byVin.get(normalizeKey(record.vin))
      || byNumber.get(normalizeVehicleIdentifier(record.vehicleNumber));
    if (existing && sameRecord(existing, record, sourceFileName)) {
      result.unchanged += 1;
      continue;
    }
    const now = new Date().toISOString();
    const rowKey = existing?.rowKey || rowKeyFor(record.vin || record.vehicleNumber);
    await table.upsertEntity({
      partitionKey: PARTITION_KEY,
      rowKey,
      sourceRow: record.sourceRow,
      vehicleNumber: record.vehicleNumber,
      vehicleModel: record.vehicleModel,
      rawSiteName: record.rawSiteName,
      vin: record.vin,
      serviceStatus: record.serviceStatus,
      siteId: record.siteId || "",
      siteName: record.siteName || "",
      siteGroup: record.siteGroup || "",
      contractType: record.contractType || "",
      active: record.active,
      sourceColumnsJson: JSON.stringify(record.sourceColumns),
      sourceFileName,
      createdAt: existing?.createdAt || now,
      importedAt: now,
    }, "Replace");
    const stored = { ...record, rowKey, sourceFileName, importedAt: now };
    byVin.set(normalizeKey(record.vin), stored);
    byNumber.set(normalizeVehicleIdentifier(record.vehicleNumber), stored);
    if (existing) result.updated += 1;
    else result.created += 1;
  }
  return result;
}

module.exports = {
  listVehicles,
  setup,
  upsertVehicles,
};

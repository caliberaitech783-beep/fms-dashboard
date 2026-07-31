const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");

const PARTITION_KEY = "SCANIA_REPORT";
const memorySessions = new Map();
let table = null;
let setupPromise = null;

function tableName() {
  return process.env.SCANIA_REPORT_SESSIONS_TABLE_NAME || "ScaniaReportSessions";
}

function hasAzureStorage() {
  return Boolean(process.env.AzureWebJobsStorage);
}

function makeTableClient() {
  const connectionString = process.env.AzureWebJobsStorage;
  if (!connectionString) return null;
  if (
    connectionString === "UseDevelopmentStorage=true"
    || connectionString.startsWith("DefaultEndpointsProtocol=")
  ) {
    return TableClient.fromConnectionString(connectionString, tableName());
  }
  const accountName = process.env.STORAGE_ACCOUNT_NAME;
  const accountKey = process.env.STORAGE_ACCOUNT_KEY;
  if (!accountName || !accountKey) {
    throw Object.assign(new Error("Storage account credentials are not configured."), {
      statusCode: 500,
    });
  }
  return new TableClient(
    `https://${accountName}.table.core.windows.net`,
    tableName(),
    new AzureNamedKeyCredential(accountName, accountKey),
  );
}

async function setup() {
  if (!hasAzureStorage()) return;
  if (!setupPromise) {
    setupPromise = (async () => {
      table = makeTableClient();
      await table.createTable().catch((error) => {
        if (error?.statusCode !== 409) throw error;
      });
    })();
  }
  await setupPromise;
}

function rowKey(sessionId) {
  return Buffer.from(String(sessionId), "utf8").toString("base64url");
}

async function saveSession(session) {
  const record = {
    sessionId: session.sessionId,
    status: session.status || "pending",
    selectedSite: session.selectedSite || "",
    shift: session.shift || "",
    startTime: session.startTime || "",
    stopTime: session.stopTime || "",
    timezone: session.timezone || "",
    createdAt: session.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    errorMessage: session.errorMessage || "",
  };
  memorySessions.set(session.sessionId, record);
  if (!hasAzureStorage()) return record;
  await setup();
  await table.upsertEntity({
    partitionKey: PARTITION_KEY,
    rowKey: rowKey(session.sessionId),
    ...record,
  }, "Merge");
  return record;
}

async function updateSession(sessionId, patch) {
  const existing = memorySessions.get(sessionId) || { sessionId };
  return saveSession({ ...existing, ...patch, sessionId });
}

async function getSession(sessionId) {
  const cached = memorySessions.get(sessionId);
  if (cached) return cached;
  if (!hasAzureStorage()) return null;
  await setup();
  try {
    const entity = await table.getEntity(PARTITION_KEY, rowKey(sessionId));
    const record = {
      sessionId: entity.sessionId,
      status: entity.status,
      selectedSite: entity.selectedSite,
      shift: entity.shift,
      startTime: entity.startTime,
      stopTime: entity.stopTime,
      timezone: entity.timezone,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      errorMessage: entity.errorMessage || "",
    };
    memorySessions.set(sessionId, record);
    return record;
  } catch (error) {
    if (error?.statusCode === 404) return null;
    throw error;
  }
}

module.exports = {
  getSession,
  saveSession,
  setup,
  updateSession,
};

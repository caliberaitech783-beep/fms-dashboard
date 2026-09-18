const { AzureNamedKeyCredential, TableClient } = require("@azure/data-tables");
const {
  addChunkedString,
  readChunkedString,
  safeTableName,
} = require("../oem/oemTableStore");

const PARTITION_KEY = "LIUGONG-DAILY";
let setupPromise = null;
let table = null;

function tableName() {
  return safeTableName(process.env.LIUGONG_DAILY_TABLE_NAME || "LiuGongDailySnapshots");
}

function makeTableClient() {
  const connectionString = process.env.AzureWebJobsStorage;
  if (!connectionString) {
    throw Object.assign(new Error("AzureWebJobsStorage is not configured."), { statusCode: 500 });
  }
  if (
    connectionString === "UseDevelopmentStorage=true"
    || connectionString.startsWith("DefaultEndpointsProtocol=")
  ) {
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

async function setup(options = {}) {
  if (!setupPromise || options.client) {
    const client = options.client || makeTableClient();
    if (options.client) {
      await client.createTable().catch(ignoreConflict);
      return client;
    }
    setupPromise = (async () => {
      table = client;
      await table.createTable().catch(ignoreConflict);
      return table;
    })();
  }
  return setupPromise;
}

function rowKeyFor(resource) {
  return Buffer.from(String(resource), "utf8").toString("base64url");
}

async function saveSnapshot(resource, payload, metadata = {}, options = {}) {
  const client = await setup(options);
  const fetchedAt = metadata.fetchedAt || new Date().toISOString();
  const payloadJson = JSON.stringify(payload ?? null);
  const entity = addChunkedString({
    partitionKey: PARTITION_KEY,
    rowKey: rowKeyFor(resource),
    resource,
    fetchedAt,
    recordCount: Number(metadata.recordCount || 0),
    httpStatus: Number(metadata.httpStatus || 200),
    endpoint: String(metadata.endpoint || "").split("?")[0],
    payloadBytes: Buffer.byteLength(payloadJson, "utf8"),
  }, "payloadJson", payloadJson);
  await client.upsertEntity(entity, "Replace");
  return {
    resource,
    tableName: tableName(),
    fetchedAt,
    recordCount: entity.recordCount,
    payloadBytes: entity.payloadBytes,
  };
}

async function loadSnapshot(resource, options = {}) {
  const client = await setup(options);
  try {
    const entity = await client.getEntity(PARTITION_KEY, rowKeyFor(resource));
    return {
      resource: entity.resource,
      fetchedAt: entity.fetchedAt,
      recordCount: Number(entity.recordCount || 0),
      httpStatus: Number(entity.httpStatus || 0),
      endpoint: entity.endpoint || null,
      payload: JSON.parse(readChunkedString(entity, "payloadJson") || "null"),
    };
  } catch (error) {
    if (error?.statusCode === 404) return null;
    throw error;
  }
}

async function listSnapshotMetadata(options = {}) {
  const client = await setup(options);
  const records = [];
  for await (const entity of client.listEntities({
    queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` },
  })) {
    records.push({
      resource: entity.resource,
      fetchedAt: entity.fetchedAt,
      recordCount: Number(entity.recordCount || 0),
      httpStatus: Number(entity.httpStatus || 0),
      endpoint: entity.endpoint || null,
      payloadBytes: Number(entity.payloadBytes || 0),
    });
  }
  return records.sort((left, right) => left.resource.localeCompare(right.resource));
}

module.exports = {
  PARTITION_KEY,
  listSnapshotMetadata,
  loadSnapshot,
  saveSnapshot,
  tableName,
};

const { AzureNamedKeyCredential, TableClient } = require("@azure/data-tables");

const TABLE_STRING_CHUNK_CHARACTERS = 28_000;

function safeTableName(value) {
  const normalized = String(value || "").replace(/[^A-Za-z0-9]/g, "");
  if (!/^[A-Za-z][A-Za-z0-9]{2,62}$/.test(normalized)) {
    throw new Error(`Invalid Azure table name '${value}'.`);
  }
  return normalized;
}

function defaultTableNames(oem) {
  const prefix = safeTableName(oem);
  return {
    master: `${prefix}VehicleMaster`,
    state: `${prefix}VehicleState`,
    position: `${prefix}VehiclePosition`,
    cursor: `${prefix}SyncCursor`,
  };
}

function makeTableClient(name) {
  const connectionString = process.env.AzureWebJobsStorage;
  if (!connectionString) {
    throw Object.assign(new Error("AzureWebJobsStorage is not configured."), { statusCode: 500 });
  }
  if (connectionString === "UseDevelopmentStorage=true" || connectionString.startsWith("DefaultEndpointsProtocol=")) {
    return TableClient.fromConnectionString(connectionString, name);
  }
  const accountName = process.env.STORAGE_ACCOUNT_NAME;
  const accountKey = process.env.STORAGE_ACCOUNT_KEY;
  if (!accountName || !accountKey) {
    throw Object.assign(new Error("Storage account credentials are not configured."), { statusCode: 500 });
  }
  return new TableClient(
    `https://${accountName}.table.core.windows.net`,
    name,
    new AzureNamedKeyCredential(accountName, accountKey),
  );
}

function rowKeyFor(value) {
  return Buffer.from(String(value), "utf8").toString("base64url");
}

function splitTableString(value, chunkCharacters = TABLE_STRING_CHUNK_CHARACTERS) {
  const source = String(value || "");
  if (!source) return [""];
  const chunks = [];
  let offset = 0;
  while (offset < source.length) {
    let end = Math.min(offset + chunkCharacters, source.length);
    const lastCodeUnit = source.charCodeAt(end - 1);
    if (end < source.length && lastCodeUnit >= 0xD800 && lastCodeUnit <= 0xDBFF) end -= 1;
    chunks.push(source.slice(offset, end));
    offset = end;
  }
  return chunks;
}

function addChunkedString(entity, propertyName, value) {
  const chunks = splitTableString(value);
  entity[propertyName] = chunks[0];
  if (chunks.length > 1) {
    entity[`${propertyName}ChunkCount`] = chunks.length;
    for (let index = 1; index < chunks.length; index += 1) {
      entity[`${propertyName}Chunk${index + 1}`] = chunks[index];
    }
  }
  return entity;
}

function readChunkedString(entity, propertyName) {
  const count = Math.max(1, Number(entity?.[`${propertyName}ChunkCount`] || 1));
  let value = String(entity?.[propertyName] || "");
  for (let index = 2; index <= count; index += 1) {
    value += String(entity?.[`${propertyName}Chunk${index}`] || "");
  }
  return value;
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function ignoreConflict(error) {
  if (error?.statusCode !== 409) throw error;
}

function createOemTableStore(options = {}) {
  const oem = safeTableName(options.oem);
  const defaults = defaultTableNames(oem);
  const tableNames = Object.fromEntries(Object.entries(defaults).map(([resource, fallback]) => [
    resource,
    safeTableName(options.tableNames?.[resource] || fallback),
  ]));
  const clientFactory = options.clientFactory || makeTableClient;
  const clients = {};
  let setupPromise = null;

  async function setup() {
    if (!setupPromise) {
      setupPromise = (async () => {
        for (const [resource, name] of Object.entries(tableNames)) {
          clients[resource] = clientFactory(name);
        }
        await Promise.all(Object.values(clients).map((client) => client.createTable().catch(ignoreConflict)));
      })();
    }
    await setupPromise;
  }

  async function saveRecords(resource, records, identity) {
    await setup();
    const now = new Date().toISOString();
    let saved = 0;
    for (const record of records || []) {
      const key = String(identity(record) || "").trim();
      if (!key) continue;
      const payloadJson = JSON.stringify(record);
      const entity = addChunkedString({
        partitionKey: `${oem}-${resource}`,
        rowKey: rowKeyFor(key.toUpperCase()),
        oem,
        recordKey: key,
        vin: String(record?.vin || record?.Vin || record?.VIN || "").trim(),
        vehicleNumber: String(record?.vehicleNumber || record?.customerVehicleName || record?.CustomerVehicleName || "").trim(),
        recordedAt: String(record?.recordedAt || record?.createdDateTime || record?.CreatedDateTime || "").trim(),
        payloadBytes: Buffer.byteLength(payloadJson, "utf8"),
        updatedAt: now,
      }, "payloadJson", payloadJson);
      await clients[resource].upsertEntity(entity, "Replace");
      saved += 1;
    }
    return { saved, tableName: tableNames[resource] };
  }

  async function loadRecords(resource) {
    await setup();
    const records = [];
    for await (const entity of clients[resource].listEntities({
      queryOptions: { filter: `PartitionKey eq '${oem}-${resource}'` },
    })) {
      const record = parseJson(readChunkedString(entity, "payloadJson"));
      if (record) records.push(record);
    }
    return records;
  }

  async function getCursor(resourceName) {
    await setup();
    try {
      const entity = await clients.cursor.getEntity(`${oem}-cursor`, rowKeyFor(resourceName));
      return parseJson(readChunkedString(entity, "cursorJson"));
    } catch (error) {
      if (error?.statusCode === 404) return null;
      throw error;
    }
  }

  async function saveCursor(resourceName, cursor) {
    await setup();
    const value = { ...cursor, resourceName, updatedAt: new Date().toISOString() };
    const cursorJson = JSON.stringify(value);
    await clients.cursor.upsertEntity(addChunkedString({
      partitionKey: `${oem}-cursor`,
      rowKey: rowKeyFor(resourceName),
      oem,
      resourceName,
      updatedAt: value.updatedAt,
    }, "cursorJson", cursorJson), "Replace");
    return value;
  }

  return {
    oem,
    tableNames,
    setup,
    getCursor,
    saveCursor,
    loadMasterRecords: () => loadRecords("master"),
    loadStateRecords: () => loadRecords("state"),
    loadPositionRecords: () => loadRecords("position"),
    saveMasterRecords: (records) => saveRecords("master", records, (record) => (
      record?.vin || record?.Vin || record?.VIN || record?.vehicleNumber
    )),
    saveStateRecords: (records) => saveRecords("state", records, (record) => (
      record?.vin || record?.Vin || record?.VIN
    )),
    savePositionRecords: (records) => saveRecords("position", records, (record) => (
      record?.vin || record?.Vin || record?.VIN
    )),
  };
}

module.exports = {
  addChunkedString,
  createOemTableStore,
  defaultTableNames,
  readChunkedString,
  safeTableName,
  splitTableString,
};

const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");
const {
  eventCreatedTime,
  eventReceivedTime,
  eventTrigger,
  eventVin,
  driverIdFromEvent,
  maskDriverId,
  stableEventKey,
} = require("./vehicleStatusNormalizer");

const EVENT_PARTITION = "EVENT";
const STATE_PARTITION = "STATE";
const CURSOR_PARTITION = "CURSOR";
const TABLE_STRING_CHUNK_CHARACTERS = 28_000;

let setupPromise = null;
let clients = null;

function tableName(envName, fallback) {
  return process.env[envName] || fallback;
}

function getConnectionString() {
  const value = process.env.AzureWebJobsStorage;
  if (!value) throw Object.assign(new Error("AzureWebJobsStorage is not configured."), { statusCode: 500 });
  return value;
}

function makeTableClient(name) {
  const connectionString = getConnectionString();
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

function ignoreConflict(error) {
  if (error?.statusCode !== 409) throw error;
}

async function setup() {
  if (!setupPromise) {
    setupPromise = (async () => {
      clients = {
        events: makeTableClient(tableName("VOLVO_EVENTS_TABLE_NAME", "VolvoVehicleEvents")),
        states: makeTableClient(tableName("VOLVO_STATE_TABLE_NAME", "VolvoVehicleState")),
        cursors: makeTableClient(tableName("VOLVO_CURSOR_TABLE_NAME", "VolvoSyncCursor")),
      };
      await Promise.all([
        clients.events.createTable().catch(ignoreConflict),
        clients.states.createTable().catch(ignoreConflict),
        clients.cursors.createTable().catch(ignoreConflict),
      ]);
    })();
  }
  await setupPromise;
}

function rowKeyFor(value) {
  return Buffer.from(String(value), "utf8").toString("base64url");
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function splitTableString(value, chunkCharacters = TABLE_STRING_CHUNK_CHARACTERS) {
  const source = String(value || "");
  if (!source) return [""];

  const chunks = [];
  let offset = 0;
  while (offset < source.length) {
    let end = Math.min(offset + chunkCharacters, source.length);
    const lastCodeUnit = source.charCodeAt(end - 1);
    if (end < source.length && lastCodeUnit >= 0xD800 && lastCodeUnit <= 0xDBFF) {
      end -= 1;
    }
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
  const chunkCount = Math.max(1, Number(entity?.[`${propertyName}ChunkCount`] || 1));
  let value = String(entity?.[propertyName] || "");
  for (let index = 2; index <= chunkCount; index += 1) {
    value += String(entity?.[`${propertyName}Chunk${index}`] || "");
  }
  return value;
}

async function saveEvents(events) {
  await setup();
  let inserted = 0;
  let duplicates = 0;
  for (const event of events) {
    const eventKey = stableEventKey(event);
    try {
      const rawEventJson = JSON.stringify(event);
      const entity = addChunkedString({
        partitionKey: EVENT_PARTITION,
        rowKey: eventKey,
        id: eventKey,
        eventKey,
        vin: eventVin(event),
        triggerType: eventTrigger(event),
        triggerContext: event?.triggerType?.context || event?.TriggerType?.Context || "",
        createdAt: eventCreatedTime(event) || "",
        receivedAt: eventReceivedTime(event) || "",
        rawEventBytes: Buffer.byteLength(rawEventJson, "utf8"),
        insertedAt: new Date().toISOString(),
      }, "rawEventJson", rawEventJson);
      await clients.events.createEntity(entity);
      inserted += 1;
    } catch (error) {
      if (error?.statusCode === 409) duplicates += 1;
      else throw error;
    }
  }
  return { inserted, duplicates };
}

async function loadStates() {
  await setup();
  const states = new Map();
  for await (const entity of clients.states.listEntities({
    queryOptions: { filter: `PartitionKey eq '${STATE_PARTITION}'` },
  })) {
    const state = parseJson(readChunkedString(entity, "stateJson"));
    if (state?.vin) states.set(state.vin, state);
  }
  return states;
}

async function saveStates(states) {
  await setup();
  for (const state of states.values()) {
    const stateJson = JSON.stringify(state);
    const entity = addChunkedString({
      partitionKey: STATE_PARTITION,
      rowKey: rowKeyFor(state.vin),
      vin: state.vin,
      latestEventType: eventTrigger(state.latestEvent),
      latestEventAt: eventCreatedTime(state.latestEvent) || "",
      latestReceivedAt: eventReceivedTime(state.latestEvent) || "",
      ignitionState: state.ignitionState,
      movementState: state.movementState,
      standstillStartedAt: state.standstillStartedAt || "",
      latestDriverId: maskDriverId(driverIdFromEvent(state.latestDriverEvent)) || "",
      stateBytes: Buffer.byteLength(stateJson, "utf8"),
      updatedAt: new Date().toISOString(),
    }, "stateJson", stateJson);
    await clients.states.upsertEntity(entity, "Replace");
  }
}

async function getCursor(resourceName = "vehicle-status") {
  await setup();
  try {
    const entity = await clients.cursors.getEntity(CURSOR_PARTITION, rowKeyFor(resourceName));
    return {
      resourceName,
      cursorTime: entity.cursorTime || null,
      lastVin: entity.lastVin || null,
      updatedAt: entity.updatedAt || null,
    };
  } catch (error) {
    if (error?.statusCode === 404) return null;
    throw error;
  }
}

async function saveCursor(resourceName, cursor) {
  await setup();
  await clients.cursors.upsertEntity({
    partitionKey: CURSOR_PARTITION,
    rowKey: rowKeyFor(resourceName),
    resourceName,
    cursorTime: cursor.cursorTime || "",
    lastVin: cursor.lastVin || "",
    updatedAt: new Date().toISOString(),
  }, "Replace");
}

module.exports = {
  addChunkedString,
  getCursor,
  loadStates,
  readChunkedString,
  saveCursor,
  saveEvents,
  saveStates,
  setup,
  splitTableString,
};

const fs = require("node:fs/promises");
const path = require("node:path");
const { createVolvoClientFromEnv } = require("./volvoRfmsClient");
const { positionToSnapshotEvent } = require("./volvoGroupClient");
const {
  consolidateVehicleEvents,
  deduplicateEvents,
  normalizeState,
  parseVehicleStatusResponse,
  summarizeLiveVehicles,
} = require("./vehicleStatusNormalizer");
const defaultStore = require("./volvoStateStore");

const RESOURCE_NAME = "vehicle-status";
let syncPromise = null;
let cachedLiveSnapshot = null;

function trueValue(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function normalizerOptions(now = new Date()) {
  return {
    now,
    freshAfterMinutes: Number(process.env.VOLVO_FRESH_AFTER_MINUTES || 20),
    staleAfterMinutes: Number(process.env.VOLVO_STALE_AFTER_MINUTES || 120),
    standstillSpeedKph: Number(process.env.VOLVO_STANDSTILL_SPEED_KPH || 3),
  };
}

async function mockBatch() {
  const fixturePath = process.env.VOLVO_MOCK_FIXTURE_PATH
    || path.join(__dirname, "..", "..", "fixtures", "volvo-vehicle-status-sample.json");
  const payload = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  const parsed = parseVehicleStatusResponse(payload);
  return {
    events: parsed.events,
    requestServerDateTime: parsed.requestServerDateTime,
    moreDataAvailable: false,
    pageCount: 1,
  };
}

function newestIso(values, fallback) {
  const timestamps = values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => Number.isFinite(value.getTime()))
    .sort((left, right) => right - left);
  return timestamps[0]?.toISOString() || fallback;
}

async function resourceIsDue(store, resourceName, intervalMilliseconds, now, force) {
  if (force) return true;
  const cursor = await store.getCursor(resourceName);
  const lastRun = cursor?.updatedAt || cursor?.cursorTime;
  const timestamp = lastRun ? new Date(lastRun) : null;
  return !timestamp
    || !Number.isFinite(timestamp.getTime())
    || now.getTime() - timestamp.getTime() >= intervalMilliseconds;
}

async function fetchUpstreamEvents(client, cursor, now, store, force = false) {
  if (trueValue(process.env.USE_MOCK_VOLVO_DATA)) return [await mockBatch()];

  if (client.mode === "group-oauth") {
    const resources = [
      {
        resourceName: "volvo-positions",
        interval: Number(process.env.VOLVO_POSITION_POLL_MS || 300_000),
        load: async () => {
          const batch = await client.fetchLatestVehiclePositionsBatch();
          return {
            ...batch,
            events: batch.positions.map(positionToSnapshotEvent).filter(Boolean),
          };
        },
      },
      {
        resourceName: "volvo-snapshot-status",
        interval: Number(process.env.VOLVO_STATUS_POLL_MS || 900_000),
        load: () => client.fetchLatestVehicleStatusBatch({ contentFilter: "SNAPSHOT" }),
      },
      {
        resourceName: "volvo-accumulated-status",
        interval: Number(process.env.VOLVO_ACCUMULATED_POLL_MS || 3_600_000),
        load: () => client.fetchLatestVehicleStatusBatch({ contentFilter: "ACCUMULATED" }),
      },
    ];
    const due = (await Promise.all(resources.map(async (resource) => ({
      ...resource,
      due: await resourceIsDue(store, resource.resourceName, resource.interval, now, force),
    })))).filter((resource) => resource.due);
    return Promise.all(due.map(async (resource) => ({
      ...(await resource.load()),
      resourceName: resource.resourceName,
    })));
  }

  if (cursor?.cursorTime) {
    return [await client.fetchHistoricalVehicleStatusBatch({
      startTime: cursor.cursorTime,
      stopTime: now.toISOString(),
      contentFilter: null,
      maxPages: Number(process.env.VOLVO_RFMS_HISTORICAL_MAX_PAGES || 120),
    })];
  }

  const historyMinutes = Number(process.env.VOLVO_BOOTSTRAP_HISTORY_MINUTES || 180);
  const historyStart = new Date(now.getTime() - historyMinutes * 60_000).toISOString();
  return Promise.all([
    client.fetchLatestVehicleStatusBatch({ contentFilter: null }),
    client.fetchLatestVehicleStatusBatch({ contentFilter: "ACCUMULATED" }),
    client.fetchHistoricalVehicleStatusBatch({
      startTime: historyStart,
      stopTime: now.toISOString(),
      contentFilter: null,
      maxPages: Number(process.env.VOLVO_RFMS_HISTORICAL_MAX_PAGES || 120),
    }),
  ]);
}

async function runSynchronization(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const store = options.store || defaultStore;
  const client = options.client || createVolvoClientFromEnv();
  const cursor = await store.getCursor(RESOURCE_NAME);
  const previousStates = await store.loadStates();
  const batches = options.batches || await fetchUpstreamEvents(
    client,
    cursor,
    now,
    store,
    options.force === true,
  );
  const events = deduplicateEvents(batches.flatMap((batch) => batch.events || []));
  const consolidated = consolidateVehicleEvents(events, previousStates, normalizerOptions(now));

  const eventResult = await store.saveEvents(consolidated.events);
  await store.saveStates(consolidated.states);
  await Promise.all(batches
    .filter((batch) => batch.resourceName)
    .map((batch) => store.saveCursor(batch.resourceName, {
      cursorTime: batch.requestServerDateTime || now.toISOString(),
      lastVin: null,
    })));
  const cursorTime = newestIso(
    batches.map((batch) => batch.requestServerDateTime),
    now.toISOString(),
  );
  await store.saveCursor(RESOURCE_NAME, { cursorTime, lastVin: null });
  cachedLiveSnapshot = null;

  return {
    mode: cursor ? "incremental" : "bootstrap",
    eventCount: consolidated.events.length,
    vehicleCount: consolidated.vehicles.length,
    insertedEvents: eventResult.inserted,
    duplicateEvents: eventResult.duplicates,
    cursorTime,
  };
}

async function synchronizeVolvo(options = {}) {
  if (syncPromise) return syncPromise;
  syncPromise = runSynchronization(options);
  try {
    return await syncPromise;
  } finally {
    syncPromise = null;
  }
}

async function getLiveVolvoSnapshot(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const cacheMilliseconds = Number(process.env.VOLVO_CACHE_SECONDS || 60) * 1000;
  if (!options.force && cachedLiveSnapshot && Date.now() - cachedLiveSnapshot.cachedAt < cacheMilliseconds) {
    return cachedLiveSnapshot.value;
  }

  const store = options.store || defaultStore;
  let states = await store.loadStates();
  if (!states.size && options.allowBootstrap !== false) {
    await synchronizeVolvo({ ...options, store, now });
    states = await store.loadStates();
  }
  const [cursor, positionCursor, snapshotCursor, accumulatedCursor] = await Promise.all([
    store.getCursor(RESOURCE_NAME),
    store.getCursor("volvo-positions"),
    store.getCursor("volvo-snapshot-status"),
    store.getCursor("volvo-accumulated-status"),
  ]);
  const vehicles = [...states.values()]
    .map((state) => normalizeState(state, normalizerOptions(now)))
    .sort((left, right) => left.vin.localeCompare(right.vin));
  const value = {
    vehicles,
    summary: summarizeLiveVehicles(vehicles),
    meta: {
      fetchedAt: now.toISOString(),
      volvoServerTime: cursor?.cursorTime || null,
      source: "VOLVO_LIVE",
      moreDataAvailable: false,
      lastSuccessfulSyncAt: cursor?.updatedAt || null,
      positionsLastSyncedAt: positionCursor?.updatedAt || null,
      snapshotStatusLastSyncedAt: snapshotCursor?.updatedAt || null,
      accumulatedStatusLastSyncedAt: accumulatedCursor?.updatedAt || null,
      refreshSeconds: Number(process.env.VOLVO_FRONTEND_REFRESH_SECONDS || 30),
    },
  };
  cachedLiveSnapshot = { cachedAt: Date.now(), value };
  return value;
}

function clearVolvoLiveCache() {
  cachedLiveSnapshot = null;
}

module.exports = {
  clearVolvoLiveCache,
  getLiveVolvoSnapshot,
  runSynchronization,
  synchronizeVolvo,
};

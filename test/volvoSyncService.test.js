const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  addChunkedString,
  readChunkedString,
} = require("../src/lib/volvo/volvoStateStore");
const { parseVehicleStatusResponse, stableEventKey } = require("../src/lib/volvo/vehicleStatusNormalizer");
const { getLiveVolvoSnapshot, runSynchronization } = require("../src/lib/volvo/volvoSyncService");

function createMemoryStore() {
  const events = new Map();
  let states = new Map();
  let cursor = null;
  return {
    async getCursor() { return cursor; },
    async loadStates() { return new Map(states); },
    async saveEvents(items) {
      let inserted = 0;
      let duplicates = 0;
      for (const item of items) {
        const key = stableEventKey(item);
        if (events.has(key)) duplicates += 1;
        else {
          events.set(key, item);
          inserted += 1;
        }
      }
      return { inserted, duplicates };
    },
    async saveStates(value) { states = new Map(value); },
    async saveCursor(_resourceName, value) {
      cursor = { ...value, updatedAt: "2026-07-15T05:34:00Z" };
    },
  };
}

test("splits oversized Volvo JSON properties and restores them losslessly", () => {
  const rawEventJson = JSON.stringify({
    vin: "YV2TEST",
    values: Array.from({ length: 8_000 }, (_, index) => `parameter-${index}`),
  });
  const entity = addChunkedString({ partitionKey: "EVENT", rowKey: "large" }, "rawEventJson", rawEventJson);

  assert.ok(entity.rawEventJsonChunkCount > 1);
  assert.ok(entity.rawEventJson.length <= 28_000);
  assert.equal(readChunkedString(entity, "rawEventJson"), rawEventJson);
});

test("persists fixture events, consolidated states and cursor idempotently", async () => {
  const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "src", "fixtures", "volvo-vehicle-status-sample.json"),
    "utf8",
  ));
  const parsed = parseVehicleStatusResponse(fixture);
  const store = createMemoryStore();
  const batches = [{
    events: parsed.events,
    requestServerDateTime: parsed.requestServerDateTime,
    moreDataAvailable: false,
  }];

  const first = await runSynchronization({
    store,
    client: {},
    batches,
    now: new Date("2026-07-15T05:33:45Z"),
  });
  const second = await runSynchronization({
    store,
    client: {},
    batches,
    now: new Date("2026-07-15T05:34:45Z"),
  });
  const snapshot = await getLiveVolvoSnapshot({
    store,
    allowBootstrap: false,
    force: true,
    now: new Date("2026-07-15T05:34:45Z"),
  });

  assert.equal(first.insertedEvents, 1);
  assert.equal(first.vehicleCount, 1);
  assert.equal(second.insertedEvents, 0);
  assert.equal(second.duplicateEvents, 1);
  assert.equal(snapshot.vehicles.length, 1);
  assert.equal(snapshot.meta.volvoServerTime, "2026-07-17T05:01:00.000Z");
  assert.equal(snapshot.meta.source, "VOLVO_LIVE");
});

test("retains the last successful state when a later Group API refresh fails", async () => {
  const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "src", "fixtures", "volvo-vehicle-status-sample.json"),
    "utf8",
  ));
  const parsed = parseVehicleStatusResponse(fixture);
  const store = createMemoryStore();
  await runSynchronization({
    store,
    client: {},
    batches: [{ events: parsed.events, requestServerDateTime: parsed.requestServerDateTime }],
    now: new Date("2026-07-17T05:01:00Z"),
  });

  await assert.rejects(() => runSynchronization({
    store,
    client: {
      mode: "group-oauth",
      async fetchLatestVehiclePositionsBatch() { throw new Error("upstream unavailable"); },
      async fetchLatestVehicleStatusBatch() { return { events: [] }; },
    },
    force: true,
    now: new Date("2026-07-17T05:06:00Z"),
  }));
  const snapshot = await getLiveVolvoSnapshot({
    store,
    allowBootstrap: false,
    force: true,
    now: new Date("2026-07-17T05:06:00Z"),
  });

  assert.equal(snapshot.vehicles.length, 1);
  assert.equal(snapshot.meta.lastSuccessfulSyncAt, "2026-07-15T05:34:00Z");
});

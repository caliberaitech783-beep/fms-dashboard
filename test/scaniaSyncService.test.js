const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  getLiveScaniaSnapshot,
  runSynchronization,
} = require("../src/lib/scania/scaniaSyncService");

function memoryStore() {
  let masters = [];
  let states = [];
  let positions = [];
  const cursors = new Map();
  return {
    tableNames: {
      master: "ScaniaVehicleMaster",
      state: "ScaniaVehicleState",
      position: "ScaniaVehiclePosition",
      cursor: "ScaniaSyncCursor",
    },
    async loadMasterRecords() { return structuredClone(masters); },
    async loadStateRecords() { return structuredClone(states); },
    async loadPositionRecords() { return structuredClone(positions); },
    async saveMasterRecords(value) { masters = structuredClone(value); return { saved: value.length }; },
    async saveStateRecords(value) { states = structuredClone(value); return { saved: value.length }; },
    async savePositionRecords(value) { positions = structuredClone(value); return { saved: value.length }; },
    async getCursor(name) { return structuredClone(cursors.get(name) || null); },
    async saveCursor(name, value) {
      const cursor = { ...value, resourceName: name, updatedAt: value.cursorTime };
      cursors.set(name, cursor);
      return structuredClone(cursor);
    },
  };
}

function liveClient() {
  return {
    async getVehicles() {
      return { records: [{ vin: "SCANIA-VIN-1", customerVehicleName: "SC-101", model: "G500" }] };
    },
    async getVehicleStatuses() {
      return { records: [{
        Vin: "SCANIA-VIN-1",
        CreatedDateTime: "2026-08-01T05:00:00.000Z",
        HrTotalVehicleDistance: 120_000,
        EngineTotalFuelUsed: 40_000,
        TotalEngineHours: 12,
        SnapshotData: { WheelBasedSpeed: 22, FuelLevel1: 75 },
      }] };
    },
    async getLatestPositions() {
      return { records: [{
        Vin: "SCANIA-VIN-1",
        VehicleTrackingPositions: [{
          TimePosition: "2026-08-01T05:00:00.000Z",
          Latitude: 21.1,
          Longitude: 79.1,
          Speed: 22,
        }],
      }] };
    },
  };
}

test("syncs Scania into dedicated tables and returns a live portal snapshot", async () => {
  const store = memoryStore();
  const now = new Date("2026-08-01T05:05:00.000Z");
  const sync = await runSynchronization({ store, client: liveClient(), now });
  assert.equal(sync.mode, "bootstrap");
  assert.equal(sync.masterCount, 1);
  assert.equal(sync.stateCount, 1);
  assert.equal(sync.positionCount, 1);

  const snapshot = await getLiveScaniaSnapshot({
    store,
    now,
    allowBootstrap: false,
    force: true,
    importedVehicles: [{
      vin: "SCANIA-VIN-1",
      vehicleNumber: "SC-101",
      vehicleModel: "SCANIA G 500 XT BS VI",
      rawSiteName: "Sasti",
      serviceStatus: "Active",
    }],
  });
  assert.equal(snapshot.vehicles.length, 1);
  assert.equal(snapshot.vehicles[0].company, "Scania");
  assert.equal(snapshot.vehicles[0].siteName, "Sasti OCM");
  assert.equal(snapshot.vehicles[0].modelNumber, "SCANIA G 500 XT BS VI");
  assert.equal(snapshot.vehicles[0].status, "running");
  assert.equal(snapshot.telemetry[0].distanceKm, 120);
  assert.equal(snapshot.telemetry[0].fuelConsumedLitres, 40);
  assert.equal(snapshot.telemetry[0].truckEfficiencyKmPerLitre, 3);
  assert.equal(snapshot.integration.status, "connected");
});

test("marks an old persisted Scania snapshot offline without deleting it", async () => {
  const store = memoryStore();
  await runSynchronization({
    store,
    client: liveClient(),
    now: new Date("2026-08-01T05:05:00.000Z"),
  });
  const snapshot = await getLiveScaniaSnapshot({
    store,
    now: new Date("2026-08-01T10:00:00.000Z"),
    allowBootstrap: false,
    force: true,
    importedVehicles: [],
  });
  assert.equal(snapshot.vehicles[0].status, "offline");
  assert.equal(snapshot.telemetry[0].status, "offline");
});

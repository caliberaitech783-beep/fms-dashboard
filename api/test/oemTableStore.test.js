const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  createOemTableStore,
  defaultTableNames,
  splitTableString,
} = require("../src/lib/oem/oemTableStore");
const { listOemStoreDefinitions } = require("../src/lib/oem/oemRegistry");

function fakeClientFactory() {
  const tables = new Map();
  const factory = (name) => {
    const rows = tables.get(name) || new Map();
    tables.set(name, rows);
    return {
      async createTable() {},
      async upsertEntity(entity) {
        rows.set(`${entity.partitionKey}|${entity.rowKey}`, structuredClone(entity));
      },
      async getEntity(partitionKey, rowKey) {
        const entity = rows.get(`${partitionKey}|${rowKey}`);
        if (!entity) throw Object.assign(new Error("Not found"), { statusCode: 404 });
        return structuredClone(entity);
      },
      async *listEntities() {
        for (const entity of rows.values()) yield structuredClone(entity);
      },
    };
  };
  return { factory, tables };
}

test("defines isolated physical Azure table groups for each OEM", () => {
  assert.deepEqual(defaultTableNames("Scania"), {
    master: "ScaniaVehicleMaster",
    state: "ScaniaVehicleState",
    position: "ScaniaVehiclePosition",
    cursor: "ScaniaSyncCursor",
  });
  const definitions = listOemStoreDefinitions({});
  assert.equal(definitions.find((item) => item.name === "Volvo").tableNames.state, "VolvoVehicleState");
  assert.equal(definitions.find((item) => item.name === "Eicher").tableNames.state, "EicherVehicleState");
});

test("persists raw payloads and cursors without crossing OEM boundaries", async () => {
  const fake = fakeClientFactory();
  const scania = createOemTableStore({ oem: "Scania", clientFactory: fake.factory });
  const eicher = createOemTableStore({ oem: "Eicher", clientFactory: fake.factory });
  const largeRawValue = "x".repeat(70_000);

  await scania.saveStateRecords([{ vin: "SCANIA-1", raw: { largeRawValue } }]);
  await scania.saveCursor("live", { cursorTime: "2026-08-01T05:00:00.000Z" });
  await eicher.saveStateRecords([{ vin: "EICHER-1", raw: { source: "future-api" } }]);

  const scaniaStates = await scania.loadStateRecords();
  const eicherStates = await eicher.loadStateRecords();
  assert.equal(scaniaStates[0].raw.largeRawValue.length, 70_000);
  assert.deepEqual(eicherStates.map((row) => row.vin), ["EICHER-1"]);
  assert.equal((await scania.getCursor("live")).cursorTime, "2026-08-01T05:00:00.000Z");
  assert.ok(splitTableString(largeRawValue).length > 1);
});

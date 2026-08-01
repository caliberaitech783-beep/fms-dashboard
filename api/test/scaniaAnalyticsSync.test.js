const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  synchronizeScaniaAnalytics,
  vehicleEvaluationRows,
} = require("../src/lib/scania/scaniaAnalyticsSync");

test("persists supplied Scania analytics endpoints in the dedicated snapshot store", async () => {
  const saved = [];
  const response = (payload) => ({
    payload,
    status: 200,
    endpoint: "https://dataaccess.scania.test/resource",
  });
  const result = await synchronizeScaniaAnalytics({
    env: {
      SCANIA_START_DATE: "2026-08-01",
      SCANIA_VEHICLE_EVALUATION_URL: "configured",
      SCANIA_DRIVER_EVALUATION_V1_URL: "configured",
      SCANIA_EXCEPTION_HISTORY_URL: "configured",
    },
    fetchedAt: "2026-08-01T06:00:00.000Z",
    client: {
      async getVehicleEvaluationWithGasConsumption(query) {
        assert.deepEqual(query, { startDate: "2026-08-01" });
        return response({ VehicleList: [{ Vin: "VIN-1" }, { Vin: "VIN-2" }] });
      },
      async getDriverEvaluation(query) {
        assert.deepEqual(query, { startDate: "2026-08-01" });
        return response({ Drivers: [{ DriverRef: "DRIVER-1" }] });
      },
      async getExceptions() {
        return { ...response({ CustomerVehicles: { VehicleExceptionInformation: [] } }), records: [] };
      },
    },
    store: {
      async saveSnapshot(resource, payload, metadata) {
        saved.push({ resource, payload, metadata });
        return { resource, recordCount: metadata.recordCount };
      },
    },
  });

  assert.deepEqual(result.failed, []);
  assert.equal(result.completed.length, 3);
  assert.deepEqual(saved.map((item) => [item.resource, item.metadata.recordCount]), [
    ["vehicle-evaluation", 2],
    ["driver-evaluation", 1],
    ["exceptions", 0],
  ]);
});

test("reads direct and wrapped Scania vehicle evaluation rows", () => {
  assert.equal(vehicleEvaluationRows({ VehicleList: [{ Vin: "DIRECT" }] }).length, 1);
  assert.equal(vehicleEvaluationRows({
    EvaluationVehicles: { VehicleList: { EvaluationVehicle: [{ Vin: "WRAPPED" }] } },
  }).length, 1);
});

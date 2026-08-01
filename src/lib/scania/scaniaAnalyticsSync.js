const { createScaniaClientFromEnv } = require("./scaniaClient");
const defaultStore = require("./scaniaAnalyticsStore");

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value && typeof value === "object" ? [value] : [];
}

function vehicleEvaluationRows(payload) {
  return asArray(
    payload?.VehicleList
    || payload?.EvaluationVehiclesWithGasConsumption?.VehicleList?.EvaluationVehicleWithGasConsumption
    || payload?.EvaluationVehiclesWithGasConsumption?.VehicleList
    || payload?.EvaluationVehicles?.VehicleList?.EvaluationVehicle
    || payload?.EvaluationVehicles?.VehicleList,
  );
}

function driverEvaluationRows(payload) {
  return asArray(
    payload?.Drivers
    || payload?.EvaluationDriversWithIdentification?.Drivers?.EvaluationDriverWithIdentification
    || payload?.EvaluationDriversWithIdentification?.Drivers
    || payload?.EvaluationDrivers?.Drivers?.EvaluationDriver
    || payload?.EvaluationDrivers?.Drivers,
  );
}

function exceptionRows(payload) {
  return asArray(
    payload?.CustomerVehicles?.VehicleExceptionInformation
    || payload?.VehiclesExceptionInformation?.CustomerVehicles?.VehicleExceptionInformation
    || payload?.VehicleExceptionInformation,
  );
}

function trackingRows(payload) {
  return asArray(payload?.VehicleTracksList || payload?.vehicleTracksList || payload);
}

function healthRows(payload) {
  return asArray(payload);
}

async function synchronizeScaniaAnalytics(options = {}) {
  const env = options.env || process.env;
  const client = options.client || createScaniaClientFromEnv({ env });
  const store = options.store || defaultStore;
  const fetchedAt = options.fetchedAt || new Date().toISOString();
  const startDate = String(env.SCANIA_START_DATE || fetchedAt.slice(0, 10)).trim();
  const operations = [
    {
      resource: "vehicle-evaluation",
      configured: Boolean(env.SCANIA_VEHICLE_EVALUATION_URL),
      request: () => client.getVehicleEvaluationWithGasConsumption({ startDate }),
      rows: vehicleEvaluationRows,
    },
    {
      resource: "driver-evaluation",
      configured: Boolean(
        env.SCANIA_DRIVER_EVALUATION_URL
        || env.SCANIA_DRIVER_EVALUATION_V2_URL
        || env.SCANIA_DRIVER_EVALUATION_V1_URL,
      ),
      request: () => client.getDriverEvaluation({ startDate }),
      rows: driverEvaluationRows,
    },
    {
      resource: "vehicle-driver-evaluation",
      configured: Boolean(env.SCANIA_VEHICLE_DRIVER_EVALUATION_URL),
      request: () => client.getVehicleDriverEvaluation(),
      rows: driverEvaluationRows,
    },
    {
      resource: "exceptions",
      configured: Boolean(env.SCANIA_EXCEPTION_HISTORY_URL),
      request: () => client.getExceptions(),
      rows: (payload) => exceptionRows(payload),
    },
    {
      resource: "tracking-history",
      configured: Boolean(env.SCANIA_TRACKING_HISTORY_URL),
      request: () => client.getTrackingHistory(),
      rows: (payload) => trackingRows(payload),
    },
    {
      resource: "health",
      configured: Boolean(env.SCANIA_HEALTH_URL),
      request: () => client.getHealth(),
      rows: healthRows,
    },
  ].filter((operation) => operation.configured);

  const results = await Promise.allSettled(operations.map(async (operation) => {
    const response = await operation.request();
    const records = response.records || operation.rows(response.payload);
    const saved = await store.saveSnapshot(operation.resource, response.payload, {
      endpoint: response.endpoint,
      fetchedAt,
      httpStatus: response.status,
      recordCount: records.length,
    });
    return { ...saved, httpStatus: response.status };
  }));

  const completed = [];
  const failed = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      completed.push(result.value);
    } else {
      failed.push({
        resource: operations[index].resource,
        kind: result.reason?.kind || "upstream",
        httpStatus: result.reason?.httpStatus || null,
      });
    }
  });
  if (!completed.length && failed.length) throw results.find((item) => item.status === "rejected").reason;
  return { fetchedAt, completed, failed };
}

module.exports = {
  driverEvaluationRows,
  exceptionRows,
  healthRows,
  synchronizeScaniaAnalytics,
  trackingRows,
  vehicleEvaluationRows,
};

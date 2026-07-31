const { loadLocalEnv } = require("../src/lib/loadLocalEnv");
const {
  createScaniaClientFromEnv,
} = require("../src/lib/scania/scaniaClient");

loadLocalEnv();

const reportQuery = {
  startDate: "202607310500",
  stopDate: "202607311300",
  timeZone: "(UTC+05:30) India Standard Time (Kolkata)",
};

function safeEvent(event, details) {
  console.log(JSON.stringify({
    event,
    endpoint: details.endpoint,
    status: details.status,
    operation: details.operation,
  }));
}

async function tryProvidedAccessToken() {
  if (!process.env.SCANIA_ACCESS_TOKEN) return null;
  try {
    const tokenClient = createScaniaClientFromEnv({
      clientId: "",
      clientSecret: "",
      initialTokenTtlMs: 5 * 60_000,
      onEvent: safeEvent,
    });
    const result = await tokenClient.getVehicleEvaluationWithGasConsumption(reportQuery);
    return {
      outcome: "success",
      method: "provided_access_token",
      endpoint: result.endpoint,
      httpStatus: result.status,
    };
  } catch (error) {
    return {
      outcome: "error",
      method: "provided_access_token",
      kind: error.kind || "unknown",
      statusCode: error.statusCode || null,
      httpStatus: error.httpStatus || null,
      endpoint: error.endpoint || null,
    };
  }
}

async function main() {
  try {
    const client = createScaniaClientFromEnv({
      onEvent: safeEvent,
    });
    const result = await client.getVehicleEvaluationWithGasConsumption(reportQuery);
    const gasRows = result.payload
      ?.EvaluationVehiclesWithGasConsumption
      ?.VehicleList
      ?.EvaluationVehicleWithGasConsumption;
    const standardRows = result.payload
      ?.EvaluationVehicles
      ?.VehicleList
      ?.EvaluationVehicle;
    const rows = Array.isArray(gasRows)
      ? gasRows
      : Array.isArray(standardRows)
        ? standardRows
        : [];
    console.log(JSON.stringify({
      outcome: "success",
      endpoint: result.endpoint,
      httpStatus: result.status,
      rawRecordCount: rows.length,
    }));
  } catch (error) {
    console.log(JSON.stringify({
      outcome: "error",
      kind: error.kind || "unknown",
      statusCode: error.statusCode || null,
      httpStatus: error.httpStatus || null,
      endpoint: error.endpoint || null,
    }));
    const tokenResult = await tryProvidedAccessToken();
    if (tokenResult) console.log(JSON.stringify(tokenResult));
    process.exitCode = 2;
  }
}

main();

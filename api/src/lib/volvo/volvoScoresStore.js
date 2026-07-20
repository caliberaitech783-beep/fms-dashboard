const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");
const { driverIdentifier } = require("./volvoScoresClient");

const SCORE_PARTITION_PREFIX = "SCORE";
let setupPromise = null;
let scoresTable = null;

function getConnectionString() {
  const value = process.env.AzureWebJobsStorage;
  if (!value) throw Object.assign(new Error("AzureWebJobsStorage is not configured."), { statusCode: 500 });
  return value;
}

function makeTableClient() {
  const tableName = process.env.VOLVO_SCORES_TABLE_NAME || "VolvoDriverScores";
  const connectionString = getConnectionString();
  if (connectionString === "UseDevelopmentStorage=true" || connectionString.startsWith("DefaultEndpointsProtocol=")) {
    return TableClient.fromConnectionString(connectionString, tableName);
  }
  const accountName = process.env.STORAGE_ACCOUNT_NAME;
  const accountKey = process.env.STORAGE_ACCOUNT_KEY;
  if (!accountName || !accountKey) {
    throw Object.assign(new Error("Storage account credentials are not configured."), { statusCode: 500 });
  }
  return new TableClient(
    `https://${accountName}.table.core.windows.net`,
    tableName,
    new AzureNamedKeyCredential(accountName, accountKey),
  );
}

function ignoreConflict(error) {
  if (error?.statusCode !== 409) throw error;
}

async function setup() {
  if (!setupPromise) {
    setupPromise = (async () => {
      scoresTable = makeTableClient();
      await scoresTable.createTable().catch(ignoreConflict);
    })();
  }
  await setupPromise;
}

function keyFor(value) {
  return Buffer.from(String(value), "utf8").toString("base64url");
}

function scoreValue(record, name) {
  const value = Number(record?.scores?.[name] ?? record?.Scores?.[name]);
  return Number.isFinite(value) ? value : null;
}

function metricValue(record, name) {
  const value = Number(record?.[name] ?? record?.[name[0].toUpperCase() + name.slice(1)]);
  return Number.isFinite(value) ? value : null;
}

async function saveScoreSnapshot(snapshot, options = {}) {
  await setup();
  const response = snapshot?.vuScoreResponse || {};
  const startTime = String(response.startTime || options.startTime || "");
  const stopTime = String(response.stopTime || options.stopTime || "");
  const driverIdType = String(options.driverIdType || "pin");
  const partitionKey = `${SCORE_PARTITION_PREFIX}_${keyFor(`${startTime}|${stopTime}|${driverIdType}`)}`;
  const fetchedAt = snapshot?.meta?.fetchedAt || new Date().toISOString();
  const drivers = Array.isArray(response.drivers) ? response.drivers : [];

  if (response.fleet) {
    await scoresTable.upsertEntity({
      partitionKey,
      rowKey: "FLEET",
      recordType: "fleet",
      startTime,
      stopTime,
      driverIdType,
      totalScore: scoreValue(response.fleet, "total"),
      totalTime: metricValue(response.fleet, "totalTime"),
      totalDistance: metricValue(response.fleet, "totalDistance"),
      vehicleUtilization: metricValue(response.fleet, "vehicleUtilization"),
      fetchedAt,
      recordJson: JSON.stringify(response.fleet),
    }, "Replace");
  }

  for (let index = 0; index < drivers.length; index += 1) {
    const record = drivers[index];
    const identifier = driverIdentifier(record) || `anonymous-${index + 1}`;
    await scoresTable.upsertEntity({
      partitionKey,
      rowKey: keyFor(identifier),
      recordType: "driver",
      driverIdentifier: identifier,
      startTime,
      stopTime,
      driverIdType,
      totalScore: scoreValue(record, "total"),
      standstillScore: scoreValue(record, "standstill"),
      idlingScore: scoreValue(record, "idling"),
      coastingScore: scoreValue(record, "coasting"),
      aboveEconomyScore: scoreValue(record, "aboveEconomy"),
      engineLoadScore: scoreValue(record, "engineLoad"),
      totalTime: metricValue(record, "totalTime"),
      totalDistance: metricValue(record, "totalDistance"),
      averageFuelConsumption: metricValue(record, "avgFuelConsumption"),
      vehicleUtilization: metricValue(record, "vehicleUtilization"),
      fetchedAt,
      recordJson: JSON.stringify(record),
    }, "Replace");
  }

  return {
    tableName: process.env.VOLVO_SCORES_TABLE_NAME || "VolvoDriverScores",
    partitionKey,
    fleetRecords: response.fleet ? 1 : 0,
    driverRecords: drivers.length,
  };
}

module.exports = {
  saveScoreSnapshot,
  setup,
};

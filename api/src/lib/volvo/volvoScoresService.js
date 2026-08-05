const { createVolvoScoresClientFromEnv } = require("./volvoScoresClient");
const scoreStore = require("./volvoScoresStore");

const cache = new Map();

function cacheKey(startTime, stopTime, driverIdType) {
  return `${startTime}|${stopTime}|${String(driverIdType).toLowerCase()}`;
}

function clearVolvoScoresCache() {
  cache.clear();
}

async function getVolvoScores(options = {}) {
  const env = options.env || process.env;
  const startTime = String(options.startTime || "").trim();
  const stopTime = String(options.stopTime || "").trim();
  const driverIdType = String(options.driverIdType || env.VOLVO_SCORES_DRIVER_ID_TYPE || "pin").trim() || "pin";
  const key = cacheKey(startTime, stopTime, driverIdType);
  const cacheMilliseconds = Math.max(0, Number(env.VOLVO_SCORES_CACHE_MS || 300_000));
  const cached = cache.get(key);
  if (!options.force && cached && Date.now() - cached.cachedAt < cacheMilliseconds) {
    return { ...cached.value, meta: { ...cached.value.meta, cacheHit: true } };
  }

  const client = options.client || createVolvoScoresClientFromEnv(env);
  const result = await client.fetchScores({ startTime, stopTime, driverIdType });
  const fetchedAt = new Date().toISOString();
  const snapshot = {
    vuScoreResponse: {
      startTime: result.startTime || startTime,
      stopTime: result.stopTime || stopTime,
      fleet: result.fleet,
      drivers: result.drivers,
      moreDataAvailable: false,
      moreDataAvailableLink: null,
      requestServerDateTime: result.requestServerDateTime,
    },
    meta: {
      source: "VOLVO_SCORES_LIVE",
      fetchedAt,
      pagesFetched: result.pagesFetched,
      driverRecords: result.drivers.length,
      driverIdType,
      cacheHit: false,
      persistence: { status: "disabled" },
    },
  };

  const persist = options.persist ?? String(env.VOLVO_SCORES_PERSIST || "true").toLowerCase() !== "false";
  if (persist) {
    try {
      const store = options.store || scoreStore;
      const saved = await store.saveScoreSnapshot(snapshot, { startTime, stopTime, driverIdType });
      snapshot.meta.persistence = { status: "saved", ...saved };
    } catch {
      snapshot.meta.persistence = { status: "failed", message: "Volvo Scores data could not be persisted." };
    }
  }

  cache.set(key, { cachedAt: Date.now(), value: snapshot });
  return snapshot;
}

module.exports = {
  clearVolvoScoresCache,
  getVolvoScores,
};

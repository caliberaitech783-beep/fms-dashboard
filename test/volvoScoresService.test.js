const assert = require("node:assert/strict");
const test = require("node:test");
const {
  clearVolvoScoresCache,
  getVolvoScores,
} = require("../src/lib/volvo/volvoScoresService");

test("wraps live Volvo score data and persists it without changing frontend data", async () => {
  clearVolvoScoresCache();
  let savedSnapshot = null;
  const client = {
    async fetchScores() {
      return {
        startTime: "2026-07-07",
        stopTime: "2026-07-18",
        fleet: { scores: { total: 64.58 } },
        drivers: [{
          driverId: { oemDriverIdentification: { oemDriverIdentification: "4983548053" } },
          scores: { total: 72.1, standstill: 57.26 },
        }],
        moreDataAvailable: false,
        requestServerDateTime: "2026-07-18T07:12:28Z",
        pagesFetched: 1,
      };
    },
  };
  const store = {
    async saveScoreSnapshot(snapshot) {
      savedSnapshot = snapshot;
      return { tableName: "VolvoDriverScores", driverRecords: 1, fleetRecords: 1 };
    },
  };

  const result = await getVolvoScores({
    startTime: "2026-07-07",
    stopTime: "2026-07-18",
    driverIdType: "pin",
    client,
    store,
    env: { VOLVO_SCORES_CACHE_MS: "300000", VOLVO_SCORES_PERSIST: "true" },
  });

  assert.equal(result.vuScoreResponse.fleet.scores.total, 64.58);
  assert.equal(result.vuScoreResponse.drivers.length, 1);
  assert.equal(result.meta.source, "VOLVO_SCORES_LIVE");
  assert.equal(result.meta.persistence.status, "saved");
  assert.equal(savedSnapshot.vuScoreResponse.drivers.length, 1);
});

test("serves repeated requests from the score cache", async () => {
  clearVolvoScoresCache();
  let calls = 0;
  const client = {
    async fetchScores() {
      calls += 1;
      return {
        startTime: "2026-07-07",
        stopTime: "2026-07-18",
        fleet: null,
        drivers: [],
        requestServerDateTime: "2026-07-18T07:12:28Z",
        pagesFetched: 1,
      };
    },
  };
  const options = {
    startTime: "2026-07-07",
    stopTime: "2026-07-18",
    driverIdType: "pin",
    client,
    persist: false,
    env: { VOLVO_SCORES_CACHE_MS: "300000" },
  };

  await getVolvoScores(options);
  const cached = await getVolvoScores(options);

  assert.equal(calls, 1);
  assert.equal(cached.meta.cacheHit, true);
});

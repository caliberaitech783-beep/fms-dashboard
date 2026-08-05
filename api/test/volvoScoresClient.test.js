const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_ACCEPT_SCORES,
  VolvoScoresClient,
  driverIdentifier,
  parseScorePage,
} = require("../src/lib/volvo/volvoScoresClient");

function response(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    text: async () => JSON.stringify(payload),
  };
}

function scoreRecord(identifier, total) {
  return {
    driverId: {
      oemDriverIdentification: {
        idType: "ANALOG",
        oemDriverIdentification: identifier,
      },
    },
    scores: { total, standstill: 60, idling: 60, coasting: 80 },
    totalTime: 1234,
    totalDistance: 5678,
    avgFuelConsumption: 91.2,
  };
}

test("parses the supplied vuScoreResponse shape", () => {
  const parsed = parseScorePage({
    vuScoreResponse: {
      startTime: "2026-07-07",
      stopTime: "2026-07-18",
      fleet: { scores: { total: 64.58 } },
      drivers: [scoreRecord("4983548053", 72.1)],
      moreDataAvailable: true,
      moreDataAvailableLink: "/score/scores?lastDriverId=4983548053",
      requestServerDateTime: "2026-07-18T07:12:28Z",
    },
  });

  assert.equal(parsed.startTime, "2026-07-07");
  assert.equal(parsed.stopTime, "2026-07-18");
  assert.equal(parsed.fleet.scores.total, 64.58);
  assert.equal(parsed.drivers.length, 1);
  assert.equal(driverIdentifier(parsed.drivers[0]), "4983548053");
  assert.equal(parsed.moreDataAvailable, true);
});

test("uses Basic auth, required media type and paginates driver scores", async () => {
  const calls = [];
  const payloads = [
    {
      vuScoreResponse: {
        startTime: "2026-07-07",
        stopTime: "2026-07-18",
        fleet: { scores: { total: 64.58 } },
        drivers: [scoreRecord("4983548053", 72.1)],
        moreDataAvailable: true,
        moreDataAvailableLink: "/score/scores?lastDriverId=4983548053&contentFilter=VEHICLES%2CDRIVERS%2CFLEET&starttime=2026-07-07&stoptime=2026-07-18&driverIdType=pin",
        requestServerDateTime: "2026-07-18T07:12:28Z",
      },
    },
    {
      vuScoreResponse: {
        startTime: "2026-07-07",
        stopTime: "2026-07-18",
        drivers: [scoreRecord("5034114525", 78.38)],
        moreDataAvailable: false,
        requestServerDateTime: "2026-07-18T07:12:29Z",
      },
    },
  ];
  const requestIds = ["request-one", "request-two"];
  const client = new VolvoScoresClient({
    scoresUrl: "https://api.volvotrucks.test/score/scores",
    username: "score-user",
    password: "score-password",
    accept: DEFAULT_ACCEPT_SCORES,
    retries: 0,
    requestIdFactory: () => requestIds.shift(),
    fetchFn: async (url, options) => {
      calls.push({ url: String(url), options });
      return response(200, payloads.shift());
    },
  });

  const result = await client.fetchScores({
    startTime: "2026-07-07",
    stopTime: "2026-07-18",
    driverIdType: "pin",
  });

  assert.equal(result.pagesFetched, 2);
  assert.deepEqual(result.drivers.map(driverIdentifier), ["4983548053", "5034114525"]);
  assert.equal(result.fleet.scores.total, 64.58);
  assert.equal(calls[0].options.headers.Accept, DEFAULT_ACCEPT_SCORES);
  assert.equal(calls[0].options.headers.Authorization, `Basic ${Buffer.from("score-user:score-password").toString("base64")}`);
  assert.equal(new URL(calls[0].url).searchParams.get("requestId"), "request-one");
  assert.equal(new URL(calls[0].url).searchParams.get("starttime"), "2026-07-07");
  assert.equal(new URL(calls[0].url).searchParams.get("driverIdType"), "pin");
  assert.equal(new URL(calls[1].url).searchParams.get("requestId"), "request-two");
  assert.equal(new URL(calls[1].url).searchParams.get("lastDriverId"), "4983548053");
  assert.equal(new URL(calls[1].url).searchParams.get("contentFilter"), "VEHICLES,DRIVERS,FLEET");
});

test("masks Volvo Scores credentials from transport errors", async () => {
  const password = "score-secret-password";
  const client = new VolvoScoresClient({
    scoresUrl: "https://api.volvotrucks.test/score/scores",
    username: "score-secret-user",
    password,
    accept: DEFAULT_ACCEPT_SCORES,
    retries: 0,
    fetchFn: async () => {
      throw new Error(`transport failure ${password}`);
    },
  });

  await assert.rejects(
    () => client.fetchScores({ startTime: "2026-07-07", stopTime: "2026-07-18" }),
    (error) => {
      assert.equal(error.message.includes(password), false);
      assert.equal(error.message.includes("[masked]"), true);
      return true;
    },
  );
});

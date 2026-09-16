const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createVolvoRequestGate } = require("../src/lib/volvo/volvoRequestGate");
const { fetchFleetHistory, fetchVehicleScopedHistory } = require("../src/lib/volvo/driverStandstillReport");

for (const header of ["120", "Wed, 16 Sep 2026 12:02:00 GMT", null]) {
  test(`shared cooldown respects Retry-After ${header}`, async () => {
    let now = Date.parse("2026-09-16T12:00:00Z");
    let calls = 0;
    const gate = createVolvoRequestGate({ now: () => now, concurrency: 1 });
    const fetchFn = async () => { calls++; return new Response(null, { status: calls === 1 ? 429 : 200, headers: header ? { "Retry-After": header } : {} }); };
    const results = await Promise.allSettled([gate(fetchFn, "url"), gate(fetchFn, "url"), gate(fetchFn, "url")]);
    assert.equal(calls, 1);
    for (const result of results) {
      assert.equal(result.status, "rejected");
      assert.equal(result.reason.statusCode, 429);
      assert.equal(result.reason.retryAfterMs, header ? 120000 : 60000);
    }
    now += header ? 120001 : 60001;
    assert.equal((await gate(fetchFn, "url")).status, 200);
    assert.equal(calls, 2);
  });
}

test("queued aborted request never reaches Volvo", async () => {
  const gate = createVolvoRequestGate({ concurrency: 1 });
  let release;
  let calls = 0;
  const fetchFn = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const first = gate(fetchFn, "url");
  const controller = new AbortController();
  const second = gate(fetchFn, "url", { signal: controller.signal });
  controller.abort();
  const rejected = assert.rejects(second, { name: "AbortError" });
  release(new Response(null));
  await Promise.all([first, rejected]);
  assert.equal(calls, 1);
});

test("429 stops VIN retries, new workers and fleet fallback", async () => {
  let calls = 0;
  const error = Object.assign(new Error("limited"), { statusCode: 429, retryAfterMs: 60000 });
  const client = { fetchHistoricalVehicleStatuses: async () => { calls++; throw error; } };
  const vehicles = Array.from({ length: 9 }, (_, i) => ({ trackerId: `VIN-${i}` }));
  await assert.rejects(fetchFleetHistory(client, vehicles), { statusCode: 429 });
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(fetchVehicleScopedHistory(client, vehicles, { concurrency: 2, retryAttempts: 3, continueOnError: true }), { statusCode: 429 });
  assert.equal(calls, 2);
});

test("production client factories share cooldown without inner retries", async () => {
  const { createVolvoRfmsClientFromEnv } = require("../src/lib/volvo/volvoRfmsClient");
  let calls = 0;
  const options = { fetchFn: async () => { calls++; return new Response(null, { status: 429, headers: { "Retry-After": "120" } }); } };
  const env = { VOLVO_RFMS_USERNAME: "test-user", VOLVO_RFMS_PASSWORD: "test-password" };
  const first = createVolvoRfmsClientFromEnv(env, options);
  const second = createVolvoRfmsClientFromEnv(env, options);
  for (const client of [first, second]) {
    await assert.rejects(client.request("vehicles"), error => error.statusCode === 429 && error.retryAfterMs > 110000);
  }
  assert.equal(calls, 1);
});

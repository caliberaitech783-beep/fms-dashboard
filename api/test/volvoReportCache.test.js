const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createVolvoReportCache } = require("../src/lib/volvo/volvoReportCache");

function fixture() {
  let now = Date.parse("2026-10-13T10:30:00Z");
  const cache = createVolvoReportCache({ now: () => now });
  const query = () => ({ scope: "Sasti|B", start: "2026-10-13T07:30:00Z", end: new Date(now).toISOString() });
  return { cache, query, advance(ms) { now += ms; } };
}

test("moving live cutoffs reuse the saved report across minute boundaries", async () => {
  const f = fixture(); let calls = 0;
  const first = await f.cache.getOrLoad(f.query(), async () => ({ generatedAt: f.query().end, period: f.query(), rows: [++calls] }));
  f.advance(120_000);
  assert.equal(await f.cache.getOrLoad(f.query(), async () => { calls++; }), first);
  assert.equal(calls, 1);
  f.advance(181_000);
  const updated = await f.cache.getOrLoad(f.query(), async () => ({ rows: [++calls] }));
  assert.deepEqual(updated.rows, [2]);
});

test("expired reports survive 429 with original timestamps and a visible notice", async () => {
  const f = fixture(); const original = { generatedAt: f.query().end, period: f.query(), rows: [1] };
  await f.cache.getOrLoad(f.query(), async () => original);
  f.advance(301_000);
  const result = await f.cache.getOrLoad(f.query(), async () => { throw Object.assign(new Error("limited"), { statusCode: 429 }); });
  assert.deepEqual(result.period, original.period);
  assert.equal(result.generatedAt, original.generatedAt);
  assert.match(result.notice, /saved report/);
  await assert.rejects(f.cache.getOrLoad({ ...f.query(), scope: "Dhoptala|B" }, async () => { throw Object.assign(new Error("limited"), { statusCode: 429 }); }), { statusCode: 429 });
});

test("completed windows are cached for a day and exact periods stay separate", async () => {
  const f = fixture(); const q = { ...f.query(), end: "2026-10-13T08:00:00Z" };
  const first = await f.cache.getOrLoad(q, async () => ({ rows: [1] }));
  f.advance(3_600_000);
  assert.equal(await f.cache.getOrLoad(q, async () => ({ rows: [2] })), first);
  assert.deepEqual(await f.cache.getOrLoad({ ...q, end: "2026-10-13T08:01:00Z" }, async () => ({ rows: [3] })), { rows: [3] });
});

test("concurrent current reports share one request but earlier cutoffs never receive later data", async () => {
  const f = fixture(); let release; let calls = 0;
  const first = f.cache.getOrLoad(f.query(), () => { calls++; return new Promise(resolve => { release = resolve; }); });
  f.advance(1000);
  const second = f.cache.getOrLoad(f.query(), () => { calls++; });
  release({ rows: [1] });
  assert.deepEqual(await first, await second); assert.equal(calls, 1);
  const earlier = { ...f.query(), end: "2026-10-13T10:29:59Z" };
  assert.deepEqual(await f.cache.getOrLoad(earlier, async () => ({ rows: [0] })), { rows: [0] });
});

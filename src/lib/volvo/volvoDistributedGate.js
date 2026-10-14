const store = require("./volvoBackgroundStore");
const { setTimeout: sleep } = require("node:timers/promises");
function cooldownMs(response, now = Date.now()) {
  const value = response.headers?.get("retry-after");
  const seconds = value == null ? NaN : Number(value);
  const reset = Number(response.headers?.get("x-rate-limit-reset"));
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Math.max(1000, Number.isFinite(delay) && delay > 0 ? delay : reset * 1000 > now ? reset * 1000 - now : 60000);
}
function createDistributedGate(db = store, now = Date.now, wait = sleep) {
  return async (fetchFn, url, options = {}) => {
    const interval = Math.max(500, Number(process.env.VOLVO_SHARED_REQUEST_INTERVAL_MS || 2000));
    for (;;) {
      options.signal?.throwIfAborted();
      const row = await db.get("CONTROL", "REQUEST");
      const time = now();
      if (row?.blockedUntil > time) throw Object.assign(new Error("Volvo background collection is waiting for the shared rate-limit cooldown."), { statusCode: 429, retryAfterMs: row.blockedUntil - time });
      if (row?.nextAt > time) { await wait(Math.min(row.nextAt - time, 2000), undefined, { signal: options.signal }); continue; }
      const next = { partitionKey: "CONTROL", rowKey: "REQUEST", nextAt: time + interval, blockedUntil: row?.blockedUntil || 0 };
      if (row ? await db.replace(next, row.etag) : await db.create(next)) break;
    }
    const response = await fetchFn(url, options);
    if (response.status === 429) {
      const delay = cooldownMs(response, now());
      for (;;) {
        const row = await db.get("CONTROL", "REQUEST");
        if (await db.replace({ ...row, blockedUntil: Math.max(row.blockedUntil || 0, now() + delay) }, row.etag)) break;
      }
    }
    return response;
  };
}
const gate = createDistributedGate();
module.exports = { createDistributedGate, cooldownMs, distributedFetch: gate };

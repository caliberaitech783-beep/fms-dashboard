// Shared by all Volvo clients in this API process, including dashboard requests.
// A vendor cooldown must not be bypassed by creating another client instance.
function createVolvoRequestGate({ now = Date.now, concurrency = 2, minIntervalMs = 0, schedule = setTimeout } = {}) {
  let active = 0;
  let blockedUntil = 0;
  let nextStart = 0;
  let timerPending = false;
  const queue = [];
  function rateLimitError() {
    return Object.assign(new Error("Volvo is temporarily limiting requests. Please wait before generating another report."), {
      statusCode: 429,
      retryAfterMs: Math.max(1000, blockedUntil - now()),
    });
  }
  function drain() {
    if (timerPending) return;
    while (queue.length && active < concurrency) {
      const delay = nextStart - now();
      if (delay > 0 && blockedUntil <= now()) {
        timerPending = true;
        schedule(() => { timerPending = false; drain(); }, delay);
        return;
      }
      nextStart = now() + minIntervalMs;
      queue.shift()();
    }
  }
  return function guardedFetch(fetchFn, url, options) {
    return new Promise((resolve, reject) => {
      const run = async () => {
        if (options?.signal?.aborted) { reject(options.signal.reason); return; }
        if (blockedUntil > now()) { reject(rateLimitError()); return; }
        active += 1;
        try {
          const response = await fetchFn(url, options);
          if (response.status === 429) {
            const header = response.headers?.get("retry-after");
            const numeric = header === null || header === undefined ? NaN : Number(header);
            const delay = Number.isFinite(numeric) ? numeric * 1000 : Date.parse(header) - now();
            blockedUntil = Math.max(blockedUntil, now() + (Number.isFinite(delay) && delay > 0 ? delay : 60_000));
            await response.body?.cancel().catch(() => {});
            throw rateLimitError();
          }
          resolve(response);
        } catch (error) {
          reject(error);
        } finally {
          active -= 1;
          drain();
        }
      };
      queue.push(run);
      drain();
    });
  };
}

const configuredInterval = Number(process.env.VOLVO_REQUEST_INTERVAL_MS || 500);
const gate = createVolvoRequestGate({ minIntervalMs: Number.isFinite(configuredInterval) ? Math.max(100, configuredInterval) : 500 });
function guardedVolvoFetch(fetchFn = globalThis.fetch) {
  const sharedFetch = process.env.AzureWebJobsStorage
    ? (url, options) => require("./volvoDistributedGate").distributedFetch(fetchFn, url, options)
    : fetchFn;
  return (url, options) => gate(sharedFetch, url, options);
}
module.exports = { createVolvoRequestGate, guardedVolvoFetch };

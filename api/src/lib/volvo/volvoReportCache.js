// Reuse reports across browser sessions without changing their measured period.
function createVolvoReportCache({ now = Date.now, liveTtlMs = 300_000, completedTtlMs = 86_400_000, maxEntries = 128 } = {}) {
  const entries = new Map();
  const pending = new Map();
  return {
    clear() { entries.clear(); },
    async getOrLoad({ scope, start, end }, load) {
      const endMs = Date.parse(end);
      const live = Math.abs(now() - endMs) < 60_000;
      const key = JSON.stringify([scope, start, live ? "current" : end]);
      const cached = entries.get(key);
      // Never use a report that extends past the user's requested cutoff.
      const usable = cached && cached.endMs <= endMs;
      const ttl = endMs < now() - 60_000 ? completedTtlMs : liveTtlMs;
      if (usable && now() - cached.savedAt < ttl) return cached.value;
      const running = pending.get(key);
      if (running && running.endMs <= endMs) return running.promise;
      const promise = (async () => {
        try {
          const value = await load();
          if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
          entries.set(key, { value, savedAt: now(), endMs });
          return value;
        } catch (error) {
          if (error.statusCode !== 429 || !usable) throw error;
          return {
            ...cached.value,
            notice: [cached.value.notice,
              `Volvo refresh is temporarily rate limited. Showing the saved report generated at ${cached.value.generatedAt}; the reporting period shown has not been extended.`,
            ].filter(Boolean).join(" "),
          };
        }
      })();
      pending.set(key, { promise, endMs });
      try { return await promise; }
      finally { if (pending.get(key)?.promise === promise) pending.delete(key); }
    },
  };
}
module.exports = { createVolvoReportCache };

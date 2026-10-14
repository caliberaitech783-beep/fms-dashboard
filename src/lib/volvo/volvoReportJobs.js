const db = require("./volvoBackgroundStore");
function reportQuery(query) {
  const value = Object.fromEntries(["date", "shift", "site", "startTime", "stopTime"].map(key => [key, String(query.get(key) || "").trim()]));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !["A", "B", "C"].includes(value.shift) || !value.site || value.site.length > 100) throw Object.assign(new Error("A valid report date, shift and site are required."), {statusCode:400});
  for (const field of ["startTime", "stopTime"]) if (value[field] && !Number.isFinite(Date.parse(value[field]))) throw Object.assign(new Error("Invalid report time."), {statusCode:400});
  if (value.startTime && value.stopTime && (Date.parse(value.stopTime) <= Date.parse(value.startTime) || Date.parse(value.stopTime) - Date.parse(value.startTime) > 32 * 86400000)) throw Object.assign(new Error("Select a report period between zero and 31 days."), {statusCode:400});
  // Coalesce moving live cutoffs into five-minute buckets; returned periods retain the actual saved cutoff.
  if (value.stopTime && Date.now() - Date.parse(value.stopTime) < 600000) value.stopTime = new Date(Math.floor(Math.min(Date.parse(value.stopTime), Date.now()) / 300000) * 300000).toISOString();
  if (value.startTime && value.stopTime && Date.parse(value.stopTime) <= Date.parse(value.startTime)) throw Object.assign(new Error("The report period has not started collecting yet. Retry after the next five-minute interval."), {statusCode:400});
  return value;
}
const liveKey = values => 'latest-report:' + JSON.stringify({...values,stopTime:""});
async function requestReport(query, store = db) {
  const values = reportQuery(query), key = 'report:' + JSON.stringify(values), id = store.hash(key);
  const cached = await store.read(key);
  const stop = values.stopTime ? Date.parse(values.stopTime) : Date.parse(values.date + "T23:59:59+05:30");
  const fresh = cached && (Date.now() - Date.parse(cached.savedAt) < 300000 || stop < Date.now() - 86400000 && Date.parse(cached.savedAt) > stop + 3600000);
  if (!fresh) {
    const entity = { partitionKey:"JOB", rowKey:id, key, query:JSON.stringify(values), dueAt:Date.now(), leaseUntil:0, attempts:0, status:"queued" };
    const existing = await store.get("JOB", id);
    if (!existing) await store.create(entity);
    else if (existing.status === "failed") throw Object.assign(new Error("This report period could not be collected. Check the date, shift and site and generate again."), {statusCode:400});
    else if (existing.status === "complete") await store.replace(entity, existing.etag);
  }
  const previous = !cached && values.stopTime && Math.abs(Date.now()-Date.parse(values.stopTime)) < 600000 ? await store.read(liveKey(values)) : null;
  const available = cached || previous;
  if (available) return { status:200, report:{ ...available.value, notice:[available.value.notice, `Loaded from FMS database. Last saved: ${available.savedAt}.`, !fresh && "A background refresh is queued; the displayed report retains its saved reporting period."].filter(Boolean).join(" ") } };
  const job = await store.get("JOB", id);
  const waiting = job?.dueAt > Date.now();
  const reason = job?.lastStatus === 429 ? "Volvo has rate-limited collection." : job?.lastStatus === 401 || job?.lastStatus === 403 ? "Volvo rejected collector authentication or API access." : job?.lastStatus ? `Collection encountered an error (HTTP ${job.lastStatus}).` : job?.status === "running" ? "The collector is processing this shift." : "This shift is waiting in the collection queue.";
  const retry = waiting ? ` Next collection attempt: ${new Date(job.dueAt).toISOString()}.` : "";
  return { status:202, report:{reportType:"Driverwise Standstill Tracking",generatedAt:new Date().toISOString(),columns:[],rows:[],processing:true,notice:`${reason}${retry} This page checks automatically for the saved report; this is not a no-data result.`} };
}
async function processReportJobs(build, store = db, now = Date.now) {
  const candidates = await store.jobs();
  for (const job of candidates) {
    if (job.status === "complete" || job.status === "failed" || job.dueAt > now() || job.leaseUntil > now()) continue;
    const claimed = {...job, status:"running", leaseUntil:now()+15*60000};
    if (!await store.replace(claimed, job.etag)) continue;
    try {
      const report = await build({query:new URLSearchParams(JSON.parse(job.query))});
      await store.write(job.key, report);
      const values = JSON.parse(job.query);
      if (values.stopTime && Math.abs(now()-Date.parse(values.stopTime)) < 3600000) await store.write(liveKey(values), report);
      const latest = await store.get("JOB", job.rowKey);
      await store.replace({...latest,status:"complete",leaseUntil:0,completedAt:now()},latest.etag);
      return {completed:1};
    } catch(error) {
      const latest = await store.get("JOB", job.rowKey), attempts = (job.attempts || 0) + 1;
      const delay = Math.max(error.retryAfterMs || 0, Math.min(3600000, 60000 * 2 ** Math.min(attempts,6)));
      await store.replace({...latest,status:error.statusCode === 400 ? "failed" : "queued",leaseUntil:0,attempts,dueAt:now()+delay,lastStatus:error.statusCode || 500},latest.etag);
      return {completed:0,retryInMs:delay,status:error.statusCode || 500};
    }
  }
  return {completed:0};
}
function persistedHistoryClient(client, store = db) {
  return { async fetchHistoricalVehicleStatuses(options) {
    const start = Date.parse(options.startTime), end = Date.parse(options.stopTime), result = [];
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw Object.assign(new Error("Invalid history interval."), {statusCode:400});
    // Checkpoint each hour so a later 429 does not discard the earlier collection.
    for (let cursor = Math.floor(start/3600000)*3600000; cursor < end;) {
      const stop = Math.min(end, (Math.floor(cursor/3600000)+1)*3600000);
      const from = new Date(cursor).toISOString(), to = new Date(stop).toISOString();
      const key = `history:${client.mode || "rfms"}:${options.vin || "fleet"}:${options.contentFilter || "ACCUMULATED"}:${from}:${to}`;
      let saved = await store.read(key);
      if (!saved && options.vin) {
        const fleetKey = `history:${client.mode || "rfms"}:fleet:${options.contentFilter || "ACCUMULATED"}:${from}:${to}`;
        const fleet = await store.read(fleetKey);
        if (fleet) saved = { ...fleet, value: fleet.value.filter(event => require("./vehicleStatusNormalizer").eventVin(event) === options.vin) };
      }
      const settled = stop < Date.now() - 3600000 && saved && Date.parse(saved.savedAt) > stop + 3600000;
      let events = saved && (settled || Date.now()-Date.parse(saved.savedAt)<300000) ? saved.value : null;
      if (!events) {
        events = await client.fetchHistoricalVehicleStatuses({...options,startTime:from,stopTime:to});
        await store.write(key,events);
      }
      result.push(...events); cursor = stop;
    }
    const { deduplicateEvents, eventReceivedTime, eventCreatedTime } = require("./vehicleStatusNormalizer");
    return deduplicateEvents(result).filter(event => {
      const time = Date.parse(eventReceivedTime(event) || eventCreatedTime(event));
      return time >= start && time <= end;
    });
  }};
}
async function collectRecentHistory(client, store = db, now = Date.now()) {
  const end = Math.floor(now/3600000)*3600000;
  const previous = await store.get("CONTROL", "HISTORY_CURSOR");
  const start = previous?.through || end - 2*3600000;
  if (start >= end) return;
  const stop = Math.min(start+3600000,end);
  await persistedHistoryClient(client,store).fetchHistoricalVehicleStatuses({startTime:new Date(start).toISOString(),stopTime:new Date(stop).toISOString(),contentFilter:"ACCUMULATED"});
  const cursor = {partitionKey:"CONTROL",rowKey:"HISTORY_CURSOR",through:stop};
  if (previous) await store.replace(cursor,previous.etag); else await store.create(cursor);
}
module.exports = { reportQuery, requestReport, processReportJobs, persistedHistoryClient, collectRecentHistory };

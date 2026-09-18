const fleet = require("./fleet.json");
const store = require("./store");
const number = value => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) || Number(value) < 0 ? null : Number(value);
const round = value => value === null ? null : Math.round(value * 100) / 100;
const ratio = (a, b, scale = 1) => a !== null && b > 0 ? round(a / b * scale) : null;
const day = date => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date);
function vehicles() {
  return fleet.map(m => ({ id: `liugong-${m.serialNumber}`, vehicleNumber: m.serialNumber,
    source: "LIUGONG_NBI_LIVE", trackerId: m.serialNumber, trackerProvider: "LiuGong NBI",
    company: "LiuGong", assetCategory: m.productGroup === "Mining Truck" ? "Truck" : "HEMM",
    assetType: m.productGroup === "Mining Truck" ? "Haul Pack" : "Excavator", modelNumber: m.model,
    siteId: m.location === "Sasti" ? "site-wcl-sasti-ocm" : "site-wcl-gauri-pauni",
    siteName: m.location === "Sasti" ? "Sasti OCM" : "Gauri Pauni OCM", contractType: null,
    fuelMeasurementUnit: m.productGroup === "Mining Truck" ? "km/L" : "L/hr",
    status: "unknown", active: true, capacityM3: null, commissioningDate: null,
    fuelTankCapacityLitres: null, standardFuelNorm: null }));
}
function rowsFrom(value) {
  if (!value || typeof value !== "object") return [];
  for (const key of ["rows", "data", "list", "records"]) {
    if (Array.isArray(value[key])) return value[key];
    if (value[key] && typeof value[key] === "object") {
      const rows = rowsFrom(value[key]); if (rows.length) return rows;
    }
  }
  return [];
}
function normalizeDaily(row) {
  const s = row.static || row.statistics || row;
  const date = String(s.dateFormate || row.public?.dateFormate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { date, engineHours: number(s.workingHours), workingHours: number(s.jobHours),
    idleHours: number(s.idleTime ?? s.engineIdleTime), fuelLitres: number(s.oilConsumes) };
}
function summarize(rows) {
  const sum = key => { const values = rows.map(r => r[key]).filter(v => v !== null); return values.length ? round(values.reduce((a,b) => a+b,0)) : null; };
  const engineHours = sum("engineHours"), workingHours = sum("workingHours"), idleHours = sum("idleHours"), fuelLitres = sum("fuelLitres");
  // Rates require matching inputs on every included day.
  const complete = keys => rows.length && rows.every(r => keys.every(k => r[k] !== null));
  return { engineHours, workingHours, idleHours, fuelLitres,
    fuelRate: complete(["fuelLitres", "engineHours"]) ? ratio(fuelLitres, engineHours) : null,
    workPercent: complete(["workingHours", "engineHours"]) ? ratio(workingHours, engineHours, 100) : null,
    idlePercent: complete(["idleHours", "engineHours"]) ? ratio(idleHours, engineHours, 100) : null };
}
let token, expires = 0;
async function post(path, body, authenticated = true) {
  const response = await fetch(`https://ilinkopenapi.liugong.com/service${path}`, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || Number(data.code) !== 200) {
    if (response.status === 401 || Number(data.code) === 401) expires = 0;
    throw new Error(`LiuGong request failed (${response.status}).`);
  }
  return data;
}
async function synchronize(options = {}) {
  const storage = options.store || store, now = options.now || new Date();
  if (!process.env.LIUGONG_ACCESS_KEY || !process.env.LIUGONG_ACCESS_SECRET) return { configured: false };
  if (!token || expires < Date.now()) {
    const auth = await post("/auth/login", { accessKey: process.env.LIUGONG_ACCESS_KEY, accessSecret: process.env.LIUGONG_ACCESS_SECRET }, false);
    token = typeof auth.data === "string" ? auth.data : auth.data?.access_token || auth.data?.token || auth.data?.accessToken || auth.token;
    if (!token) throw new Error("LiuGong authentication returned no token.");
    expires = Date.now() + 11 * 3600000;
    await new Promise(resolve => setTimeout(resolve, 5200));
  }
  const startTime = Date.parse(`${day(new Date(now.getTime()-6*86400000))}T00:00:00+05:30`);
  let updated = 0;
  const failures = [];
  for (const m of fleet) {
    try {
    const data = await post("/open/v2/getDailyData", { deviceList: [m.serialNumber], startTime, endTime: now.getTime() });
    const fresh = rowsFrom(data).map(normalizeDaily).filter(Boolean);
    const prior = await storage.loadSnapshot(m.serialNumber);
    const byDate = new Map((prior?.payload?.rows || []).map(r => [r.date, r]));
    for (const row of fresh) byDate.set(row.date, row);
    const rows = [...byDate.values()].sort((a,b) => a.date.localeCompare(b.date)).slice(-90);
    await storage.saveSnapshot(m.serialNumber, { rows }, { fetchedAt: now.toISOString(), recordCount: rows.length });
    updated++;
    } catch { failures.push(m.serialNumber); }
    await new Promise(resolve => setTimeout(resolve, 5200));
  }
  return { configured: true, updated, failures };
}
async function report(from, to, storage = store) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "") || from > to)
    throw Object.assign(new Error("Valid start and end dates are required."), { statusCode: 400 });
  const snapshots = await Promise.all(fleet.map(m => storage.loadSnapshot(m.serialNumber)));
  return { generatedAt: new Date().toISOString(), vehicles: vehicles(),
    rows: fleet.map((m,i) => { const snapshot = snapshots[i];
      const rows = (snapshot?.payload?.rows || []).filter(r => r.date >= from && r.date <= to);
      return { serialNumber: m.serialNumber, ...summarize(rows), daysReported: rows.length,
        lastSyncAt: snapshot?.fetchedAt || null }; }),
    notice: "LiuGong daily totals only. Today may be incomplete. Missing days are not estimated; distance, km/L and driver data are unavailable. Historical coverage grows as daily data is collected." };
}
module.exports = { fleet, vehicles, normalizeDaily, summarize, synchronize, report, rowsFrom };

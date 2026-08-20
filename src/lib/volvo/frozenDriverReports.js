const FROZEN_SASTI_2026_08_18 = Object.freeze({
  date: "2026-08-18",
  site: "Sasti",
  generatedAt: "2026-08-19T00:00:00+05:30",
  columns: Object.freeze([
    "Vehicles",
    "Drivers",
    "Total time (hh:mm)",
    "Driving (km)",
    "Diesel engine on (l)",
    "Avg diesel engine on (km/l)",
    "Standstill (%)",
    "Standstill (hh:mm)",
    "I-Shift Performance % time of Total time (%)",
    "Above economy % time of Total time (%)",
    "Engine load % time of Total time (%)",
    "Coasting (%)",
    "Avg diesel (l/h)",
  ]),
  summary: Object.freeze({
    "Vehicles": "Summary (9)",
    "Drivers": "9 vehicles",
    "Total time (hh:mm)": "141:48",
    "Driving (km)": 1262.88,
    "Diesel engine on (l)": 2641.64,
    "Avg diesel engine on (km/l)": 0.48,
    "Standstill (%)": 21.30,
    "Standstill (hh:mm)": "30:12",
    "I-Shift Performance % time of Total time (%)": 0.14,
    "Above economy % time of Total time (%)": 14.22,
    "Engine load % time of Total time (%)": 2.39,
    "Coasting (%)": 4.95,
    "Avg diesel (l/h)": 18.63,
  }),
  rows: Object.freeze([
    frozenRow("V-604", "Unknown", "14:42", 138.04, 291.51, 0.47, 13.93, "2:02", 0.01, 8.70, 2.58, 4.85, 19.82),
    frozenRow("V 503", "SURLA SHIVAJI", "14:50", 143.63, 298.90, 0.48, 16.90, "2:30", 0.86, 15.83, 4.32, 6.42, 20.15),
    frozenRow("V-606", "Unknown", "15:17", 136.22, 286.60, 0.48, 21.91, "3:20", 0.06, 15.76, 2.41, 3.60, 18.75),
    frozenRow("V-603", "UMESH KUMAR KACHHI - SOCM", "15:18", 137.53, 287.13, 0.48, 18.67, "2:51", 0.00, 11.23, 1.29, 5.29, 18.76),
    frozenRow("V 502", "Unknown", "15:42", 143.18, 286.57, 0.50, 22.20, "3:29", 0.00, 19.78, 2.30, 5.05, 18.24),
    frozenRow("V 590", "SURESH SAKET - SOCM, VINOD BANNARE - SOCM", "15:44", 143.83, 302.74, 0.48, 19.26, "3:01", 0.00, 17.89, 2.44, 5.74, 19.22),
    frozenRow("V-500", "SRINIVAS JEEDI, NEBBU BAKS", "16:26", 140.88, 299.27, 0.47, 22.54, "3:42", 0.02, 5.75, 1.99, 3.60, 18.20),
    frozenRow("V-501", "Unknown", "16:38", 145.68, 298.62, 0.49, 23.96, "3:59", 0.03, 20.05, 2.19, 5.18, 17.95),
    frozenRow("V-605", "Unknown", "17:08", 133.91, 290.30, 0.46, 30.52, "5:14", 0.33, 12.87, 2.10, 4.90, 16.93),
  ]),
});

function frozenRow(
  vehicle,
  driver,
  totalTime,
  drivingKm,
  dieselEngineOnLitres,
  efficiency,
  standstillPercent,
  standstillTime,
  iShiftPerformancePercent,
  aboveEconomyPercent,
  engineLoadPercent,
  coastingPercent,
  averageDieselLitresPerHour,
) {
  return Object.freeze({
    "Vehicles": vehicle,
    "Drivers": driver,
    "Total time (hh:mm)": totalTime,
    "Driving (km)": drivingKm,
    "Diesel engine on (l)": dieselEngineOnLitres,
    "Avg diesel engine on (km/l)": efficiency,
    "Standstill (%)": standstillPercent,
    "Standstill (hh:mm)": standstillTime,
    "I-Shift Performance % time of Total time (%)": iShiftPerformancePercent,
    "Above economy % time of Total time (%)": aboveEconomyPercent,
    "Engine load % time of Total time (%)": engineLoadPercent,
    "Coasting (%)": coastingPercent,
    "Avg diesel (l/h)": averageDieselLitresPerHour,
  });
}

function isSastiSite(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized.includes("sasti") || normalized.includes("lalpeth");
}

function isFullDayWindow(window, date) {
  if (!window?.customTimeRange) return false;
  const start = new Date(window.shiftStart).getTime();
  const end = new Date(window.shiftEnd).getTime();
  const expectedStart = new Date(`${date}T00:00:00+05:30`).getTime();
  const expectedEnd = new Date(`${date}T23:59:00+05:30`).getTime();
  const nextMidnight = new Date(`${date}T00:00:00+05:30`).getTime() + 24 * 60 * 60_000;
  return start === expectedStart && (end === expectedEnd || end === nextMidnight);
}

function cloneSnapshot(snapshot) {
  return {
    ...snapshot,
    columns: [...snapshot.columns],
    summary: { ...snapshot.summary },
    rows: snapshot.rows.map((row) => ({ ...row })),
  };
}

function findFrozenDriverReport({ date, site, window }) {
  if (
    date === FROZEN_SASTI_2026_08_18.date
    && isSastiSite(site)
    && isFullDayWindow(window, date)
  ) {
    return cloneSnapshot(FROZEN_SASTI_2026_08_18);
  }
  return null;
}

module.exports = {
  findFrozenDriverReport,
};

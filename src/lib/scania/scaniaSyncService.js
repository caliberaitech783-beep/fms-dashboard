const { createScaniaClientFromEnv } = require("./scaniaClient");
const defaultStore = require("./scaniaStateStore");
const { listVehicles: listImportedVehicles } = require("../vehicles/vehicleStore");
const { normalizeKey, prepareImportedVehicle } = require("../vehicles/vehicleMasterIntegration");
const { resolveShift } = require("../tracking/shiftResolver");
const { resolveScaniaSite } = require("./scaniaSiteResolver");

const SOURCE = "SCANIA_RFMS_LIVE";
const CURSOR_RESOURCE = "scania-live-snapshot";
let synchronizationPromise = null;
let cachedSnapshot = null;

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").replace(/\*/g, "").trim();
    if (text) return text;
  }
  return null;
}

function finiteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function normalizeTimestamp(...values) {
  const value = firstText(...values);
  if (!value) return null;
  const zoned = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const date = new Date(zoned);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function vinFrom(value) {
  return firstText(value?.vin, value?.Vin, value?.VIN)?.toUpperCase() || null;
}

function vehicleNumberFrom(value) {
  return firstText(
    value?.vehicleNumber,
    value?.customerVehicleName,
    value?.CustomerVehicleName,
    value?.licensePlate,
    value?.LicensePlate,
  );
}

function statusTimestamp(status) {
  return normalizeTimestamp(
    status?.createdDateTime,
    status?.CreatedDateTime,
    status?.receivedDateTime,
    status?.ReceivedDateTime,
  );
}

function positionTimestamp(position) {
  const tracks = position?.VehicleTrackingPositions || position?.vehicleTrackingPositions;
  const latest = Array.isArray(tracks) ? tracks.at(-1) : tracks;
  const snapshot = position?.snapshotData || position?.SnapshotData || {};
  const gnss = position?.gnssPosition
    || position?.GnssPosition
    || snapshot?.gnssPosition
    || snapshot?.GnssPosition
    || {};
  return normalizeTimestamp(
    latest?.TimePosition,
    latest?.timePosition,
    position?.TimePosition,
    position?.timePosition,
    gnss?.positionDateTime,
    position?.createdDateTime,
    position?.CreatedDateTime,
  );
}

function latestByVin(records, timestampFor) {
  const latest = new Map();
  for (const record of records || []) {
    const vin = vinFrom(record);
    if (!vin) continue;
    const timestamp = timestampFor(record) || "1970-01-01T00:00:00.000Z";
    const existing = latest.get(vin);
    if (!existing || timestamp > existing.timestamp) latest.set(vin, { record, timestamp });
  }
  return latest;
}

function normalizeMaster(vehicle) {
  const vin = vinFrom(vehicle);
  if (!vin) return null;
  return {
    vin,
    vehicleNumber: vehicleNumberFrom(vehicle) || vin,
    brand: firstText(vehicle?.brand, vehicle?.Brand) || "Scania",
    type: firstText(vehicle?.type, vehicle?.Type) || "TRUCK",
    model: firstText(vehicle?.model, vehicle?.Model),
    productionDate: vehicle?.productionDate || vehicle?.ProductionDate || null,
    authorizedPaths: vehicle?.authorizedPaths || vehicle?.AuthorizedPaths || [],
    siteId: vehicle?.siteId || null,
    siteName: vehicle?.siteName || null,
    siteGroup: vehicle?.siteGroup || null,
    contractType: vehicle?.contractType || null,
    siteAssignment: vehicle?.siteAssignment || null,
    raw: vehicle,
  };
}

function assignMasterSite(master, position, existingMaster, env = process.env) {
  if (String(existingMaster?.siteAssignment?.method || "").startsWith("connected-fleet-workbook")) {
    return {
      ...master,
      vehicleNumber: existingMaster.vehicleNumber || master.vehicleNumber,
      siteId: existingMaster.siteId || null,
      siteName: existingMaster.siteName || null,
      siteGroup: existingMaster.siteGroup || null,
      contractType: existingMaster.contractType || null,
      siteAssignment: existingMaster.siteAssignment,
      connectedFleet: existingMaster.connectedFleet || null,
    };
  }
  const resolved = resolveScaniaSite(position, env);
  if (resolved) {
    return {
      ...master,
      siteId: resolved.id,
      siteName: resolved.name,
      siteGroup: resolved.group,
      contractType: resolved.contractType,
      siteAssignment: {
        method: resolved.assignedBy,
        distanceKm: resolved.distanceKm,
        assignedAt: position?.recordedAt || new Date().toISOString(),
      },
    };
  }
  if (!existingMaster?.siteId && !existingMaster?.siteName) return master;
  return {
    ...master,
    siteId: existingMaster.siteId || null,
    siteName: existingMaster.siteName || null,
    siteGroup: existingMaster.siteGroup || null,
    contractType: existingMaster.contractType || null,
    siteAssignment: existingMaster.siteAssignment || null,
  };
}

function normalizePosition(position, syncedAt) {
  const vin = vinFrom(position);
  if (!vin) return null;
  const tracks = position?.VehicleTrackingPositions || position?.vehicleTrackingPositions;
  const latest = Array.isArray(tracks) ? tracks.at(-1) : tracks;
  const header = position?.VehiclePositionHeader || position?.vehiclePositionHeader || latest || position;
  const snapshot = position?.snapshotData || position?.SnapshotData || {};
  const gnss = position?.gnssPosition
    || position?.GnssPosition
    || snapshot?.gnssPosition
    || snapshot?.GnssPosition
    || {};
  return {
    vin,
    recordedAt: positionTimestamp(position),
    latitude: finiteNumber(header?.Latitude, header?.latitude, gnss?.latitude),
    longitude: finiteNumber(header?.Longitude, header?.longitude, gnss?.longitude),
    speedKph: finiteNumber(
      header?.Speed,
      header?.speed,
      gnss?.speed,
      position?.wheelBasedSpeed,
      position?.WheelBasedSpeed,
      snapshot?.wheelBasedSpeed,
    ),
    heading: finiteNumber(header?.Heading, header?.heading, gnss?.heading),
    ignition: firstText(header?.Ignition, header?.ignition, snapshot?.ignitionState),
    syncedAt,
    raw: position,
  };
}

function normalizeState(status, syncedAt) {
  const vin = vinFrom(status);
  if (!vin) return null;
  const snapshot = status?.snapshotData || status?.SnapshotData || {};
  const gnss = snapshot?.gnssPosition || snapshot?.GnssPosition || {};
  return {
    vin,
    recordedAt: statusTimestamp(status),
    receivedAt: normalizeTimestamp(status?.receivedDateTime, status?.ReceivedDateTime),
    odometerKm: (() => {
      const metres = finiteNumber(status?.hrTotalVehicleDistance, status?.HrTotalVehicleDistance);
      return metres === null ? null : metres / 1000;
    })(),
    engineHours: finiteNumber(status?.totalEngineHours, status?.TotalEngineHours),
    totalFuelLitres: (() => {
      const millilitres = finiteNumber(status?.engineTotalFuelUsed, status?.EngineTotalFuelUsed);
      return millilitres === null ? null : millilitres / 1000;
    })(),
    speedKph: finiteNumber(gnss?.speed, snapshot?.wheelBasedSpeed, snapshot?.WheelBasedSpeed),
    engineSpeedRpm: finiteNumber(snapshot?.engineSpeed, snapshot?.EngineSpeed),
    fuelLevelPercent: finiteNumber(snapshot?.fuelLevel1, snapshot?.FuelLevel1),
    latitude: finiteNumber(gnss?.latitude),
    longitude: finiteNumber(gnss?.longitude),
    ignition: firstText(snapshot?.ignitionState, snapshot?.IgnitionState),
    syncedAt,
    raw: status,
  };
}

function mergeApiAndImportedMasters(apiMasters, importedVehicles) {
  const importedByVin = new Map();
  const importedByNumber = new Map();
  for (const record of importedVehicles || []) {
    const prepared = prepareImportedVehicle(record);
    if (prepared.vin) importedByVin.set(normalizeKey(prepared.vin), prepared);
    if (prepared.vehicleNumber) importedByNumber.set(normalizeKey(prepared.vehicleNumber), prepared);
  }
  return apiMasters.map((master) => ({
    ...master,
    importedVehicleMaster: importedByVin.get(normalizeKey(master.vin))
      || importedByNumber.get(normalizeKey(master.vehicleNumber))
      || null,
  }));
}

function statusFor(state, position, now) {
  const recordedAt = state?.recordedAt || position?.recordedAt;
  const recorded = recordedAt ? new Date(recordedAt) : null;
  const ageMinutes = recorded && Number.isFinite(recorded.getTime())
    ? Math.max(0, (now.getTime() - recorded.getTime()) / 60_000)
    : null;
  const staleAfter = Number(process.env.SCANIA_STALE_AFTER_MINUTES || 120);
  if (ageMinutes === null || ageMinutes > staleAfter) return { value: "offline", ageMinutes };
  const speed = finiteNumber(position?.speedKph, state?.speedKph);
  const runningThreshold = Number(process.env.SCANIA_RUNNING_SPEED_KPH || 3);
  if (speed !== null && speed > runningThreshold) return { value: "running", ageMinutes };
  const ignition = firstText(position?.ignition, state?.ignition)?.toUpperCase();
  if ((speed !== null && speed >= 0) || state?.engineSpeedRpm > 0 || ignition === "ON") {
    return { value: "idle", ageMinutes };
  }
  return { value: "stopped", ageMinutes };
}

function toPortalSnapshot(input) {
  const now = input.now || new Date();
  const stateByVin = new Map(input.states.map((state) => [state.vin, state]));
  const positionByVin = new Map(input.positions.map((position) => [position.vin, position]));
  const mergedMasters = mergeApiAndImportedMasters(input.masters, input.importedVehicles);
  const knownVins = new Set(mergedMasters.map((master) => master.vin));
  for (const state of input.states) {
    if (!knownVins.has(state.vin)) {
      const inferredSite = resolveScaniaSite(positionByVin.get(state.vin));
      mergedMasters.push({
        vin: state.vin,
        vehicleNumber: state.vin,
        brand: "Scania",
        type: "TRUCK",
        model: null,
        productionDate: null,
        authorizedPaths: [],
        siteId: inferredSite?.id || null,
        siteName: inferredSite?.name || null,
        siteGroup: inferredSite?.group || null,
        contractType: inferredSite?.contractType || null,
        siteAssignment: inferredSite ? {
          method: inferredSite.assignedBy,
          distanceKm: inferredSite.distanceKm,
        } : null,
        raw: null,
        importedVehicleMaster: null,
      });
    }
  }

  const vehicles = [];
  const telemetry = [];
  for (const master of mergedMasters) {
    const state = stateByVin.get(master.vin) || null;
    const position = positionByVin.get(master.vin) || null;
    const imported = master.importedVehicleMaster;
    const resolvedSite = imported?.siteId || imported?.siteName
      ? {
        id: imported.siteId || null,
        name: imported.siteName || null,
        group: imported.siteGroup || null,
        contractType: imported.contractType || null,
      }
      : {
        id: master.siteId || null,
        name: master.siteName || null,
        group: master.siteGroup || null,
        contractType: master.contractType || null,
      };
    const currentStatus = statusFor(state, position, now);
    const timestamp = state?.recordedAt || position?.recordedAt || input.cursor?.updatedAt || now.toISOString();
    const vehicle = {
      id: `scania-rfms-${master.vin}`,
      vehicleNumber: imported?.vehicleNumber || master.vehicleNumber || master.vin,
      source: SOURCE,
      assetCategory: "Truck",
      assetType: "Truck",
      company: "Scania",
      modelNumber: imported?.vehicleModel || master.model || null,
      capacityM3: null,
      fuelMeasurementUnit: "km/L",
      trackerProvider: "Scania RFMS",
      trackerId: master.vin,
      siteId: resolvedSite.id,
      siteName: resolvedSite.name,
      siteGroup: resolvedSite.group,
      contractType: resolvedSite.contractType,
      status: currentStatus.value,
      commissioningDate: null,
      fuelTankCapacityLitres: null,
      standardFuelNorm: null,
      active: imported ? imported.active : true,
    };
    vehicles.push(vehicle);

    if (!state && !position) continue;
    const distanceKm = state?.odometerKm ?? null;
    const fuelLitres = state?.totalFuelLitres ?? null;
    const efficiency = distanceKm !== null && fuelLitres !== null && fuelLitres > 0
      ? distanceKm / fuelLitres
      : null;
    const shift = resolveShift(vehicle.siteName, timestamp);
    telemetry.push({
      id: `scania-live-${master.vin}-${new Date(timestamp).getTime()}`,
      source: SOURCE,
      vehicleId: vehicle.id,
      vehicleNumber: vehicle.vehicleNumber,
      driverId: null,
      driverName: null,
      driverMobile: null,
      trackerId: master.vin,
      timestamp,
      date: timestamp.slice(0, 10),
      shift: shift.shiftName || "UNKNOWN",
      siteId: vehicle.siteId,
      siteName: vehicle.siteName,
      assetCategory: vehicle.assetCategory,
      assetType: vehicle.assetType,
      company: vehicle.company,
      modelNumber: vehicle.modelNumber,
      location: Number.isFinite(position?.latitude) && Number.isFinite(position?.longitude)
        ? `${position.latitude}, ${position.longitude}`
        : Number.isFinite(state?.latitude) && Number.isFinite(state?.longitude)
          ? `${state.latitude}, ${state.longitude}`
          : null,
      odometerKm: distanceKm,
      distanceKm,
      engineHours: state?.engineHours ?? null,
      runningHours: state?.engineHours ?? null,
      idleHours: null,
      stoppedHours: null,
      offlineHours: currentStatus.value === "offline" && currentStatus.ageMinutes !== null
        ? currentStatus.ageMinutes / 60
        : 0,
      availableHours: state?.engineHours ?? null,
      fuelConsumedLitres: fuelLitres,
      fuelFilledLitres: null,
      fuelLevelLitres: null,
      fuelLevelPercent: state?.fuelLevelPercent ?? null,
      trips: null,
      capacityM3: null,
      productionM3: null,
      leadKm: null,
      status: currentStatus.value,
      truckEfficiencyKmPerLitre: efficiency,
      hemmFuelRateLitrePerHour: null,
      fuelPerTrip: null,
      fuelPerM3: null,
      idlePercentage: null,
      runningPercentage: null,
      utilizationPercentage: null,
      rawMetrics: {
        vin: master.vin,
        speedKph: finiteNumber(position?.speedKph, state?.speedKph),
        engineSpeedRpm: state?.engineSpeedRpm ?? null,
        ignition: position?.ignition || state?.ignition || null,
        latitude: position?.latitude ?? state?.latitude ?? null,
        longitude: position?.longitude ?? state?.longitude ?? null,
        dataAgeMinutes: currentStatus.ageMinutes,
        scaniaVehicle: master.raw,
        scaniaStatus: state?.raw || null,
        scaniaPosition: position?.raw || null,
      },
    });
  }

  const lastSyncAt = input.cursor?.updatedAt || null;
  return {
    source: SOURCE,
    fetchedAt: now.toISOString(),
    vehicles,
    telemetry,
    summary: vehicles.reduce((summary, vehicle) => {
      summary.total += 1;
      summary[vehicle.status] = (summary[vehicle.status] || 0) + 1;
      return summary;
    }, { total: 0, running: 0, idle: 0, stopped: 0, offline: 0, unknown: 0 }),
    integration: {
      id: "live-integration-scania",
      company: "Scania",
      sourceType: "API",
      status: lastSyncAt && vehicles.length ? "connected" : "delayed",
      lastSyncAt,
      nextSyncAt: lastSyncAt
        ? new Date(new Date(lastSyncAt).getTime() + Number(process.env.SCANIA_SYNC_INTERVAL_MS || 300_000)).toISOString()
        : null,
      recordsSyncedToday: telemetry.length,
      errorMessage: lastSyncAt ? undefined : "Awaiting the first successful Scania synchronization.",
    },
    storage: {
      tableNames: input.tableNames,
      persistedVehicleCount: input.masters.length,
      persistedStateCount: input.states.length,
      persistedPositionCount: input.positions.length,
    },
  };
}

async function runSynchronization(options = {}) {
  const store = options.store || defaultStore;
  const client = options.client || createScaniaClientFromEnv();
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const syncedAt = now.toISOString();
  const [previousCursor, persistedMasters] = await Promise.all([
    store.getCursor(CURSOR_RESOURCE),
    store.loadMasterRecords(),
  ]);
  const [vehicleResult, statusResult, positionResult] = await Promise.allSettled([
    client.getVehicles(),
    client.getVehicleStatuses(),
    client.getLatestPositions(),
  ]);
  if (statusResult.status === "rejected") throw statusResult.reason;

  const states = [...latestByVin(statusResult.value.records, statusTimestamp).values()]
    .map(({ record }) => normalizeState(record, syncedAt))
    .filter(Boolean);
  const positions = positionResult.status === "fulfilled"
    ? [...latestByVin(positionResult.value.records, positionTimestamp).values()]
      .map(({ record }) => normalizePosition(record, syncedAt))
      .filter(Boolean)
    : [];
  const positionByVin = new Map(positions.map((position) => [position.vin, position]));
  const persistedByVin = new Map(persistedMasters.map((master) => [master.vin, master]));
  const masters = vehicleResult.status === "fulfilled"
    ? vehicleResult.value.records
      .map(normalizeMaster)
      .filter(Boolean)
      .map((master) => assignMasterSite(
        master,
        positionByVin.get(master.vin),
        persistedByVin.get(master.vin),
        options.env || process.env,
      ))
    : [];

  const [masterSave, stateSave, positionSave] = await Promise.all([
    masters.length ? store.saveMasterRecords(masters) : Promise.resolve({ saved: 0 }),
    store.saveStateRecords(states),
    positions.length ? store.savePositionRecords(positions) : Promise.resolve({ saved: 0 }),
  ]);
  const cursor = await store.saveCursor(CURSOR_RESOURCE, {
    cursorTime: syncedAt,
    vehicleCount: masters.length,
    stateCount: states.length,
    positionCount: positions.length,
    vehiclesAvailable: vehicleResult.status === "fulfilled",
    positionsAvailable: positionResult.status === "fulfilled",
  });
  cachedSnapshot = null;
  return {
    mode: previousCursor ? "incremental" : "bootstrap",
    masterCount: masterSave.saved,
    stateCount: stateSave.saved,
    positionCount: positionSave.saved,
    cursorTime: cursor.cursorTime,
    tableNames: store.tableNames,
  };
}

async function synchronizeScania(options = {}) {
  if (synchronizationPromise) return synchronizationPromise;
  synchronizationPromise = runSynchronization(options);
  try {
    return await synchronizationPromise;
  } finally {
    synchronizationPromise = null;
  }
}

async function getLiveScaniaSnapshot(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const cacheMs = Number(process.env.SCANIA_CACHE_SECONDS || 60) * 1000;
  if (!options.force && cachedSnapshot && Date.now() - cachedSnapshot.cachedAt < cacheMs) {
    return cachedSnapshot.value;
  }
  const store = options.store || defaultStore;
  let [masters, states, positions, cursor, importedVehicles] = await Promise.all([
    store.loadMasterRecords(),
    store.loadStateRecords(),
    store.loadPositionRecords(),
    store.getCursor(CURSOR_RESOURCE),
    options.importedVehicles || listImportedVehicles(),
  ]);
  if (!states.length && options.allowBootstrap !== false) {
    await synchronizeScania({ ...options, store, now });
    [masters, states, positions, cursor] = await Promise.all([
      store.loadMasterRecords(),
      store.loadStateRecords(),
      store.loadPositionRecords(),
      store.getCursor(CURSOR_RESOURCE),
    ]);
  }
  const value = toPortalSnapshot({
    now,
    masters,
    states,
    positions,
    cursor,
    importedVehicles,
    tableNames: store.tableNames,
  });
  cachedSnapshot = { cachedAt: Date.now(), value };
  return value;
}

function clearScaniaLiveCache() {
  cachedSnapshot = null;
}

module.exports = {
  CURSOR_RESOURCE,
  clearScaniaLiveCache,
  getLiveScaniaSnapshot,
  latestByVin,
  mergeApiAndImportedMasters,
  assignMasterSite,
  normalizeMaster,
  normalizePosition,
  normalizeState,
  runSynchronization,
  statusFor,
  synchronizeScania,
  toPortalSnapshot,
};

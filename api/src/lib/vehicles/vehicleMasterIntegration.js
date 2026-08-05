const SITE_DEFINITIONS = [
  { id: "site-wcl-sasti-ocm", name: "Sasti OCM", group: "WCL", contractType: "Coal", matches: ["sasti"] },
  { id: "site-wcl-dhoptala-ocm", name: "Dhoptala OCM", group: "WCL", contractType: "Coal", matches: ["dhoptala"] },
  { id: "site-wcl-lalpeth-ocm", name: "Lalpeth OCM", group: "WCL", contractType: "Coal", matches: ["lalpeth"] },
  { id: "site-wcl-majri-ocm", name: "Majri OCM", group: "WCL", contractType: "Coal", matches: ["majri"] },
  { id: "site-wcl-gauri-pauni", name: "Gauri Pauni OCM", group: "WCL", contractType: "Coal", matches: ["gouri", "gauri"] },
  { id: "site-ncl-dch-west", name: "DCH West", group: "NCL", contractType: "OB", matches: ["dudhichua west", "dudhichua singrauli", "dch west"] },
  { id: "site-ncl-dch-east", name: "DCH East", group: "NCL", contractType: "OB", matches: ["dudhichua east", "dch east"] },
];

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeVehicleIdentifier(value) {
  return normalizeKey(value).replace(/\s+/g, "");
}

function resolveImportedSite(rawSiteName) {
  const normalized = normalizeKey(rawSiteName);
  if (!normalized || normalized === "-") return null;
  // The 29 legacy workbook rows labelled exactly "Jayant 2" are part of the
  // DCH East Volvo fleet. The operational Jayant 2 fleet is represented by
  // the separate "Jayant, Jayant East" rows.
  if (normalized === "jayant 2") {
    return { id: "site-ncl-dch-east", name: "DCH East", group: "NCL", contractType: "OB" };
  }
  if (normalized.includes("jayant east")) {
    return { id: "site-ncl-jayant-2", name: "Jayant 2", group: "NCL", contractType: "Coal" };
  }
  if (normalized.includes("jayant")) {
    return { id: "site-ncl-jayant-1", name: "Jayant 1", group: "NCL", contractType: "Coal" };
  }
  return SITE_DEFINITIONS.find((site) => site.matches.some((match) => normalized.includes(match))) || null;
}

function prepareImportedVehicle(record) {
  const site = resolveImportedSite(record.rawSiteName);
  return {
    ...record,
    vin: String(record.vin || "").trim().toUpperCase(),
    vehicleNumber: String(record.vehicleNumber || "").trim(),
    vehicleModel: String(record.vehicleModel || "").trim(),
    rawSiteName: String(record.rawSiteName || "").trim(),
    serviceStatus: String(record.serviceStatus || "").trim(),
    siteId: site?.id || null,
    siteName: site?.name || null,
    siteGroup: site?.group || null,
    contractType: site?.contractType || null,
    active: normalizeKey(record.serviceStatus) === "active",
  };
}

function importedSiteAssignment(vehicle) {
  const imported = vehicle?.importedVehicleMaster;
  if (!imported?.siteId || !imported?.siteName) return null;
  return {
    siteId: imported.siteId,
    siteName: imported.siteName,
    contractType: imported.contractType || null,
  };
}

function isImportedVehicleInPortalScope(vehicle) {
  const imported = vehicle?.importedVehicleMaster;
  if (!imported) return true;

  // Fail closed if a legacy Jayant 2 row reaches the portal without the DCH
  // East reassignment above. This prevents it from inflating Jayant 2 again.
  return normalizeKey(imported.rawSiteName) !== "jayant 2"
    || imported.siteId === "site-ncl-dch-east";
}

function mergeVolvoVehicleMasters(apiVehicles, importedVehicles, options = {}) {
  const appendUnmatchedImported = options.appendUnmatchedImported !== false;
  const importedByVin = new Map();
  const importedByNumber = new Map();
  for (const record of importedVehicles) {
    const prepared = prepareImportedVehicle(record);
    importedByVin.set(normalizeKey(prepared.vin), prepared);
    importedByNumber.set(normalizeVehicleIdentifier(prepared.vehicleNumber), prepared);
  }

  const matchedImportedVins = new Set();
  const merged = apiVehicles.map((vehicle) => {
    const vin = String(vehicle?.vin || vehicle?.VIN || "").trim();
    const vehicleNumber = String(vehicle?.customerVehicleName || vehicle?.CustomerVehicleName || "").trim();
    const imported = importedByVin.get(normalizeKey(vin))
      || importedByNumber.get(normalizeVehicleIdentifier(vehicleNumber));
    if (!imported) return vehicle;
    matchedImportedVins.add(normalizeKey(imported.vin));
    return {
      ...vehicle,
      vin: imported.vin,
      VIN: imported.vin,
      customerVehicleName: imported.vehicleNumber,
      CustomerVehicleName: imported.vehicleNumber,
      model: imported.vehicleModel,
      Model: imported.vehicleModel,
      type: "TRUCK",
      Type: "TRUCK",
      brand: "VOLVO TRUCKS",
      Brand: "VOLVO TRUCKS",
      importedVehicleMaster: imported,
    };
  });

  if (appendUnmatchedImported) {
    for (const imported of importedByVin.values()) {
      if (matchedImportedVins.has(normalizeKey(imported.vin))) continue;
      merged.push({
        vin: imported.vin,
        VIN: imported.vin,
        customerVehicleName: imported.vehicleNumber,
        CustomerVehicleName: imported.vehicleNumber,
        model: imported.vehicleModel,
        Model: imported.vehicleModel,
        type: "TRUCK",
        Type: "TRUCK",
        brand: "VOLVO TRUCKS",
        Brand: "VOLVO TRUCKS",
        importedVehicleMaster: imported,
      });
    }
  }
  return merged;
}

function makeNoDataLiveVehicle(vehicle) {
  const noDataTimestamp = "1970-01-01T00:00:00.000Z";
  return {
    vin: vehicle.trackerId,
    displayVin: null,
    eventType: "NO_LIVE_DATA",
    eventContext: null,
    eventTime: noDataTimestamp,
    receivedTime: noDataTimestamp,
    odometerKm: null,
    engineHours: null,
    totalFuelLitres: null,
    grossWeightKg: null,
    driverId: null,
    maskedDriverId: null,
    ignitionState: "UNKNOWN",
    movementState: "UNKNOWN",
    speedKph: null,
    fuelPercent: null,
    adBluePercent: null,
    ambientTemperatureC: null,
    latitude: null,
    longitude: null,
    heading: null,
    altitudeMetres: null,
    positionTime: null,
    lifetimeStandstillSeconds: null,
    lifetimeStandstillFuelLitres: null,
    lifetimeRunningSeconds: null,
    lifetimeRunningFuelLitres: null,
    currentStandstillStartedAt: null,
    currentStandstillSeconds: null,
    dataAgeSeconds: null,
    locationAgeSeconds: null,
    isStale: true,
    freshness: { state: "no-data", ageMinutes: null },
    eventHistory: [],
  };
}

module.exports = {
  importedSiteAssignment,
  isImportedVehicleInPortalScope,
  makeNoDataLiveVehicle,
  mergeVolvoVehicleMasters,
  normalizeKey,
  normalizeVehicleIdentifier,
  prepareImportedVehicle,
  resolveImportedSite,
};

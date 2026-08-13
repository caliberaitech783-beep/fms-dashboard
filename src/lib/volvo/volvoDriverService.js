const { createVolvoDriverClientFromEnv } = require("./volvoDriverClient");

let cachedDirectory = null;
let pendingDirectory = null;

function normalizedIdentifier(value) {
  return String(value || "").trim().toUpperCase();
}

function textValue(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function driverNameOnly(value) {
  const normalized = textValue(value);
  if (!normalized) return null;
  return textValue(normalized.replace(/^\d+\s+/, ""));
}

function driverIdentifierTypes(client, options = {}) {
  const configured = options.driverIdTypes
    || process.env.VOLVO_DRIVER_ID_TYPES
    || client?.driverIdType
    || process.env.VOLVO_DRIVER_ID_TYPE
    || "pin";
  const values = Array.isArray(configured) ? configured : String(configured).split(",");
  const byKey = new Map();
  for (const value of ["pin", ...values]) {
    const type = String(value || "").trim();
    if (type) byKey.set(type.toLowerCase(), type);
  }
  return [...byKey.values()];
}

function driverIdentifiers(driver) {
  const identifications = driver?.oemDriverIdentifications
    || driver?.OemDriverIdentifications
    || driver?.driverIdentifications
    || driver?.DriverIdentifications
    || [];
  const values = [];
  const collect = (value) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (typeof value !== "object") {
      const identifier = normalizedIdentifier(value);
      if (identifier) values.push(identifier);
      return;
    }
    const fields = [
      value.oemDriverIdentification,
      value.OemDriverIdentification,
      value.tachoDriverIdentification,
      value.TachoDriverIdentification,
      value.driverIdentification,
      value.DriverIdentification,
      value.driverId,
      value.DriverId,
      value.value,
      value.Value,
    ].filter((candidate) => candidate !== undefined && candidate !== null && candidate !== value);
    fields.forEach(collect);
  };
  collect(identifications);
  collect(driver?.driverId || driver?.DriverId);
  return [...new Set(values)];
}

function driverTimeIdentifier(driverTime) {
  const driverId = driverTime?.driverId || driverTime?.DriverId || {};
  const oem = driverId.oemDriverIdentification || driverId.OemDriverIdentification || {};
  return normalizedIdentifier(oem.oemDriverIdentification || oem.OemDriverIdentification);
}

function driverDisplayName(driver) {
  const nested = driver?.name || driver?.Name || driver?.driverName || driver?.DriverName
    || driver?.person || driver?.Person || {};
  const fullName = typeof nested === "string"
    ? nested
    : driver?.displayName || driver?.DisplayName || driver?.fullName || driver?.FullName
      || nested?.displayName || nested?.DisplayName || nested?.fullName || nested?.FullName;
  const composed = [
    driver?.firstName || driver?.FirstName || driver?.givenName || driver?.GivenName
      || nested?.firstName || nested?.FirstName || nested?.givenName || nested?.GivenName,
    driver?.lastName || driver?.LastName || driver?.familyName || driver?.FamilyName
      || nested?.lastName || nested?.LastName || nested?.familyName || nested?.FamilyName,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
  return driverNameOnly(composed || fullName);
}

function driverPhone(driver) {
  const contact = driver?.contactInfo || driver?.ContactInfo || {};
  return textValue(contact.phone || contact.Phone);
}

function driverTimeDetails(driverTime) {
  if (!driverTime) return null;
  const activities = driverTime.activities || driverTime.Activities || [];
  const dtjActivities = driverTime.dtjActivities || driverTime.DtjActivities || [];
  return {
    activityCount: Array.isArray(activities) ? activities.length : 0,
    dtjActivityCount: Array.isArray(dtjActivities) ? dtjActivities.length : 0,
  };
}

function buildDriverDirectory(driverPage, driverTimePage, fetchedAt = new Date().toISOString()) {
  const timesById = new Map();
  for (const driverTime of driverTimePage?.driverTimes || []) {
    const identifier = driverTimeIdentifier(driverTime);
    if (identifier) timesById.set(identifier, driverTime);
  }

  const byId = new Map();
  for (const driver of driverPage?.drivers || []) {
    const identifiers = driverIdentifiers(driver);
    if (!identifiers.length) continue;
    const details = {
      name: driverDisplayName(driver),
      phone: driverPhone(driver),
      identifiers,
      driverTime: null,
    };
    for (const identifier of identifiers) {
      details.driverTime = details.driverTime || driverTimeDetails(timesById.get(identifier));
      const existing = byId.get(identifier);
      byId.set(identifier, existing ? {
        ...existing,
        ...details,
        name: details.name || existing.name,
        phone: details.phone || existing.phone,
        driverTime: details.driverTime || existing.driverTime,
        identifiers: [...new Set([...existing.identifiers, ...details.identifiers])],
      } : details);
    }
  }

  return {
    byId,
    fetchedAt,
    driverCount: driverPage?.drivers?.length || 0,
    driverTimeCount: driverTimePage?.driverTimes?.length || 0,
    moreDriversAvailable: Boolean(driverPage?.moreDataAvailable),
    moreDriverTimesAvailable: Boolean(driverTimePage?.moreDataAvailable),
    driverTimeServerDateTime: driverTimePage?.requestServerDateTime || null,
  };
}

function emptyDriverDirectory() {
  return buildDriverDirectory({ drivers: [] }, { driverTimes: [] });
}

async function getLiveVolvoDriverDirectory(options = {}) {
  const cacheMilliseconds = Number(process.env.VOLVO_DRIVER_CACHE_MS || 300_000);
  if (!options.force && cachedDirectory && Date.now() - cachedDirectory.cachedAt < cacheMilliseconds) {
    return cachedDirectory.value;
  }
  if (pendingDirectory) return pendingDirectory;

  pendingDirectory = (async () => {
    const client = options.client || createVolvoDriverClientFromEnv();
    const identifierTypes = driverIdentifierTypes(client, options);
    const results = await Promise.allSettled(identifierTypes.map(async (driverIdType) => {
      const driverPage = await client.fetchDrivers({ driverIdType });
      const driverTimePage = await client.fetchLatestDriverTimes({ driverIdType })
        .catch(() => ({ driverTimes: [], moreDataAvailable: false }));
      return { driverPage, driverTimePage };
    }));
    const successful = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    if (!successful.length) {
      throw results.find((result) => result.status === "rejected")?.reason
        || new Error("Volvo driver details are unavailable.");
    }
    const driverPage = {
      drivers: successful.flatMap((result) => result.driverPage.drivers || []),
      moreDataAvailable: successful.some((result) => result.driverPage.moreDataAvailable),
    };
    const driverTimePage = {
      driverTimes: successful.flatMap((result) => result.driverTimePage.driverTimes || []),
      moreDataAvailable: successful.some((result) => result.driverTimePage.moreDataAvailable),
      requestServerDateTime: successful
        .map((result) => result.driverTimePage.requestServerDateTime)
        .filter(Boolean)
        .sort()
        .at(-1) || null,
    };
    const value = buildDriverDirectory(driverPage, driverTimePage);
    cachedDirectory = { cachedAt: Date.now(), value };
    return value;
  })();

  try {
    return await pendingDirectory;
  } catch (error) {
    if (cachedDirectory?.value) return cachedDirectory.value;
    throw error;
  } finally {
    pendingDirectory = null;
  }
}

function clearVolvoDriverCache() {
  cachedDirectory = null;
}

function findDriverDetails(directory, driverId) {
  return directory?.byId?.get(normalizedIdentifier(driverId)) || null;
}

function driverNameMap(directory) {
  return new Map([...(directory?.byId || new Map())]
    .map(([identifier, details]) => [identifier, details?.name])
    .filter((entry) => entry[1]));
}

module.exports = {
  buildDriverDirectory,
  clearVolvoDriverCache,
  driverIdentifierTypes,
  driverIdentifiers,
  driverNameOnly,
  driverNameMap,
  driverTimeIdentifier,
  emptyDriverDirectory,
  findDriverDetails,
  getLiveVolvoDriverDirectory,
  normalizedIdentifier,
};

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

function driverIdentifiers(driver) {
  const identifications = driver?.oemDriverIdentifications
    || driver?.OemDriverIdentifications
    || [];
  return (Array.isArray(identifications) ? identifications : [])
    .map((item) => normalizedIdentifier(
      item?.oemDriverIdentification || item?.OemDriverIdentification,
    ))
    .filter(Boolean);
}

function driverTimeIdentifier(driverTime) {
  const driverId = driverTime?.driverId || driverTime?.DriverId || {};
  const oem = driverId.oemDriverIdentification || driverId.OemDriverIdentification || {};
  return normalizedIdentifier(oem.oemDriverIdentification || oem.OemDriverIdentification);
}

function driverDisplayName(driver) {
  return [driver?.firstName || driver?.FirstName, driver?.lastName || driver?.LastName]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ") || null;
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
      byId.set(identifier, details);
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
    const [driverPage, driverTimePage] = await Promise.all([
      client.fetchDrivers(),
      client.fetchLatestDriverTimes(),
    ]);
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
  driverIdentifiers,
  driverNameMap,
  driverTimeIdentifier,
  emptyDriverDirectory,
  findDriverDetails,
  getLiveVolvoDriverDirectory,
  normalizedIdentifier,
};

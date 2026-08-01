const DEFAULT_SITE_GEOFENCES = [
  {
    id: "site-wcl-sasti-ocm",
    name: "Sasti OCM",
    group: "WCL",
    contractType: "Coal",
    latitude: 19.81227,
    longitude: 79.31612,
    radiusKm: 60,
  },
  {
    id: "site-ncl-dch-west",
    name: "DCH West",
    group: "NCL",
    contractType: "OB",
    latitude: 24.16,
    longitude: 82.67,
    radiusKm: 20,
  },
  {
    id: "site-ncl-dch-east",
    name: "DCH East",
    group: "NCL",
    contractType: "OB",
    latitude: 24.18,
    longitude: 82.69,
    radiusKm: 20,
  },
];

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function configuredGeofences(env = process.env) {
  const value = String(env.SCANIA_SITE_GEOFENCES_JSON || "").trim();
  if (!value) return DEFAULT_SITE_GEOFENCES;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_SITE_GEOFENCES;
    const valid = parsed.filter((site) => (
      site
      && String(site.id || "").trim()
      && String(site.name || "").trim()
      && finiteNumber(site.latitude) !== null
      && finiteNumber(site.longitude) !== null
      && finiteNumber(site.radiusKm) > 0
    ));
    return valid.length ? valid : DEFAULT_SITE_GEOFENCES;
  } catch {
    return DEFAULT_SITE_GEOFENCES;
  }
}

function distanceKm(left, right) {
  const latitude1 = finiteNumber(left?.latitude);
  const longitude1 = finiteNumber(left?.longitude);
  const latitude2 = finiteNumber(right?.latitude);
  const longitude2 = finiteNumber(right?.longitude);
  if ([latitude1, longitude1, latitude2, longitude2].includes(null)) return null;
  const radians = (degrees) => degrees * Math.PI / 180;
  const deltaLatitude = radians(latitude2 - latitude1);
  const deltaLongitude = radians(longitude2 - longitude1);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(latitude1))
      * Math.cos(radians(latitude2))
      * Math.sin(deltaLongitude / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function resolveScaniaSite(position, env = process.env) {
  const latitude = finiteNumber(position?.latitude);
  const longitude = finiteNumber(position?.longitude);
  if (latitude === null || longitude === null) return null;
  const candidates = configuredGeofences(env)
    .map((site) => ({ ...site, distanceKm: distanceKm({ latitude, longitude }, site) }))
    .filter((site) => site.distanceKm !== null && site.distanceKm <= Number(site.radiusKm))
    .sort((left, right) => left.distanceKm - right.distanceKm);
  if (!candidates.length) return null;
  const selected = candidates[0];
  return {
    id: selected.id,
    name: selected.name,
    group: selected.group || null,
    contractType: selected.contractType || null,
    assignedBy: "live-gps-geofence",
    distanceKm: Math.round(selected.distanceKm * 100) / 100,
  };
}

module.exports = {
  DEFAULT_SITE_GEOFENCES,
  configuredGeofences,
  distanceKm,
  resolveScaniaSite,
};

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  FUEL_URL,
  LOCATION_URL,
  TOKEN_URL,
  extractBearerToken,
  getEicherSnapshot,
  normalizeEicherLocationPayload,
  parseTimestamp,
  resetEicherCaches,
} = require("../src/lib/eicher/vecvClient");
const {
  eicherRegistrySummary,
  listEicherVehicleRegistry,
} = require("../src/lib/eicher/eicherVehicleRegistry");

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("tracks 77 mapped and 6 API-pending Eicher VINs from the workbook", () => {
  const registry = listEicherVehicleRegistry();
  const summary = eicherRegistrySummary();

  assert.equal(registry.length, 83);
  assert.equal(summary.total, 83);
  assert.equal(summary.mapped, 77);
  assert.equal(summary.unmapped, 6);
  assert.equal(registry.filter((vehicle) => vehicle.apiEnabled).length, 77);
  assert.equal(registry.filter((vehicle) => vehicle.apiAccessStatus === "API_ACCESS_PENDING").length, 6);
});

test("normalizes VECV location records without assigning a mine site", () => {
  const firstVin = listEicherVehicleRegistry()[0].vin;
  const snapshot = normalizeEicherLocationPayload({
    locationData: [{
      chassisNo: firstVin,
      regNo: "MH34-EICHER-01",
      latitude: "20.123456",
      longitude: "79.654321",
      vehicleSpeed: "18.5",
      vehicleDirection: 92,
      deviceId: "EICHER-DEVICE-01",
      ignition: "ON",
      currentLocation: "Nagpur Outer Ring Road",
      gpsTime: "2026-08-01 12:10:00",
    }],
  }, {
    fetchedAt: "2026-08-01T06:45:00.000Z",
  });

  const vehicle = snapshot.vehicles.find((item) => item.trackerId === firstVin);
  assert.equal(snapshot.source, "EICHER_VECV_LIVE");
  assert.equal(snapshot.vehicles.length, 1);
  assert.equal(snapshot.telemetry.length, 1);
  assert.equal(vehicle.vehicleNumber, "MH34-EICHER-01");
  assert.equal(vehicle.siteId, null);
  assert.equal(vehicle.siteName, null);
  assert.equal(vehicle.status, "running");
  assert.equal(snapshot.telemetry[0].location, "Nagpur Outer Ring Road");
  assert.equal(snapshot.telemetry[0].rawMetrics.latitude, 20.123456);
  assert.equal(snapshot.telemetry[0].rawMetrics.longitude, 79.654321);
  assert.equal(snapshot.telemetry[0].rawMetrics.chassisNumber, firstVin);
  assert.equal(snapshot.telemetry[0].rawMetrics.deviceId, "EICHER-DEVICE-01");
  assert.equal(snapshot.telemetry[0].rawMetrics.vehicleDirection, 92);
  assert.equal(snapshot.meta.fieldsReceived.includes("currentLocation"), true);
  assert.equal(snapshot.meta.fieldsReceived.includes("locationData"), false);
});

test("merges VECV fuel records by chassis and maps cumulative fuel counters", () => {
  const firstVin = listEicherVehicleRegistry()[0].vin;
  const snapshot = normalizeEicherLocationPayload({
    locationData: [{
      chassisNo: firstVin,
      regNo: "MH34-EICHER-01",
      deviceId: "EICHER-DEVICE-01",
      vehicleDirection: 92,
      currentLocation: "Nagpur Outer Ring Road",
      lastUpdated: 20260827120000,
    }],
  }, {
    fetchedAt: "2026-08-27T09:00:00.000Z",
    fuelPayload: {
      fuelData: [{
        chassisNo: firstVin,
        regNo: "",
        latitude: 20.1132,
        longitude: 79.02415,
        fuelType: "Diesel",
        vehicleStatus: "STOPPED",
        lastUpdated: 20260827121841,
        epochTime: 1787813321,
        vehicleSpeed: 0,
        odometer: 242876,
        fuelLevelInPer: 81.6,
        fuelLevelInLtr: 257.04,
        defLevelInLtr: 47.8,
        lifeTimeFuelConsumtion: "195873.0",
        engineOperatingHours: 14876,
      }],
    },
  });

  const [vehicle] = snapshot.vehicles;
  const [telemetry] = snapshot.telemetry;
  assert.equal(vehicle.vehicleNumber, "MH34-EICHER-01");
  assert.equal(vehicle.fuelMeasurementUnit, "km/L");
  assert.equal(telemetry.engineHours, 14876);
  assert.equal(telemetry.fuelConsumedLitres, 195873);
  assert.equal(telemetry.fuelLevelLitres, 257.04);
  assert.equal(telemetry.fuelLevelPercent, 81.6);
  assert.equal(telemetry.truckEfficiencyKmPerLitre, 242876 / 195873);
  assert.equal(telemetry.rawMetrics.defLevelLitres, 47.8);
  assert.equal(telemetry.rawMetrics.sourceLastUpdated, 20260827121841);
  assert.equal(telemetry.rawMetrics.sourceEpochTime, 1787813321);
  assert.equal(telemetry.rawMetrics.speedKph, 0);
  assert.equal(telemetry.rawMetrics.deviceId, "EICHER-DEVICE-01");
  assert.equal(telemetry.rawMetrics.vehicleDirection, 92);
  assert.equal(telemetry.rawMetrics.eventType, "EICHER_FUEL_LOCATION");
  assert.equal(snapshot.meta.locationRawRecordCount, 1);
  assert.equal(snapshot.meta.fuelRawRecordCount, 1);
  assert.equal(snapshot.meta.rawRecordCount, 1);
  assert.equal(snapshot.meta.fieldsReceived.includes("lifeTimeFuelConsumtion"), true);
});

test("does not expose fuel-only vehicles outside the API-enabled Eicher registry", () => {
  const firstVin = listEicherVehicleRegistry()[0].vin;
  const snapshot = normalizeEicherLocationPayload(null, {
    fetchedAt: "2026-08-27T09:00:00.000Z",
    fuelPayload: {
      fuelData: [
        { chassisNo: firstVin, lifeTimeFuelConsumtion: "500.0", lastUpdated: 20260827120000 },
        { chassisNo: "MC2UNLISTED000001", lifeTimeFuelConsumtion: "900.0", lastUpdated: 20260827120000 },
      ],
    },
  });

  assert.equal(snapshot.vehicles.length, 1);
  assert.equal(snapshot.vehicles[0].trackerId, firstVin);
  assert.equal(snapshot.meta.fuelRawRecordCount, 2);
  assert.equal(snapshot.meta.mergedRawRecordCount, 2);
  assert.equal(snapshot.meta.rawRecordCount, 1);
});

test("does not expose registry-only Eicher VINs as live fleet rows", () => {
  const firstVin = listEicherVehicleRegistry()[0].vin;
  const pendingVin = eicherRegistrySummary().unmappedVins[0];
  const snapshot = normalizeEicherLocationPayload({
    data: [{ chassisNo: firstVin, speed: 0, timestamp: "2026-08-01T06:00:00.000Z" }],
  }, {
    fetchedAt: "2026-08-01T06:45:00.000Z",
  });

  assert.equal(snapshot.registry.total, 83);
  assert.equal(snapshot.registry.mapped, 77);
  assert.equal(snapshot.registry.unmapped, 6);
  assert.equal(snapshot.vehicles.length, 1);
  assert.equal(snapshot.vehicles.some((vehicle) => vehicle.trackerId === pendingVin), false);
});

test("parses VECV numeric yyyyMMddHHmmss timestamps as Kolkata local time", () => {
  assert.equal(parseTimestamp(20260801160530), "2026-08-01T10:35:30.000Z");
  assert.equal(parseTimestamp("20260801160530"), "2026-08-01T10:35:30.000Z");
});

test("uses EICHER_API_KEY only on backend token, location, and fuel requests", async () => {
  resetEicherCaches();
  const calls = [];
  const env = { EICHER_API_KEY: "backend-secret-key", EICHER_CACHE_SECONDS: "60" };
  const firstVin = listEicherVehicleRegistry()[0].vin;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === TOKEN_URL) return jsonResponse(200, { accessToken: "opaque-token-12345", expiresIn: 3600 });
    if (url === LOCATION_URL) {
      return jsonResponse(200, {
        data: [{
          chassisNo: firstVin,
          regNo: "EICHER-1",
          lat: 20,
          lng: 79,
          speed: 0,
          ignition: "OFF",
          timestamp: "2026-08-01T06:00:00.000Z",
        }],
      });
    }
    if (url === FUEL_URL) {
      return jsonResponse(200, {
        fuelData: [{
          chassisNo: firstVin,
          odometer: 1000,
          lifeTimeFuelConsumtion: "500.0",
          engineOperatingHours: 100,
          lastUpdated: 20260801160000,
        }],
      });
    }
    throw new Error("Unexpected URL");
  };

  const snapshot = await getEicherSnapshot({ env, fetchImpl, force: true });
  assert.equal(snapshot.telemetry.length, 1);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.headers["API-KEY"], env.EICHER_API_KEY);
  assert.equal(calls[1].options.headers["API-KEY"], env.EICHER_API_KEY);
  assert.equal(calls[1].options.headers.Authorization, "Bearer opaque-token-12345");
  assert.deepEqual(JSON.parse(calls[1].options.body), { clientId: env.EICHER_API_KEY });
  assert.equal(calls[2].options.headers["API-KEY"], env.EICHER_API_KEY);
  assert.equal(calls[2].options.headers.Authorization, "Bearer opaque-token-12345");
  assert.deepEqual(JSON.parse(calls[2].options.body), { clientId: env.EICHER_API_KEY });
  assert.equal(snapshot.telemetry[0].fuelConsumedLitres, 500);

  await getEicherSnapshot({ env, fetchImpl });
  assert.equal(calls.length, 3);
});

test("prefers a generated token over a legacy seeded token when EICHER_API_KEY is configured", async () => {
  resetEicherCaches();
  const calls = [];
  const env = {
    EICHER_API_KEY: "backend-secret-key",
    EICHER_TOKEN: "legacy-location-only-token",
    EICHER_CACHE_SECONDS: "60",
  };
  const firstVin = listEicherVehicleRegistry()[0].vin;
  const fetchImpl = async (url, options) => {
    calls.push({ url, authorization: options.headers.Authorization || null });
    if (url === TOKEN_URL) return jsonResponse(200, { token: "generated-fuel-token", expiresIn: 3600 });
    if (url === LOCATION_URL) {
      return jsonResponse(200, { locationData: [{ chassisNo: firstVin, vehicleSpeed: 0 }] });
    }
    return jsonResponse(200, {
      fuelData: [{
        chassisNo: firstVin,
        lifeTimeFuelConsumtion: "500.0",
        engineOperatingHours: 100,
      }],
    });
  };

  const snapshot = await getEicherSnapshot({ env, fetchImpl, force: true });

  assert.equal(calls.filter((call) => call.url === TOKEN_URL).length, 1);
  assert.equal(calls.find((call) => call.url === LOCATION_URL).authorization, "Bearer generated-fuel-token");
  assert.equal(calls.find((call) => call.url === FUEL_URL).authorization, "Bearer generated-fuel-token");
  assert.equal(snapshot.telemetry[0].fuelConsumedLitres, 500);
});

test("reuses a successful fuel payload while forced refreshes update location", async () => {
  resetEicherCaches();
  const calls = [];
  const env = {
    EICHER_API_KEY: "backend-secret-key",
    EICHER_CACHE_SECONDS: "5",
    EICHER_FUEL_CACHE_SECONDS: "900",
  };
  const firstVin = listEicherVehicleRegistry()[0].vin;
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === TOKEN_URL) return jsonResponse(200, { token: "cached-fuel-token", expiresIn: 3600 });
    if (url === LOCATION_URL) {
      return jsonResponse(200, { locationData: [{ chassisNo: firstVin, vehicleSpeed: 4 }] });
    }
    return jsonResponse(200, {
      fuelData: [{
        chassisNo: firstVin,
        lifeTimeFuelConsumtion: "750.0",
        engineOperatingHours: 125,
      }],
    });
  };

  await getEicherSnapshot({ env, fetchImpl, force: true });
  const refreshed = await getEicherSnapshot({ env, fetchImpl, force: true });

  assert.equal(calls.filter((url) => url === TOKEN_URL).length, 1);
  assert.equal(calls.filter((url) => url === LOCATION_URL).length, 2);
  assert.equal(calls.filter((url) => url === FUEL_URL).length, 1);
  assert.equal(refreshed.telemetry[0].fuelConsumedLitres, 750);
  assert.equal(refreshed.telemetry[0].engineHours, 125);
});

test("honors a cooldown after the VECV fuel endpoint returns 429", async () => {
  resetEicherCaches();
  const calls = [];
  const env = {
    EICHER_API_KEY: "backend-secret-key",
    EICHER_CACHE_SECONDS: "5",
    EICHER_FUEL_RETRY_SECONDS: "300",
  };
  const firstVin = listEicherVehicleRegistry()[0].vin;
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === TOKEN_URL) return jsonResponse(200, { token: "rate-limited-token", expiresIn: 3600 });
    if (url === LOCATION_URL) {
      return jsonResponse(200, { locationData: [{ chassisNo: firstVin, vehicleSpeed: 0 }] });
    }
    return jsonResponse(429, { message: "too many requests" });
  };

  const first = await getEicherSnapshot({ env, fetchImpl, force: true });
  const second = await getEicherSnapshot({ env, fetchImpl, force: true });

  assert.equal(calls.filter((url) => url === LOCATION_URL).length, 2);
  assert.equal(calls.filter((url) => url === FUEL_URL).length, 1);
  assert.equal(first.integration.status, "delayed");
  assert.equal(first.integration.errorMessage, "Eicher API rate limit was reached.");
  assert.equal(second.integration.errorMessage, "Eicher API rate limit was reached.");
});

test("accepts vendor APIKEY alias and seeded Eicher bearer token", async () => {
  resetEicherCaches();
  const calls = [];
  const env = {
    APIKEY: "backend-secret-key",
    EICHER_TOKEN: "seeded-token-12345",
    EICHER_CACHE_SECONDS: "60",
  };
  const firstVin = listEicherVehicleRegistry()[0].vin;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === LOCATION_URL) return jsonResponse(200, {
      locationData: [{
        chassisNo: firstVin,
        regNo: "EICHER-ALIAS-1",
        latitude: 20,
        longitude: 79,
        vehicleSpeed: 9,
        lastUpdated: 20260801160530,
      }],
    });
    assert.equal(url, FUEL_URL);
    return jsonResponse(200, { fuelData: [] });
  };

  const snapshot = await getEicherSnapshot({ env, fetchImpl, force: true });
  assert.equal(snapshot.telemetry.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers["API-KEY"], env.APIKEY);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${env.EICHER_TOKEN}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { clientId: env.APIKEY });
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${env.EICHER_TOKEN}`);
});

test("refreshes the bearer token after a VECV 401 response", async () => {
  resetEicherCaches();
  const calls = [];
  const env = { EICHER_API_KEY: "backend-secret-key", EICHER_CACHE_SECONDS: "5" };
  const firstVin = listEicherVehicleRegistry()[0].vin;
  const fetchImpl = async (url, options) => {
    calls.push({ url, authorization: options.headers.Authorization || null });
    if (url === TOKEN_URL && calls.filter((call) => call.url === TOKEN_URL).length === 1) {
      return jsonResponse(200, { token: "old-token-12345", expiresIn: 3600 });
    }
    if (url === TOKEN_URL) {
      return jsonResponse(200, { token: "new-token-12345", expiresIn: 3600 });
    }
    if (url === LOCATION_URL && calls.filter((call) => call.url === LOCATION_URL).length === 1) {
      return jsonResponse(401, { message: "expired" });
    }
    if (url === LOCATION_URL) {
      return jsonResponse(200, { data: [{ chassisNo: firstVin, speed: 7, timestamp: "2026-08-01T06:00:00.000Z" }] });
    }
    return jsonResponse(200, { fuelData: [] });
  };

  const snapshot = await getEicherSnapshot({ env, fetchImpl, force: true });
  assert.equal(snapshot.telemetry.length, 1);
  assert.equal(
    calls.map((call) => call.url).join("|"),
    `${TOKEN_URL}|${LOCATION_URL}|${FUEL_URL}|${TOKEN_URL}|${LOCATION_URL}|${FUEL_URL}`,
  );
  assert.equal(calls[4].authorization, "Bearer new-token-12345");
  assert.equal(calls[5].authorization, "Bearer new-token-12345");
});

test("keeps mapped fuel data when the location endpoint is temporarily unavailable", async () => {
  resetEicherCaches();
  const env = {
    EICHER_API_KEY: "backend-secret-key",
    EICHER_TOKEN: "seeded-token-12345",
    EICHER_CACHE_SECONDS: "5",
  };
  const firstVin = listEicherVehicleRegistry()[0].vin;
  const fetchImpl = async (url) => {
    if (url === LOCATION_URL) return jsonResponse(503, { message: "temporary" });
    return jsonResponse(200, {
      fuelData: [{
        chassisNo: firstVin,
        odometer: 1000,
        lifeTimeFuelConsumtion: "500.0",
        engineOperatingHours: 100,
        lastUpdated: 20260801160000,
      }],
    });
  };

  const snapshot = await getEicherSnapshot({ env, fetchImpl, force: true });
  assert.equal(snapshot.integration.status, "delayed");
  assert.equal(snapshot.telemetry.length, 1);
  assert.equal(snapshot.telemetry[0].fuelConsumedLitres, 500);
  assert.equal(snapshot.meta.apiErrors.length, 1);
});

test("keeps the last fuel counters when the fuel endpoint fails later", async () => {
  resetEicherCaches();
  const env = {
    EICHER_API_KEY: "backend-secret-key",
    EICHER_TOKEN: "seeded-token-12345",
    EICHER_CACHE_SECONDS: "5",
  };
  const firstVin = listEicherVehicleRegistry()[0].vin;
  const successFetch = async (url) => {
    if (url === LOCATION_URL) {
      return jsonResponse(200, { locationData: [{ chassisNo: firstVin, vehicleSpeed: 4 }] });
    }
    return jsonResponse(200, {
      fuelData: [{
        chassisNo: firstVin,
        odometer: 1000,
        lifeTimeFuelConsumtion: "500.0",
        engineOperatingHours: 100,
      }],
    });
  };
  const fuelFailureFetch = async (url) => {
    if (url === LOCATION_URL) {
      return jsonResponse(200, { locationData: [{ chassisNo: firstVin, vehicleSpeed: 7 }] });
    }
    return jsonResponse(503, { message: "temporary" });
  };

  const first = await getEicherSnapshot({ env, fetchImpl: successFetch, force: true });
  const second = await getEicherSnapshot({
    env,
    fetchImpl: fuelFailureFetch,
    force: true,
    forceFuel: true,
  });

  assert.equal(first.telemetry[0].fuelConsumedLitres, 500);
  assert.equal(second.telemetry[0].fuelConsumedLitres, 500);
  assert.equal(second.integration.status, "delayed");
  assert.equal(second.meta.cacheFallback, true);
});

test("keeps last successful Eicher data when the location API fails later", async () => {
  resetEicherCaches();
  const env = { EICHER_API_KEY: "backend-secret-key", EICHER_CACHE_SECONDS: "5" };
  const firstVin = listEicherVehicleRegistry()[0].vin;
  const successFetch = async (url) => {
    if (url === TOKEN_URL) return jsonResponse(200, { token: "cached-token-12345", expiresIn: 3600 });
    return jsonResponse(200, { data: [{ chassisNo: firstVin, speed: 10, timestamp: "2026-08-01T06:00:00.000Z" }] });
  };
  const failureFetch = async (url) => {
    if (url === TOKEN_URL) return jsonResponse(200, { token: "cached-token-12345", expiresIn: 3600 });
    return jsonResponse(503, { message: "temporary" });
  };

  const first = await getEicherSnapshot({ env, fetchImpl: successFetch, force: true });
  const second = await getEicherSnapshot({ env, fetchImpl: failureFetch, force: true });

  assert.equal(first.telemetry.length, 1);
  assert.equal(second.telemetry.length, 1);
  assert.equal(second.integration.status, "delayed");
  assert.equal(second.meta.apiErrors.length, 1);
});

test("extracts bearer tokens from common VECV response shapes", () => {
  assert.equal(extractBearerToken({ data: { accessToken: "opaque-token-12345" } }), "opaque-token-12345");
  assert.equal(extractBearerToken({ token: "header.payload.signature" }), "header.payload.signature");
  assert.equal(extractBearerToken({ ok: true }), null);
});

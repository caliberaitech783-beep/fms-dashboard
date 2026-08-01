const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  distanceKm,
  resolveScaniaSite,
} = require("../src/lib/scania/scaniaSiteResolver");

test("assigns live Scania GPS clusters to Sasti OCM, DCH West, and DCH East", () => {
  assert.equal(resolveScaniaSite({ latitude: 19.81, longitude: 79.33 }).name, "Sasti OCM");
  assert.equal(resolveScaniaSite({ latitude: 24.16, longitude: 82.67 }).name, "DCH West");
  assert.equal(resolveScaniaSite({ latitude: 24.18, longitude: 82.69 }).name, "DCH East");
  assert.equal(resolveScaniaSite({ latitude: 10, longitude: 10 }), null);
});

test("supports configurable Scania site geofences without code changes", () => {
  const env = {
    SCANIA_SITE_GEOFENCES_JSON: JSON.stringify([{
      id: "site-custom",
      name: "Custom Site",
      latitude: 20,
      longitude: 80,
      radiusKm: 2,
    }]),
  };
  assert.equal(resolveScaniaSite({ latitude: 20.001, longitude: 80.001 }, env).id, "site-custom");
  assert.equal(resolveScaniaSite({ latitude: 21, longitude: 81 }, env), null);
});

test("computes geodesic distance in kilometres", () => {
  const value = distanceKm(
    { latitude: 19.81227, longitude: 79.31612 },
    { latitude: 19.81227, longitude: 79.32612 },
  );
  assert.ok(value > 1 && value < 1.1);
});

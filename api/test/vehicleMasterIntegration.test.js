const assert = require("node:assert/strict");
const test = require("node:test");
const {
  importedSiteAssignment,
  makeNoDataLiveVehicle,
  mergeVolvoVehicleMasters,
  prepareImportedVehicle,
  resolveImportedSite,
} = require("../src/lib/vehicles/vehicleMasterIntegration");

test("maps workbook site labels to existing dashboard site IDs", () => {
  assert.equal(resolveImportedSite("Sasti").id, "site-wcl-sasti-ocm");
  assert.equal(resolveImportedSite("Dhoptala").id, "site-wcl-dhoptala-ocm");
  assert.equal(resolveImportedSite("Majri").id, "site-wcl-majri-ocm");
  assert.equal(resolveImportedSite("Gouri").id, "site-wcl-gauri-pauni");
  assert.equal(resolveImportedSite("Dudhichua West").id, "site-ncl-dch-west");
  assert.equal(resolveImportedSite("Dudhichua East").id, "site-ncl-dch-east");
  assert.equal(resolveImportedSite("Jayant, Jayant West").id, "site-ncl-jayant-1");
  assert.equal(resolveImportedSite("Jayant, Jayant East").id, "site-ncl-jayant-2");
  assert.equal(resolveImportedSite("Jayant 2").id, "site-ncl-jayant-2");
  assert.equal(resolveImportedSite("-"), null);
});

test("merges by VIN without duplicating Volvo API vehicles", () => {
  const imported = prepareImportedVehicle({
    sourceRow: 2,
    vehicleNumber: "421",
    vehicleModel: "Volvo FMXB384R",
    rawSiteName: "Dudhichua West",
    vin: "YV2XBZ0GXS8994175",
    serviceStatus: "Active",
    sourceColumns: {},
  });
  const merged = mergeVolvoVehicleMasters([{
    VIN: "YV2XBZ0GXS8994175",
    CustomerVehicleName: "old-name",
    Model: "old-model",
    Type: "TRUCK",
  }], [imported]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].CustomerVehicleName, "421");
  assert.equal(merged[0].Model, "Volvo FMXB384R");
  assert.deepEqual(importedSiteAssignment(merged[0]), {
    siteId: "site-ncl-dch-west",
    siteName: "DCH West",
    contractType: "OB",
  });
});

test("merges by vehicle number when a VIN changes", () => {
  const imported = prepareImportedVehicle({
    sourceRow: 2,
    vehicleNumber: "V117",
    vehicleModel: "Volvo FMXB384R",
    rawSiteName: "Gouri",
    vin: "NEW-VIN",
    serviceStatus: "Active",
    sourceColumns: {},
  });
  const merged = mergeVolvoVehicleMasters([{
    VIN: "OLD-VIN",
    CustomerVehicleName: "V117",
    Model: "old-model",
    Type: "TRUCK",
  }], [imported]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].VIN, "NEW-VIN");
  assert.equal(merged[0].importedVehicleMaster.siteId, "site-wcl-gauri-pauni");
});

test("merges vehicle numbers with punctuation differences", () => {
  const imported = prepareImportedVehicle({
    sourceRow: 2,
    vehicleNumber: "V117",
    vehicleModel: "Volvo FMXB384R",
    rawSiteName: "Gouri",
    vin: "NEW-VIN",
    serviceStatus: "Active",
    sourceColumns: {},
  });
  const merged = mergeVolvoVehicleMasters([{
    VIN: "OLD-VIN",
    CustomerVehicleName: "V-117",
    Model: "old-model",
    Type: "TRUCK",
  }], [imported]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].VIN, "NEW-VIN");
  assert.equal(merged[0].importedVehicleMaster.siteId, "site-wcl-gauri-pauni");
});

test("keeps the authoritative Volvo fleet count when imported master has extra rows", () => {
  const apiVehicles = Array.from({ length: 40 }, (_, index) => ({
    VIN: `VOLVO-VIN-${index + 1}`,
    CustomerVehicleName: `V-${index + 1}`,
    Model: "Volvo FMXB384R",
    Type: "TRUCK",
  }));
  const importedVehicles = Array.from({ length: 69 }, (_, index) => prepareImportedVehicle({
    sourceRow: index + 2,
    vehicleNumber: `V-${index + 1}`,
    vehicleModel: "Volvo FMXB384R",
    rawSiteName: "Gouri",
    vin: `VOLVO-VIN-${index + 1}`,
    serviceStatus: "Active",
    sourceColumns: {},
  }));

  const merged = mergeVolvoVehicleMasters(apiVehicles, importedVehicles, {
    appendUnmatchedImported: false,
  });

  assert.equal(merged.length, 40);
  assert.equal(merged.every((vehicle) => vehicle.importedVehicleMaster?.siteId === "site-wcl-gauri-pauni"), true);
});

test("creates an offline record for imported vehicles without live Volvo state", () => {
  const vehicle = makeNoDataLiveVehicle({ trackerId: "VIN-1" });
  assert.equal(vehicle.vin, "VIN-1");
  assert.equal(vehicle.eventType, "NO_LIVE_DATA");
  assert.equal(vehicle.movementState, "UNKNOWN");
  assert.equal(vehicle.isStale, true);
  assert.equal(vehicle.freshness.state, "no-data");
});

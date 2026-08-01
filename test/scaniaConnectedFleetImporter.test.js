const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  assignedSite,
  findLiveMaster,
  mergeConnectedFleetMaster,
  workbookRecord,
} = require("../src/lib/scania/scaniaConnectedFleetImporter");
const { assignMasterSite } = require("../src/lib/scania/scaniaSyncService");

function connectedFleetRow(site = "Sasti") {
  return workbookRecord([
    "5727527 S483",
    "5727527",
    "S483",
    "Scania",
    "Truck",
    "Control 10",
    "2025-10-06",
    "2026-10-01",
    "11",
    "FOC",
    site,
  ], 2);
}

test("maps all Scania Connected Fleet columns without dropping workbook data", () => {
  const record = connectedFleetRow();
  assert.equal(Object.keys(record).length, 12);
  assert.equal(record.chassisNumber, "5727527");
  assert.equal(record.registrationNumber, "S483");
  assert.equal(record.workbookSite, "Sasti");
});

test("matches a Connected Fleet chassis suffix to the full live Scania VIN", () => {
  const matched = findLiveMaster(connectedFleetRow(), [{
    vin: "MYKG8X4J005727527",
    vehicleNumber: "OTHER",
  }]);
  assert.equal(matched.vin, "MYKG8X4J005727527");
});

test("uses workbook Sasti and live GPS to split Dudhichua east and west", () => {
  assert.equal(assignedSite(connectedFleetRow("Sasti"), null).name, "Sasti OCM");
  assert.equal(assignedSite(
    connectedFleetRow("Dudhichua"),
    { latitude: 24.16, longitude: 82.67 },
  ).name, "DCH West");
  assert.equal(assignedSite(
    connectedFleetRow("Dudhichua"),
    { latitude: 24.18, longitude: 82.69 },
  ).name, "DCH East");
});

test("preserves workbook site and registration during later live synchronization", () => {
  const imported = mergeConnectedFleetMaster(
    { vin: "VIN-1", vehicleNumber: "API-NAME" },
    connectedFleetRow("Sasti"),
    null,
  );
  const synchronized = assignMasterSite(
    { vin: "VIN-1", vehicleNumber: "API-NAME-NEW" },
    { latitude: 24.18, longitude: 82.69 },
    imported,
  );
  assert.equal(synchronized.vehicleNumber, "S483");
  assert.equal(synchronized.siteName, "Sasti OCM");
  assert.equal(synchronized.connectedFleet.chassisNumber, "5727527");
});

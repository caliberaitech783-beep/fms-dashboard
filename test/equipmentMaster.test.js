const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeEquipment, importedEquipment } = require("../src/lib/vehicles/equipmentMaster");
test("equipment records use normalized serial identity and retain supplied fields", () => {
  const row = normalizeEquipment({ equipment: " HP-01 ", serialNumber: " abc123 ", category: "Truck", location: "Sasti" });
  assert.equal(row.equipment, "HP-01"); assert.equal(row.serialNumber, "ABC123");
  assert.equal(row.roadStatus, "Unknown");
  assert.equal(normalizeEquipment({ ...row, equipment: "HP-02" }).id, row.id);
  assert.equal(importedEquipment({ vin: "abc123", vehicleNumber: "HP-01" }).id, row.id);
});
test("equipment validation rejects missing identifiers and invalid status", () => {
  for (const row of [{ equipment: "HP-01" }, { serialNumber: "ABC" }, { equipment: "HP-01", serialNumber: "ABC", roadStatus: "running" }]) {
    assert.throws(() => normalizeEquipment(row), { statusCode: 400 });
  }
  assert.throws(() => normalizeEquipment({ equipment: "a".repeat(201), serialNumber: "ABC" }), { statusCode: 400 });
});
const { mergeEquipment, syncEquipment } = require('../src/lib/vehicles/equipmentMaster');
test('deleted imported equipment stays removed and explicit save can restore it', () => {
 const imported = [{vin:'ABC',vehicleNumber:'HP-01'}]; const record = importedEquipment(imported[0]);
 assert.deepEqual(mergeEquipment(imported,[{rowKey:record.id,deleted:true}]),[]);
 assert.deepEqual(mergeEquipment(imported,[{rowKey:record.id,recordJson:JSON.stringify(record)}]),[record]);
});
test('sync updates available driver and model only and does not resurrect deleted equipment', () => {
 const source = {vin:'ABC',vehicleNumber:'HP-01',vehicleModel:'New',sourceColumns:{'Driver Name':'Driver A'}};
 const row = {...importedEquipment(source),model:'Old',driver:'Old Driver',location:'Assigned site'};
 const [updated] = syncEquipment([row],[source]);
 assert.equal(updated.model,'New'); assert.equal(updated.driver,'Driver A'); assert.equal(updated.location,'Assigned site');
 assert.deepEqual(syncEquipment([], [source]), []);
 assert.deepEqual(syncEquipment([row],[{...source,vehicleModel:'',sourceColumns:{}}]),[]);
});

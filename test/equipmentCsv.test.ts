import assert from "node:assert/strict";
import test from "node:test";
import { equipmentCsv, parseEquipmentCsv } from "../src/utils/equipmentCsv.ts";
test("equipment CSV preserves quoted fields and rejects incomplete imports", () => {
  const row = { id: "test", equipment: 'HP-01 "Truck"', serialNumber: "VIN123", category: "Truck", model: "DW105A", oem: "LiuGong", location: "Sasti, OCM", roadStatus: "On road" };
  assert.deepEqual(parseEquipmentCsv(equipmentCsv([row])), [{ ...row, id: "" }]);
  assert.throws(() => parseEquipmentCsv("Equipment / Door no,Serial number / VIN\nHP-01,"), /required/);
  assert.throws(() => parseEquipmentCsv('"unclosed'), /unclosed/);
  assert.match(equipmentCsv([{ ...row, equipment: "=SUM(1,2)" }]), /'=SUM/);
});

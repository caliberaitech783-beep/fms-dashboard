import assert from "node:assert/strict";
import test from "node:test";
import { withModelEfficiency } from "../src/utils/modelEfficiency.ts";

const totals = { name: "Model", productionM3: 0, distanceKm: 600, fuelConsumedLitres: 200, runningHours: 8 };
test("truck mileage uses distance divided by fuel, equipment uses fuel divided by hours", () => {
  assert.equal(withModelEfficiency(totals, "Truck").efficiency, 3);
  assert.equal(withModelEfficiency(totals, "Truck").efficiencyUnit, "km/L");
  assert.equal(withModelEfficiency(totals, "HEMM").efficiency, 25);
  assert.equal(withModelEfficiency(totals, "HEMM").efficiencyUnit, "L/hr");
});
test("missing measurements and zero denominators stay unavailable", () => {
  assert.equal(withModelEfficiency({ ...totals, distanceKm: undefined }, "Truck").efficiency, null);
  assert.equal(withModelEfficiency({ ...totals, fuelConsumedLitres: 0 }, "Truck").efficiency, null);
  assert.equal(withModelEfficiency({ ...totals, runningHours: 0 }, "HEMM").efficiency, null);
});

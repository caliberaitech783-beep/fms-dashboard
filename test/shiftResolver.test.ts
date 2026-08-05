import assert from "node:assert/strict";
import test from "node:test";
import { resolveOperationalShift } from "../src/utils/shiftResolver.ts";

function kolkataTime(date: string, time: string) {
  return `${date}T${time}:00+05:30`;
}

test("resolves Sasti-family shift boundaries", () => {
  assert.equal(resolveOperationalShift("WCL / Sasti OCM", kolkataTime("2026-07-31", "04:59")), "C");
  assert.equal(resolveOperationalShift("Dhoptala OCM", kolkataTime("2026-07-31", "05:00")), "A");
  assert.equal(resolveOperationalShift("Gauri Pauni OCM", kolkataTime("2026-07-31", "12:59")), "A");
  assert.equal(resolveOperationalShift("DCH West", kolkataTime("2026-07-31", "13:00")), "B");
  assert.equal(resolveOperationalShift("Dudhichua", kolkataTime("2026-07-31", "20:59")), "B");
  assert.equal(resolveOperationalShift("Lalpeth OCM", kolkataTime("2026-07-31", "21:00")), "C");
});

test("resolves Majri and Jayant shifts with the evening gap", () => {
  assert.equal(resolveOperationalShift("Majri OCM", kolkataTime("2026-07-31", "03:59")), "C");
  assert.equal(resolveOperationalShift("Majri OCM", kolkataTime("2026-07-31", "04:00")), "A");
  assert.equal(resolveOperationalShift("Jayant 1", kolkataTime("2026-07-31", "12:00")), "B");
  assert.equal(resolveOperationalShift("Jayant 2", kolkataTime("2026-07-31", "20:00")), "UNKNOWN");
  assert.equal(resolveOperationalShift("Jayant 2", kolkataTime("2026-07-31", "20:59")), "UNKNOWN");
  assert.equal(resolveOperationalShift("Majri OCM", kolkataTime("2026-07-31", "21:00")), "C");
});

test("returns UNKNOWN for an unsupported site or invalid timestamp", () => {
  assert.equal(resolveOperationalShift("Unknown mine", kolkataTime("2026-07-31", "10:00")), "UNKNOWN");
  assert.equal(resolveOperationalShift("Sasti OCM", "invalid"), "UNKNOWN");
});

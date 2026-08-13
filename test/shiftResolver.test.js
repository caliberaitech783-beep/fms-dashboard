const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  getReportWindow,
  getShiftWindow,
  resolveShift,
  TIME_ZONE,
} = require("../src/lib/tracking/shiftResolver");

function expectShift(site, timestamp, expected) {
  const actual = resolveShift(site, timestamp);
  assert.equal(actual.timezone, TIME_ZONE);
  assert.equal(actual.active, expected.active);
  assert.equal(actual.shiftName, expected.shiftName);
  assert.equal(actual.shiftDate, expected.shiftDate);
  if (expected.shiftStart) assert.equal(actual.shiftStart, expected.shiftStart);
  if (expected.shiftEnd) assert.equal(actual.shiftEnd, expected.shiftEnd);
}

test("resolves Sasti shift boundaries in Asia/Kolkata", () => {
  expectShift(" sAsTi ", "2026-07-10T04:59:00+05:30", {
    active: true,
    shiftName: "C",
    shiftDate: "2026-07-09",
    shiftStart: "2026-07-09T21:00:00+05:30",
    shiftEnd: "2026-07-10T05:00:00+05:30",
  });
  expectShift("Sasti", "2026-07-10T05:00:00+05:30", {
    active: true,
    shiftName: "A",
    shiftDate: "2026-07-10",
  });
  expectShift("Sasti", "2026-07-10T12:59:00+05:30", {
    active: true,
    shiftName: "A",
    shiftDate: "2026-07-10",
  });
  expectShift("Sasti", "2026-07-10T13:00:00+05:30", {
    active: true,
    shiftName: "B",
    shiftDate: "2026-07-10",
  });
  expectShift("Sasti", "2026-07-10T20:59:00+05:30", {
    active: true,
    shiftName: "B",
    shiftDate: "2026-07-10",
  });
  expectShift("Sasti", "2026-07-10T21:00:00+05:30", {
    active: true,
    shiftName: "C",
    shiftDate: "2026-07-10",
    shiftStart: "2026-07-10T21:00:00+05:30",
    shiftEnd: "2026-07-11T05:00:00+05:30",
  });
  expectShift("Sasti", "2026-07-11T04:59:00+05:30", {
    active: true,
    shiftName: "C",
    shiftDate: "2026-07-10",
  });
  expectShift("Sasti", "2026-07-11T05:00:00+05:30", {
    active: true,
    shiftName: "A",
    shiftDate: "2026-07-11",
  });
});

test("resolves Majri shift boundaries and inactive gap", () => {
  expectShift("Majri", "2026-07-10T03:59:00+05:30", {
    active: true,
    shiftName: "C",
    shiftDate: "2026-07-09",
    shiftStart: "2026-07-09T21:00:00+05:30",
    shiftEnd: "2026-07-10T04:00:00+05:30",
  });
  expectShift("Majri", "2026-07-10T04:00:00+05:30", {
    active: true,
    shiftName: "A",
    shiftDate: "2026-07-10",
  });
  expectShift("Majri", "2026-07-10T11:59:00+05:30", {
    active: true,
    shiftName: "A",
    shiftDate: "2026-07-10",
  });
  expectShift("Majri", "2026-07-10T12:00:00+05:30", {
    active: true,
    shiftName: "B",
    shiftDate: "2026-07-10",
  });
  expectShift("Majri", "2026-07-10T19:59:00+05:30", {
    active: true,
    shiftName: "B",
    shiftDate: "2026-07-10",
  });
  expectShift("Majri", "2026-07-10T20:00:00+05:30", {
    active: false,
    shiftName: null,
    shiftDate: null,
  });
  expectShift("Majri", "2026-07-10T20:59:00+05:30", {
    active: false,
    shiftName: null,
    shiftDate: null,
  });
  expectShift("Majri", "2026-07-10T21:00:00+05:30", {
    active: true,
    shiftName: "C",
    shiftDate: "2026-07-10",
  });
});

test("builds explicit shift windows for portal site labels", () => {
  assert.deepEqual(getShiftWindow("Gauri Pauni OCM", "2026-07-14", "A"), {
    active: true,
    siteGroup: "Sasti/Dhoptala/Dudhichua/Gauri",
    shiftName: "A",
    shiftDate: "2026-07-14",
    shiftStart: "2026-07-14T05:00:00+05:30",
    shiftEnd: "2026-07-14T13:00:00+05:30",
    timezone: TIME_ZONE,
  });
  assert.equal(getShiftWindow("Jayant 2", "2026-07-14", "C").shiftEnd, "2026-07-15T04:00:00+05:30");
});

test("recognizes DCH East portal labels and site identifiers", () => {
  for (const site of ["DCH East", "NCL / DCH East", "site-ncl-dch-east"]) {
    const window = getShiftWindow(site, "2026-08-13", "A");
    assert.equal(window.active, true);
    assert.equal(window.shiftStart, "2026-08-13T05:00:00+05:30");
    assert.equal(window.shiftEnd, "2026-08-13T13:00:00+05:30");
  }
});

test("uses the requested DCH East time period when it is inside Shift A", () => {
  const window = getReportWindow(
    "site-ncl-dch-east",
    "2026-08-13",
    "A",
    "2026-08-13T05:10:00+05:30",
    "2026-08-13T10:30:00+05:30",
  );

  assert.equal(window.active, true);
  assert.equal(window.customTimeRange, true);
  assert.equal(window.shiftStart, "2026-08-12T23:40:00.000Z");
  assert.equal(window.shiftEnd, "2026-08-13T05:00:00.000Z");
});

test("rejects a custom report period outside the selected shift", () => {
  const window = getReportWindow(
    "DCH East",
    "2026-08-13",
    "A",
    "2026-08-13T04:30:00+05:30",
    "2026-08-13T10:30:00+05:30",
  );

  assert.equal(window.active, false);
  assert.equal(window.validationError, "The custom report period must fall within the selected shift.");
});

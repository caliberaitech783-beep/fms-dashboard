const assert = require("node:assert/strict");
const test = require("node:test");
const {
  VolvoDriverClient,
  parseDriverPage,
  parseDriverTimePage,
} = require("../src/lib/volvo/volvoDriverClient");
const {
  buildDriverDirectory,
  findDriverDetails,
} = require("../src/lib/volvo/volvoDriverService");

function response(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    text: async () => JSON.stringify(payload),
  };
}

const driverPayload = {
  driverResponse: {
    drivers: [{
      firstName: "Live",
      lastName: "Driver",
      contactInfo: { phone: "9000000000" },
      oemDriverIdentifications: [
        { idType: "pin", oemDriverIdentification: "driver-01" },
        { idType: "USB", oemDriverIdentification: "usb-01" },
      ],
    }],
  },
  moreDataAvailable: true,
};

const driverTimePayload = {
  driverTimeResponse: {
    driverTimes: [{
      driverId: {
        oemDriverIdentification: { idType: "pin", oemDriverIdentification: "driver-01" },
      },
      activities: [{ activityType: "DRIVING" }],
      dtjActivities: [],
    }],
  },
  moreDataAvailable: true,
  requestServerDateTime: "2026-07-17T10:00:00Z",
};

test("parses Volvo Group driver and driver-time response envelopes", () => {
  const drivers = parseDriverPage(driverPayload);
  const driverTimes = parseDriverTimePage(driverTimePayload);
  assert.equal(drivers.drivers.length, 1);
  assert.equal(drivers.moreDataAvailable, true);
  assert.equal(driverTimes.driverTimes.length, 1);
  assert.equal(driverTimes.moreDataAvailable, true);
  assert.equal(driverTimes.requestServerDateTime, "2026-07-17T10:00:00Z");
});

test("requests both driver endpoints with Basic auth and required media types", async () => {
  const requests = [];
  const client = new VolvoDriverClient({
    driversUrl: "https://api.example.test/driver/drivers",
    driverTimesUrl: "https://api.example.test/driver/drivertimes",
    username: "user",
    password: "secret",
    acceptDrivers: "drivers-v1",
    acceptDriverTimes: "driver-times-v1",
    driverIdType: "Tacho",
    fetchFn: async (url, options) => {
      requests.push({ url: String(url), options });
      return requests.length === 1
        ? response(200, driverPayload)
        : response(200, driverTimePayload);
    },
  });

  await client.fetchDrivers();
  await client.fetchLatestDriverTimes();
  assert.match(requests[0].url, /driverIdType=Tacho/);
  assert.match(requests[1].url, /datetype=received/);
  assert.match(requests[1].url, /latestOnly=true/);
  assert.equal(requests[0].options.headers.Accept, "drivers-v1");
  assert.equal(requests[1].options.headers.Accept, "driver-times-v1");
  assert.equal(requests[0].options.headers.Authorization, "Basic dXNlcjpzZWNyZXQ=");
});

test("joins live names, contacts and driver-time counts by OEM identifier", () => {
  const directory = buildDriverDirectory(
    parseDriverPage(driverPayload),
    parseDriverTimePage(driverTimePayload),
    "2026-07-17T10:05:00Z",
  );
  const byPin = findDriverDetails(directory, "DRIVER-01");
  const byUsb = findDriverDetails(directory, "usb-01");
  assert.equal(byPin.name, "Live Driver");
  assert.equal(byPin.phone, "9000000000");
  assert.equal(byPin.driverTime.activityCount, 1);
  assert.equal(byPin.driverTime.dtjActivityCount, 0);
  assert.equal(byUsb, byPin);
  assert.equal(directory.driverCount, 1);
  assert.equal(directory.driverTimeCount, 1);
});

test("masks Volvo driver credentials from upstream errors", async () => {
  const client = new VolvoDriverClient({
    driversUrl: "https://api.example.test/driver/drivers",
    driverTimesUrl: "https://api.example.test/driver/drivertimes",
    username: "sensitive-user",
    password: "sensitive-password",
    acceptDrivers: "drivers-v1",
    acceptDriverTimes: "driver-times-v1",
    retries: 0,
    fetchFn: async () => {
      throw new Error("request failed for sensitive-user sensitive-password");
    },
  });

  await assert.rejects(client.fetchDrivers(), (error) => {
    assert.doesNotMatch(error.message, /sensitive-user|sensitive-password/);
    return true;
  });
});

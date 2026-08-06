const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createVolvoDriverClientFromEnv,
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

const finalDriverPayload = {
  driverResponse: {
    drivers: [{
      firstName: "Second",
      lastName: "Driver",
      contactInfo: { phone: "9000000001" },
      oemDriverIdentifications: [
        { idType: "pin", oemDriverIdentification: "driver-02" },
      ],
    }],
  },
  moreDataAvailable: false,
};

const finalDriverTimePayload = {
  driverTimeResponse: {
    driverTimes: [{
      driverId: {
        oemDriverIdentification: { idType: "pin", oemDriverIdentification: "driver-02" },
      },
      activities: [],
      dtjActivities: [{ activityType: "DRIVING" }],
    }],
  },
  moreDataAvailable: false,
  requestServerDateTime: "2026-07-17T10:01:00Z",
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

test("authenticates and loads every driver and driver-time page with lastDriverId", async () => {
  const requests = [];
  const client = new VolvoDriverClient({
    driversUrl: "https://api.example.test/driver/drivers",
    driverTimesUrl: "https://api.example.test/driver/drivertimes",
    username: "user",
    password: "secret",
    acceptDrivers: "drivers-v1",
    acceptDriverTimes: "driver-times-v1",
    fetchFn: async (url, options) => {
      requests.push({ url: String(url), options });
      const requestUrl = new URL(url);
      const isFinalPage = Boolean(requestUrl.searchParams.get("lastDriverId"));
      if (requestUrl.pathname.endsWith("/drivers")) {
        return response(200, isFinalPage ? finalDriverPayload : driverPayload);
      }
      return response(200, isFinalPage ? finalDriverTimePayload : driverTimePayload);
    },
  });

  const drivers = await client.fetchDrivers();
  const driverTimes = await client.fetchLatestDriverTimes();
  assert.equal(drivers.drivers.length, 2);
  assert.equal(drivers.pagesFetched, 2);
  assert.equal(driverTimes.driverTimes.length, 2);
  assert.equal(driverTimes.pagesFetched, 2);
  assert.match(requests[0].url, /driverIdType=pin/);
  assert.equal(new URL(requests[1].url).searchParams.get("lastDriverId"), "driver-01");
  assert.match(requests[2].url, /datetype=received/);
  assert.match(requests[2].url, /latestOnly=true/);
  assert.equal(new URL(requests[3].url).searchParams.get("lastDriverId"), "driver-01");
  assert.equal(requests[0].options.headers.Accept, "drivers-v1");
  assert.equal(requests[2].options.headers.Accept, "driver-times-v1");
  assert.equal(requests[0].options.headers.Authorization, "Basic dXNlcjpzZWNyZXQ=");
});

test("accepts supplied Volvo client credential and driver base URL aliases", () => {
  const client = createVolvoDriverClientFromEnv({
    VOLVO_CLIENT_ID: "client-id",
    VOLVO_CLIENT_SECRET: "client-secret",
    VOLVO_DRIVER_BASE_URL: "https://api.example.test/driver",
  });

  assert.equal(client.username, "client-id");
  assert.equal(client.password, "client-secret");
  assert.equal(client.driversUrl, "https://api.example.test/driver/drivers");
  assert.equal(client.driverTimesUrl, "https://api.example.test/driver/drivertimes");
  assert.equal(client.driverIdType, "pin");
  assert.equal(client.maxPages, 100);
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

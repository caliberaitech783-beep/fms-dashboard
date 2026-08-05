const { createHash } = require("node:crypto");

const IGNITION_ON = "IGNITION_ON";
const IGNITION_OFF = "IGNITION_OFF";

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonEmptyString(value) {
  const normalized = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
  return normalized || null;
}

function eventVin(event) {
  return nonEmptyString(firstDefined(event?.vin, event?.Vin, event?.VIN));
}

function eventTrigger(event) {
  const trigger = firstDefined(event?.triggerType, event?.TriggerType) || {};
  return nonEmptyString(firstDefined(trigger?.triggerType, trigger?.TriggerType)) || "UNKNOWN";
}

function eventContext(event) {
  const trigger = firstDefined(event?.triggerType, event?.TriggerType) || {};
  return nonEmptyString(firstDefined(trigger?.context, trigger?.Context));
}

function eventCreatedTime(event) {
  return nonEmptyString(firstDefined(event?.createdDateTime, event?.CreatedDateTime));
}

function eventReceivedTime(event) {
  return nonEmptyString(firstDefined(event?.receivedDateTime, event?.ReceivedDateTime));
}

function eventSnapshot(event) {
  const value = firstDefined(event?.snapshotData, event?.SnapshotData);
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function eventAccumulated(event) {
  const value = firstDefined(event?.accumulatedData, event?.AccumulatedData);
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function timestamp(value) {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.getTime() : Number.NEGATIVE_INFINITY;
}

function eventOrder(event) {
  return timestamp(eventReceivedTime(event) || eventCreatedTime(event));
}

function eventTimeOrder(event) {
  return timestamp(eventCreatedTime(event) || eventReceivedTime(event));
}

function stableEventKey(event) {
  const source = [
    eventVin(event),
    eventTrigger(event),
    eventCreatedTime(event),
    eventReceivedTime(event),
  ].join("|");
  return createHash("sha256").update(source).digest("hex");
}

function deduplicateEvents(events) {
  const byKey = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (eventVin(event)) byKey.set(stableEventKey(event), event);
  }
  return [...byKey.values()];
}

function parseVehicleStatusResponse(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const wrapped = firstDefined(root.vehicleStatusResponse, root.VehicleStatusResponse) || root;
  const events = firstDefined(
    wrapped.vehicleStatuses,
    wrapped.VehicleStatuses,
    wrapped.VehicleStatus,
    root.vehicleStatuses,
    root.VehicleStatuses,
    root.VehicleStatus,
  );
  const moreDataAvailable = firstDefined(
    wrapped.moreDataAvailable,
    wrapped.MoreDataAvailable,
    root.moreDataAvailable,
    root.MoreDataAvailable,
  );
  const requestServerDateTime = nonEmptyString(firstDefined(
    wrapped.requestServerDateTime,
    wrapped.RequestServerDateTime,
    root.requestServerDateTime,
    root.RequestServerDateTime,
  ));

  if (events !== undefined && !Array.isArray(events)) {
    throw Object.assign(new Error("Volvo vehicle status response has an unexpected structure."), { statusCode: 502 });
  }
  if (typeof moreDataAvailable !== "boolean") {
    throw Object.assign(new Error("Volvo vehicle status response has an unexpected structure."), { statusCode: 502 });
  }

  return {
    events: events || [],
    moreDataAvailable,
    requestServerDateTime,
  };
}

function newest(events, predicate = () => true) {
  return events
    .filter((event) => event && predicate(event))
    .sort((left, right) => eventTimeOrder(right) - eventTimeOrder(left) || eventOrder(right) - eventOrder(left))[0] || null;
}

function snapshotValue(snapshot, lowerName, upperName) {
  return firstDefined(snapshot?.[lowerName], snapshot?.[upperName]);
}

function accumulatedValue(accumulated, lowerName, upperName) {
  return firstDefined(accumulated?.[lowerName], accumulated?.[upperName]);
}

function gnssFromEvent(event) {
  const snapshot = eventSnapshot(event);
  const value = firstDefined(snapshot?.gnssPosition, snapshot?.GnssPosition, snapshot?.GNSSPosition);
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function speedFromEvent(event) {
  const snapshot = eventSnapshot(event);
  if (!snapshot) return null;
  const gnss = gnssFromEvent(event);
  return finiteNumber(firstDefined(
    snapshotValue(snapshot, "wheelBasedSpeed", "WheelBasedSpeed"),
    snapshotValue(snapshot, "tachographSpeed", "TachographSpeed"),
    firstDefined(gnss?.speed, gnss?.Speed),
  ));
}

function speedTimeFromEvent(event) {
  const gnss = gnssFromEvent(event);
  return nonEmptyString(firstDefined(
    gnss?.positionDateTime,
    gnss?.PositionDateTime,
    eventCreatedTime(event),
    eventReceivedTime(event),
  ));
}

function ignitionFromEvent(event) {
  const trigger = eventTrigger(event).toUpperCase();
  if (trigger === IGNITION_ON) return "ON";
  if (trigger === IGNITION_OFF) return "OFF";
  return null;
}

function driverIdFromEvent(event) {
  const driver = firstDefined(event?.driver1Id, event?.Driver1Id) || {};
  const oem = firstDefined(driver?.oemDriverIdentification, driver?.OemDriverIdentification) || {};
  const tacho = firstDefined(driver?.tachoDriverIdentification, driver?.TachoDriverIdentification) || {};
  const trigger = firstDefined(event?.triggerType, event?.TriggerType) || {};
  const triggerDriver = firstDefined(trigger?.driverId, trigger?.DriverId) || {};
  const triggerOem = firstDefined(triggerDriver?.oemDriverIdentification, triggerDriver?.OemDriverIdentification) || {};
  const triggerTacho = firstDefined(triggerDriver?.tachoDriverIdentification, triggerDriver?.TachoDriverIdentification) || {};

  return nonEmptyString(firstDefined(
    oem?.oemDriverIdentification,
    oem?.OemDriverIdentification,
    tacho?.driverIdentification,
    tacho?.DriverIdentification,
    triggerOem?.oemDriverIdentification,
    triggerOem?.OemDriverIdentification,
    triggerTacho?.driverIdentification,
    triggerTacho?.DriverIdentification,
  ));
}

function maskDriverId(driverId) {
  const normalized = nonEmptyString(driverId);
  return normalized ? `****${normalized.slice(-4)}` : null;
}

function movementState({ speedKph, speedTime, ignitionState, ignitionTime, threshold }) {
  const speedTimestamp = timestamp(speedTime);
  const ignitionTimestamp = timestamp(ignitionTime);

  if (ignitionState === "OFF" && (speedKph === null || ignitionTimestamp >= speedTimestamp)) return "PARKED";
  if (speedKph !== null && speedKph > threshold) return "MOVING";
  if (ignitionState === "ON" && speedKph !== null && speedKph <= threshold) return "STANDSTILL";
  if (speedKph !== null && speedKph <= threshold) return "STOPPED_UNKNOWN_IGNITION";
  return "UNKNOWN";
}

function accumulatedMovementState(previousAccumulated, currentAccumulated) {
  if (!previousAccumulated || !currentAccumulated) return null;

  const counterDelta = (lowerName, upperName) => {
    const previous = finiteNumber(accumulatedValue(previousAccumulated, lowerName, upperName));
    const current = finiteNumber(accumulatedValue(currentAccumulated, lowerName, upperName));
    if (previous === null || current === null || current < previous) return null;
    return current - previous;
  };
  const runningDelta = counterDelta(
    "durationWheelbaseSpeedOverZero",
    "DurationWheelbaseSpeedOverZero",
  );
  const standstillDelta = counterDelta(
    "durationWheelbaseSpeedZero",
    "DurationWheelbaseSpeedZero",
  );

  if (runningDelta === null || standstillDelta === null) return null;
  if (runningDelta > standstillDelta) return "MOVING";
  if (standstillDelta > runningDelta) return "STANDSTILL";
  return null;
}

function deriveCurrentStandstill(events, previousState, threshold) {
  let latestSpeed = finiteNumber(previousState?.speedKph);
  let latestSpeedTime = previousState?.speedTime || null;
  let ignitionState = previousState?.ignitionState || "UNKNOWN";
  let ignitionTime = previousState?.ignitionTime || null;
  let state = previousState?.movementState || "UNKNOWN";
  let startedAt = previousState?.standstillStartedAt || null;
  let latestAccumulated = eventAccumulated(previousState?.latestAccumulatedEvent);

  for (const event of [...events].sort((left, right) => eventTimeOrder(left) - eventTimeOrder(right))) {
    const eventSpeed = speedFromEvent(event);
    if (eventSpeed !== null) {
      latestSpeed = eventSpeed;
      latestSpeedTime = speedTimeFromEvent(event);
    }
    const eventIgnition = ignitionFromEvent(event);
    if (eventIgnition) {
      ignitionState = eventIgnition;
      ignitionTime = eventCreatedTime(event) || eventReceivedTime(event);
    }

    let nextState = movementState({
      speedKph: latestSpeed,
      speedTime: latestSpeedTime,
      ignitionState,
      ignitionTime,
      threshold,
    });
    const currentAccumulated = eventAccumulated(event);
    if (nextState === "UNKNOWN" && currentAccumulated) {
      nextState = accumulatedMovementState(latestAccumulated, currentAccumulated) || state;
    }
    if (nextState === "STANDSTILL" && state !== "STANDSTILL") {
      startedAt = eventCreatedTime(event) || eventReceivedTime(event) || latestSpeedTime;
    } else if (["MOVING", "PARKED", "STOPPED_UNKNOWN_IGNITION"].includes(nextState)) {
      startedAt = null;
    }
    state = nextState;
    if (currentAccumulated) latestAccumulated = currentAccumulated;
  }

  return {
    movementState: state,
    standstillStartedAt: state === "STANDSTILL" ? startedAt : null,
    speedKph: latestSpeed,
    speedTime: latestSpeedTime,
    ignitionState,
    ignitionTime,
  };
}

function latestPositionEvent(events) {
  return newest(events, (event) => {
    const gnss = gnssFromEvent(event);
    return finiteNumber(firstDefined(gnss?.latitude, gnss?.Latitude)) !== null
      && finiteNumber(firstDefined(gnss?.longitude, gnss?.Longitude)) !== null;
  });
}

function candidateEvents(events, previousState) {
  return deduplicateEvents([
    ...(events || []),
    previousState?.latestEvent,
    previousState?.latestSnapshotEvent,
    previousState?.latestAccumulatedEvent,
    previousState?.latestIgnitionEvent,
    previousState?.latestDriverEvent,
    previousState?.latestLocationEvent,
  ].filter(Boolean));
}

function eventHistory(events, previousState) {
  const previous = Array.isArray(previousState?.recentEvents) ? previousState.recentEvents : [];
  const current = events.map((event) => ({
    eventKey: stableEventKey(event),
    triggerType: eventTrigger(event),
    context: eventContext(event),
    eventTime: eventCreatedTime(event),
    receivedTime: eventReceivedTime(event),
  }));
  return [...new Map([...previous, ...current].map((item) => [item.eventKey, item])).values()]
    .sort((left, right) => timestamp(right.eventTime) - timestamp(left.eventTime))
    .slice(0, 20);
}

function normalizeState(state, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const freshAfterMinutes = Number(options.freshAfterMinutes || 20);
  const staleAfterMinutes = Number(options.staleAfterMinutes || 120);
  const standstillSpeedKph = Number(options.standstillSpeedKph ?? 3);
  const latestEvent = state.latestEvent;
  const latestSnapshotEvent = state.latestSnapshotEvent;
  const latestAccumulatedEvent = state.latestAccumulatedEvent;
  const latestDriverEvent = state.latestDriverEvent;
  const latestLocationEvent = state.latestLocationEvent;
  const snapshot = eventSnapshot(latestSnapshotEvent) || {};
  const accumulated = eventAccumulated(latestAccumulatedEvent) || {};
  const gnss = gnssFromEvent(latestLocationEvent) || {};
  const eventTime = eventCreatedTime(latestEvent) || eventReceivedTime(latestEvent);
  const receivedTime = eventReceivedTime(latestEvent) || eventTime;
  const positionTime = nonEmptyString(firstDefined(
    gnss?.positionDateTime,
    gnss?.PositionDateTime,
    eventCreatedTime(latestLocationEvent),
  ));
  const driverId = driverIdFromEvent(latestDriverEvent);
  const rawDataAgeSeconds = Math.floor((now.getTime() - timestamp(eventTime)) / 1000);
  const dataAgeSeconds = Number.isFinite(rawDataAgeSeconds) ? Math.max(0, rawDataAgeSeconds) : null;
  const locationAgeSeconds = positionTime
    ? Math.max(0, Math.floor((now.getTime() - timestamp(positionTime)) / 1000))
    : null;
  const currentStandstillSeconds = state.standstillStartedAt
    ? Math.max(0, Math.floor((now.getTime() - timestamp(state.standstillStartedAt)) / 1000))
    : null;
  const odometerMetres = finiteNumber(firstDefined(
    latestEvent?.hrTotalVehicleDistance,
    latestEvent?.HRTotalVehicleDistance,
    latestAccumulatedEvent?.hrTotalVehicleDistance,
    latestAccumulatedEvent?.HRTotalVehicleDistance,
  ));
  const engineHours = finiteNumber(firstDefined(
    latestEvent?.totalEngineHours,
    latestEvent?.TotalEngineHours,
    latestAccumulatedEvent?.totalEngineHours,
    latestAccumulatedEvent?.TotalEngineHours,
  ));
  const totalFuelMillilitres = finiteNumber(firstDefined(
    latestEvent?.engineTotalFuelUsed,
    latestEvent?.EngineTotalFuelUsed,
    latestAccumulatedEvent?.engineTotalFuelUsed,
    latestAccumulatedEvent?.EngineTotalFuelUsed,
  ));

  const ageMinutes = dataAgeSeconds === null ? null : dataAgeSeconds / 60;
  const freshnessState = ageMinutes === null
    ? "no-data"
    : ageMinutes <= freshAfterMinutes
      ? "fresh"
      : ageMinutes <= staleAfterMinutes
        ? "delayed"
        : "stale";

  return {
    vin: state.vin,
    eventType: eventTrigger(latestEvent),
    eventContext: eventContext(latestEvent),
    eventTime,
    receivedTime,
    odometerKm: odometerMetres === null ? null : odometerMetres / 1000,
    engineHours,
    totalFuelLitres: totalFuelMillilitres === null ? null : totalFuelMillilitres / 1000,
    grossWeightKg: finiteNumber(firstDefined(
      latestEvent?.grossCombinationVehicleWeight,
      latestEvent?.GrossCombinationVehicleWeight,
    )),
    driverId,
    maskedDriverId: maskDriverId(driverId),
    ignitionState: state.ignitionState,
    movementState: state.movementState,
    speedKph: finiteNumber(state.speedKph),
    fuelPercent: finiteNumber(snapshotValue(snapshot, "fuelLevel1", "FuelLevel1")),
    adBluePercent: finiteNumber(snapshotValue(snapshot, "catalystFuelLevel", "CatalystFuelLevel")),
    ambientTemperatureC: finiteNumber(snapshotValue(snapshot, "ambientAirTemperature", "AmbientAirTemperature")),
    latitude: finiteNumber(firstDefined(gnss?.latitude, gnss?.Latitude)),
    longitude: finiteNumber(firstDefined(gnss?.longitude, gnss?.Longitude)),
    heading: finiteNumber(firstDefined(gnss?.heading, gnss?.Heading)),
    altitudeMetres: finiteNumber(firstDefined(gnss?.altitude, gnss?.Altitude)),
    positionTime,
    lifetimeStandstillSeconds: finiteNumber(accumulatedValue(
      accumulated,
      "durationWheelbaseSpeedZero",
      "DurationWheelbaseSpeedZero",
    )),
    lifetimeRunningSeconds: finiteNumber(accumulatedValue(
      accumulated,
      "durationWheelbaseSpeedOverZero",
      "DurationWheelbaseSpeedOverZero",
    )),
    lifetimeStandstillFuelLitres: (() => {
      const value = finiteNumber(accumulatedValue(accumulated, "fuelWheelbaseSpeedZero", "FuelWheelbaseSpeedZero"));
      return value === null ? null : value / 1000;
    })(),
    lifetimeRunningFuelLitres: (() => {
      const value = finiteNumber(accumulatedValue(
        accumulated,
        "fuelWheelbaseSpeedOverZero",
        "FuelWheelbaseSpeedOverZero",
      ));
      return value === null ? null : value / 1000;
    })(),
    currentStandstillStartedAt: state.standstillStartedAt,
    currentStandstillSeconds,
    dataAgeSeconds,
    locationAgeSeconds,
    freshness: {
      state: freshnessState,
      ageMinutes,
    },
    isStale: freshnessState === "stale" || freshnessState === "no-data",
    eventHistory: state.recentEvents,
  };
}

function consolidateVehicleEvents(events, previousStates = new Map(), options = {}) {
  const deduplicated = deduplicateEvents(events);
  const grouped = new Map();
  for (const event of deduplicated) {
    const vin = eventVin(event);
    const group = grouped.get(vin) || [];
    group.push(event);
    grouped.set(vin, group);
  }

  const vins = new Set([...previousStates.keys(), ...grouped.keys()]);
  const states = new Map();
  const vehicles = [];
  const threshold = Number(options.standstillSpeedKph ?? 3);

  for (const vin of vins) {
    const previousState = previousStates.get(vin) || null;
    const currentEvents = grouped.get(vin) || [];
    const candidates = candidateEvents(currentEvents, previousState);
    const latestEvent = newest(candidates);
    if (!latestEvent) continue;

    const latestSnapshotEvent = newest(candidates, (event) => Boolean(eventSnapshot(event)));
    const latestAccumulatedEvent = newest(candidates, (event) => Boolean(eventAccumulated(event)));
    const latestIgnitionEvent = newest(candidates, (event) => Boolean(ignitionFromEvent(event)));
    const latestDriverEvent = newest(candidates, (event) => Boolean(driverIdFromEvent(event)));
    const latestLocationEvent = latestPositionEvent(candidates);
    const derived = deriveCurrentStandstill(currentEvents, previousState, threshold);
    const state = {
      vin,
      latestEvent,
      latestSnapshotEvent,
      latestAccumulatedEvent,
      latestIgnitionEvent,
      latestDriverEvent,
      latestLocationEvent,
      recentEvents: eventHistory(currentEvents, previousState),
      ...derived,
      updatedAt: new Date().toISOString(),
    };
    states.set(vin, state);
    vehicles.push(normalizeState(state, options));
  }

  vehicles.sort((left, right) => left.vin.localeCompare(right.vin));
  return { events: deduplicated, states, vehicles };
}

function summarizeLiveVehicles(vehicles) {
  return vehicles.reduce((summary, vehicle) => {
    summary.total += 1;
    if (vehicle.latitude !== null && vehicle.longitude !== null) summary.withPosition += 1;
    if (vehicle.freshness?.state && Object.hasOwn(summary, vehicle.freshness.state)) {
      summary[vehicle.freshness.state] += 1;
    }
    if (vehicle.movementState === "MOVING") summary.moving += 1;
    else if (vehicle.movementState === "STANDSTILL") summary.standstill += 1;
    else if (vehicle.movementState === "PARKED") summary.parked += 1;
    else summary.unknown += 1;
    return summary;
  }, {
    total: 0,
    withPosition: 0,
    moving: 0,
    standstill: 0,
    parked: 0,
    unknown: 0,
    fresh: 0,
    delayed: 0,
    stale: 0,
    "no-data": 0,
  });
}

module.exports = {
  consolidateVehicleEvents,
  deduplicateEvents,
  driverIdFromEvent,
  eventAccumulated,
  eventCreatedTime,
  eventReceivedTime,
  eventSnapshot,
  eventTrigger,
  eventVin,
  maskDriverId,
  movementState,
  normalizeState,
  parseVehicleStatusResponse,
  stableEventKey,
  summarizeLiveVehicles,
};

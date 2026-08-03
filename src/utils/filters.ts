import type {
  DashboardFilters,
  FleetTelemetryRecord,
  Vehicle,
} from "../types/fleet";

function isAll(value: string | undefined): boolean {
  return !value || value === "All";
}

export function isLiveOemSource(source: string | undefined): boolean {
  return source === "VOLVO_RFMS_LIVE"
    || source === "SCANIA_RFMS_LIVE"
    || source === "EICHER_VECV_LIVE";
}

function isEicherLocationView(vehicleOrRecord: Pick<Vehicle, "company" | "source">, filters: DashboardFilters): boolean {
  return filters.company === "Eicher"
    && vehicleOrRecord.company === "Eicher"
    && vehicleOrRecord.source === "EICHER_VECV_LIVE";
}

export function filterVehicles(vehicles: Vehicle[], filters: DashboardFilters): Vehicle[] {
  const vehicleSearch = filters.vehicleNumber.trim().toLowerCase();

  return vehicles.filter((vehicle) => {
    const eicherLocationView = isEicherLocationView(vehicle, filters);
    if (!eicherLocationView && !isAll(filters.siteId) && vehicle.siteId !== filters.siteId) return false;
    if (!eicherLocationView && !isAll(filters.contractType) && vehicle.contractType !== filters.contractType) return false;
    if (!eicherLocationView && !isAll(filters.assetCategory) && vehicle.assetCategory !== filters.assetCategory) return false;
    if (!eicherLocationView && !isAll(filters.assetType) && vehicle.assetType !== filters.assetType) return false;
    if (!isAll(filters.company) && vehicle.company !== filters.company) return false;
    if (!isAll(filters.modelNumber) && vehicle.modelNumber !== filters.modelNumber) return false;
    if (!isAll(filters.status) && vehicle.status !== filters.status) return false;
    if (vehicleSearch && !vehicle.vehicleNumber.toLowerCase().includes(vehicleSearch)) return false;

    return true;
  });
}

export function filterTelemetryRecords(
  records: FleetTelemetryRecord[],
  vehicles: Vehicle[],
  filters: DashboardFilters,
): FleetTelemetryRecord[] {
  const vehicleIds = new Set(filterVehicles(vehicles, filters).map((vehicle) => vehicle.id));
  const from = new Date(`${filters.dateFrom}T00:00:00`);
  const to = new Date(`${filters.dateTo}T23:59:59`);

  return records.filter((record) => {
    const timestamp = new Date(record.timestamp);
    const isLiveOem = isLiveOemSource(record.source);
    const eicherLocationView = isEicherLocationView(record, filters);

    if (!vehicleIds.has(record.vehicleId)) return false;
    if (!isLiveOem && (timestamp < from || timestamp > to)) return false;
    if (!eicherLocationView && !isAll(filters.shift) && record.shift !== filters.shift) return false;
    if (!eicherLocationView && !isAll(filters.lead) && Number(record.leadKm) !== Number(filters.lead)) return false;

    return true;
  });
}

export function uniqueSorted(values: Array<string | number | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string | number => value !== null && value !== undefined).map(String))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

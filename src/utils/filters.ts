import type {
  DashboardFilters,
  FleetTelemetryRecord,
  Vehicle,
} from "../types/fleet";

function isAll(value: string | undefined): boolean {
  return !value || value === "All";
}

export function filterVehicles(vehicles: Vehicle[], filters: DashboardFilters): Vehicle[] {
  const vehicleSearch = filters.vehicleNumber.trim().toLowerCase();

  return vehicles.filter((vehicle) => {
    if (!isAll(filters.siteId) && vehicle.siteId !== filters.siteId) return false;
    if (!isAll(filters.contractType) && vehicle.contractType !== filters.contractType) return false;
    if (!isAll(filters.assetCategory) && vehicle.assetCategory !== filters.assetCategory) return false;
    if (!isAll(filters.assetType) && vehicle.assetType !== filters.assetType) return false;
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

    if (!vehicleIds.has(record.vehicleId)) return false;
    if (timestamp < from || timestamp > to) return false;
    if (!isAll(filters.shift) && record.shift !== filters.shift) return false;
    if (!isAll(filters.lead) && Number(record.leadKm) !== Number(filters.lead)) return false;

    return true;
  });
}

export function uniqueSorted(values: Array<string | number | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string | number => value !== null && value !== undefined).map(String))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

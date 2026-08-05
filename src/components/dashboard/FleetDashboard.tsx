import { AlertTriangle, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Alert } from "../../types/fleet";
import type { FleetVehicleRow } from "../../services/fleetService";
import { isLiveOemSource } from "../../utils/filters";
import { formatDate, formatDateTime, formatEfficiency, formatHours, formatLitres, formatM3, formatNumber, formatPercent, titleCase } from "../../utils/formatters";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { LoadingState } from "../ui/LoadingState";
import { Panel } from "../ui/Panel";
import { StatusBadge } from "../ui/StatusBadge";

type LiveFilter = "ALL" | "MOVING" | "STANDSTILL" | "PARKED" | "OFFLINE" | "UNKNOWN" | "STALE";
type LiveSort = "EVENT_TIME" | "STANDSTILL" | "ODOMETER" | "FUEL" | "VIN";

interface FleetDashboardProps {
  rows: FleetVehicleRow[];
  alerts: Alert[];
  loading: boolean;
  onReload?: () => void;
  onRefresh?: () => Promise<void>;
}

export function FleetDashboard({ rows, alerts, loading, onReload, onRefresh }: FleetDashboardProps) {
  const [selected, setSelected] = useState<FleetVehicleRow | null>(null);
  const [search, setSearch] = useState("");
  const [liveFilter, setLiveFilter] = useState<LiveFilter>("ALL");
  const [liveSort, setLiveSort] = useState<LiveSort>("EVENT_TIME");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const liveRows = useMemo(() => rows.filter((row) => isLiveOemSource(row.vehicle.source)), [rows]);
  const staleCount = liveRows.filter((row) => rawBoolean(row, "isStale")).length;
  const latestUpdate = liveRows
    .map((row) => rawString(row, "eventTime") || row.lastDataReceived)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0] || null;

  useEffect(() => {
    if (!onReload) return;
    const interval = window.setInterval(onReload, 30_000);
    return () => window.clearInterval(interval);
  }, [onReload]);

  const statusSummary = useMemo(
    () => ["running", "idle", "stopped", "offline", "maintenance", "unknown"].map((status) => ({
      status,
      count: rows.filter((row) => row.vehicle.status === status).length,
    })),
    [rows],
  );

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows
      .filter((row) => !query
        || row.vehicle.vehicleNumber.toLowerCase().includes(query)
        || row.vehicle.trackerId.toLowerCase().includes(query)
        || driverDisplay(row).toLowerCase().includes(query))
      .filter((row) => {
        if (liveFilter === "ALL") return true;
        if (!isLiveOemSource(row.vehicle.source)) return false;
        if (liveFilter === "STALE") return rawBoolean(row, "isStale");
        return normalizedMovement(row) === liveFilter;
      })
      .sort((left, right) => compareRows(left, right, liveSort));
  }, [liveFilter, liveSort, rows, search]);

  if (loading) return <LoadingState />;

  const handleRefresh = async () => {
    if (!onRefresh) {
      onReload?.();
      return;
    }
    setRefreshing(true);
    setRefreshError(null);
    try {
      await onRefresh();
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Live OEM data refresh failed.");
    } finally {
      setRefreshing(false);
    }
  };

  const columns: DataTableColumn<FleetVehicleRow>[] = [
    {
      header: "Vehicle / VIN",
      render: (row) => (
        <div className="min-w-40">
          <span className="block font-semibold text-coal-900">{row.vehicle.vehicleNumber}</span>
          <span className="block text-xs text-coal-500">{row.vehicle.trackerId}</span>
        </div>
      ),
    },
    { header: "OEM", render: (row) => row.vehicle.company },
    { header: "Site", render: (row) => row.siteName },
    { header: "Model", render: (row) => row.vehicle.modelNumber ?? "—" },
    { header: "Status", render: (row) => <LiveStatus row={row} /> },
    { header: "Freshness", render: (row) => <FreshnessStatus row={row} /> },
    { header: "Ignition", render: (row) => rawString(row, "ignitionState") ?? "—" },
    { header: "Speed", render: (row) => formatMetric(rawNumber(row, "speedKph"), "km/h", 1), align: "right" },
    { header: "Current standstill", render: (row) => row.vehicle.source === "EICHER_VECV_LIVE" ? "-" : formatDuration(rawNumber(row, "currentStandstillSeconds")), align: "right" },
    { header: "Odometer", render: (row) => formatMetric(rawNumber(row, "lifetimeOdometerKm"), "km", 1), align: "right" },
    { header: "Fuel level", render: (row) => formatMetric(rawNumber(row, "fuelPercent"), "%", 1), align: "right" },
    { header: "AdBlue", render: (row) => formatMetric(rawNumber(row, "adBluePercent"), "%", 1), align: "right" },
    { header: "Engine hours", render: (row) => formatMetric(rawNumber(row, "lifetimeEngineHours"), "hr", 1), align: "right" },
    { header: "Total fuel", render: (row) => formatMetric(rawNumber(row, "lifetimeFuelLitres"), "L", 1), align: "right" },
    { header: "Driver", render: (row) => driverDisplay(row) },
    { header: "Latest event", render: (row) => formatEvent(rawString(row, "eventType")) },
    { header: "Location time", render: (row) => formatDateTime(rawString(row, "positionTime")) },
    { header: "Position age", render: (row) => formatAgeMinutes(rawNumber(row, "freshnessAgeMinutes")) },
    { header: "Last update", render: (row) => formatDateTime(rawString(row, "eventTime") || row.lastDataReceived) },
  ];

  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-coal-950">Latest live OEM vehicle data</h2>
              <Badge tone={liveRows.length ? "good" : "danger"}>{liveRows.length ? "Latest available" : "API unavailable"}</Badge>
              {staleCount > 0 && <Badge tone="warning">{staleCount} stale</Badge>}
            </div>
            <p className="mt-1 text-sm text-coal-500">
              {latestUpdate ? `Last updated ${formatDateTime(latestUpdate)}` : "No live OEM status has been received."}
            </p>
          </div>
          <Button icon={<RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />} onClick={handleRefresh} disabled={refreshing} variant="primary">
            {refreshing ? "Refreshing" : "Refresh now"}
          </Button>
        </div>
        {refreshError && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{refreshError}</span>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {statusSummary.map((item) => (
          <Panel key={item.status}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-coal-500">{titleCase(item.status)}</p>
                <p className="mt-2 text-3xl font-semibold text-coal-950">{formatNumber(item.count)}</p>
              </div>
              <StatusBadge status={item.status} />
            </div>
          </Panel>
        ))}
      </div>

      <Panel title="Vehicle List" subtitle="Volvo and Scania keep their existing telemetry fields; Eicher shows live VECV road-vehicle location fields only.">
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <label className="relative block">
            <span className="sr-only">Search VIN</span>
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-coal-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search vehicle or VIN" className="h-10 w-full rounded-md border border-coal-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-ore-600 focus:ring-2 focus:ring-ore-100" />
          </label>
          <select value={liveFilter} onChange={(event) => setLiveFilter(event.target.value as LiveFilter)} className="h-10 rounded-md border border-coal-200 bg-white px-3 text-sm text-coal-800 outline-none focus:border-ore-600 focus:ring-2 focus:ring-ore-100">
            <option value="ALL">All vehicle states</option>
            <option value="MOVING">Moving</option>
            <option value="STANDSTILL">Engine-on standstill</option>
            <option value="PARKED">Parked / ignition off</option>
            <option value="OFFLINE">Offline</option>
            <option value="UNKNOWN">Unknown</option>
            <option value="STALE">Data stale</option>
          </select>
          <select value={liveSort} onChange={(event) => setLiveSort(event.target.value as LiveSort)} className="h-10 rounded-md border border-coal-200 bg-white px-3 text-sm text-coal-800 outline-none focus:border-ore-600 focus:ring-2 focus:ring-ore-100">
            <option value="EVENT_TIME">Sort by latest event</option>
            <option value="STANDSTILL">Sort by standstill duration</option>
            <option value="ODOMETER">Sort by odometer</option>
            <option value="FUEL">Sort by fuel level</option>
            <option value="VIN">Sort by VIN</option>
          </select>
        </div>
        <DataTable columns={columns} rows={visibleRows} getRowKey={(row) => row.vehicle.id} onRowClick={setSelected} maxHeight="max-h-[620px]" />
      </Panel>

      {selected && (
        <VehicleDetailDrawer row={selected} alerts={alerts.filter((alert) => alert.vehicleId === selected.vehicle.id).slice(0, 8)} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function VehicleDetailDrawer({ row, alerts, onClose }: { row: FleetVehicleRow; alerts: Alert[]; onClose: () => void }) {
  const variance = row.varianceFromNorm ?? 0;
  const history = rawArray(row, "eventHistory");
  const isVolvoLive = row.vehicle.source === "VOLVO_RFMS_LIVE";
  const isEicherLive = row.vehicle.source === "EICHER_VECV_LIVE";

  return (
    <div className="fixed inset-0 z-50 bg-coal-950/45" onClick={onClose}>
      <aside className="absolute right-0 top-0 h-full w-full max-w-xl overflow-y-auto bg-white shadow-command" onClick={(event) => event.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-coal-200 bg-white px-5 py-4">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-coal-500">Vehicle Detail</p><h2 className="mt-1 text-xl font-semibold text-coal-950">{row.vehicle.vehicleNumber}</h2></div>
          <Button icon={<X className="h-4 w-4" />} variant="ghost" onClick={onClose} aria-label="Close detail drawer" />
        </div>
        <div className="space-y-5 p-5">
          <Panel title="Vehicle Profile">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Detail label="VIN" value={row.vehicle.trackerId} /><Detail label="Site" value={row.siteName} />
              <Detail label="Company" value={row.vehicle.company} /><Detail label="Model" value={row.vehicle.modelNumber ?? "Not available"} />
              <Detail label="Type" value={row.vehicle.assetType ?? "Not available"} /><Detail label="Category" value={row.vehicle.assetCategory} />
              <Detail label="Types of work" value={row.vehicle.contractType ?? "Not available"} /><Detail label="Commissioned" value={formatDate(row.vehicle.commissioningDate)} />
            </dl>
          </Panel>

          {isEicherLive && <EicherStatusPanel row={row} />}

          {isVolvoLive && (
            <Panel title="Latest Volvo Status">
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <Detail label="Movement" value={movementLabel(rawString(row, "movementState"), rawBoolean(row, "isStale"))} />
                <Detail label="Ignition" value={rawString(row, "ignitionState") ?? "Not available"} />
                <Detail label="Freshness" value={freshnessLabel(rawString(row, "freshnessState"))} />
                <Detail label="Data age" value={formatAgeMinutes(rawNumber(row, "freshnessAgeMinutes"))} />
                <Detail label="Speed" value={formatMetric(rawNumber(row, "speedKph"), "km/h", 1)} />
                <Detail label="Driver" value={driverDisplay(row)} />
                <Detail label="Driver contact" value={row.latestRecord?.driverMobile ?? "Not available"} />
                <Detail label="Driver-time data" value={driverTimeLabel(row)} />
                <Detail label="Current standstill" value={formatDuration(rawNumber(row, "currentStandstillSeconds"))} />
                <Detail label="Accumulated standstill" value={formatDuration(rawNumber(row, "lifetimeStandstillSeconds"))} />
                <Detail label="Standstill fuel" value={formatMetric(rawNumber(row, "lifetimeStandstillFuelLitres"), "L", 1)} />
                <Detail label="Odometer" value={formatMetric(rawNumber(row, "lifetimeOdometerKm"), "km", 1)} />
                <Detail label="Fuel level" value={formatMetric(rawNumber(row, "fuelPercent"), "%", 1)} />
                <Detail label="AdBlue" value={formatMetric(rawNumber(row, "adBluePercent"), "%", 1)} />
                <Detail label="Engine hours" value={formatMetric(rawNumber(row, "lifetimeEngineHours"), "hr", 1)} />
                <Detail label="Total fuel used" value={formatMetric(rawNumber(row, "lifetimeFuelLitres"), "L", 1)} />
                <Detail label="Gross weight" value={formatMetric(rawNumber(row, "grossWeightKg"), "kg", 0)} />
                <Detail label="Ambient temperature" value={formatMetric(rawNumber(row, "ambientTemperatureC"), "°C", 1)} />
                <Detail label="Location" value={row.latestRecord?.location ?? "Not available"} />
                <Detail label="Position time" value={formatDateTime(rawString(row, "positionTime"))} />
                <Detail label="Latest event" value={formatEvent(rawString(row, "eventType"))} />
                <Detail label="Last update" value={formatDateTime(rawString(row, "eventTime"))} />
              </dl>
            </Panel>
          )}

          {!isEicherLive && (
          <Panel title="Selected Period Summary">
            <div className="grid gap-3 sm:grid-cols-2">
              <Metric label="Fuel" value={formatLitres(row.fuelConsumedLitres)} /><Metric label="Running Hours" value={formatHours(row.runningHours)} />
              <Metric label="Idle Hours" value={formatHours(row.idleHours)} /><Metric label="Trips" value={row.trips ? formatNumber(row.trips) : "Unavailable"} />
              <Metric label="Production" value={row.productionM3 ? formatM3(row.productionM3) : "Unavailable"} /><Metric label="Efficiency" value={formatEfficiency(row.efficiency, row.vehicle.fuelMeasurementUnit)} />
              <Metric label="Fuel per cubic metre" value={`${formatNumber(row.fuelPerM3, 3)} L/m³`} /><Metric label="Norm Variance" value={formatPercent(variance)} />
            </div>
          </Panel>
          )}

          {history.length > 0 && (
            <Panel title="Recent Volvo Events">
              <div className="space-y-2">
                {history.map((item, index) => (
                  <div key={`${String(item.eventKey || index)}`} className="rounded-md border border-coal-200 p-3 text-sm">
                    <div className="flex items-center justify-between gap-3"><span className="font-semibold text-coal-900">{formatEvent(String(item.triggerType || "Unknown"))}</span><span className="text-coal-500">{formatDateTime(String(item.eventTime || ""))}</span></div>
                    <p className="mt-1 text-coal-500">{String(item.context || "No context")}</p>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel title="Recent Alerts">
            {alerts.length ? <div className="space-y-3">{alerts.map((alert) => <div key={alert.id} className="rounded-md border border-coal-200 p-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-coal-900">{titleCase(alert.type)}</p><StatusBadge status={alert.severity} /></div><p className="mt-2 text-sm text-coal-600">{alert.message}</p></div>)}</div> : <p className="text-sm text-coal-500">No active alerts for this vehicle.</p>}
          </Panel>

          <Panel title="Last Sync Information"><dl className="grid gap-3 text-sm sm:grid-cols-2"><Detail label="Tracker Health" value={titleCase(row.trackerHealth)} /><Detail label="Last Data Received" value={formatDateTime(row.lastDataReceived)} /><Detail label="Latest Shift" value={row.latestRecord?.shift ? `Shift ${row.latestRecord.shift}` : "-"} /><Detail label="Latest Status" value={row.latestRecord?.status ? titleCase(row.latestRecord.status) : "-"} /></dl></Panel>
        </div>
      </aside>
    </div>
  );
}

function EicherStatusPanel({ row }: { row: FleetVehicleRow }) {
  const details = [
    { label: "API access status", value: eicherAccessStatus(row) },
    { label: "Registration number", value: rawString(row, "registrationNumber") || (row.vehicle.vehicleNumber !== row.vehicle.trackerId ? row.vehicle.vehicleNumber : null) },
    { label: "VIN", value: rawString(row, "vin") || row.vehicle.trackerId },
    { label: "Vehicle status", value: rawString(row, "vehicleStatus") || movementLabel(normalizedMovement(row), rawBoolean(row, "isStale")) },
    { label: "Ignition", value: eicherIgnition(row) },
    { label: "Speed", value: rawNumber(row, "speedKph") === null ? null : formatMetric(rawNumber(row, "speedKph"), "km/h", 1) },
    { label: "Latitude", value: formatCoordinate(rawNumber(row, "latitude")) },
    { label: "Longitude", value: formatCoordinate(rawNumber(row, "longitude")) },
    { label: "Current location", value: rawString(row, "currentLocation") || row.latestRecord?.location || null },
    { label: "GPS timestamp", value: rawString(row, "gpsTimestamp") ? formatDateTime(rawString(row, "gpsTimestamp")) : null },
    { label: "Last successful update", value: rawString(row, "lastSuccessfulUpdate") ? formatDateTime(rawString(row, "lastSuccessfulUpdate")) : null },
    { label: "Odometer", value: rawNumber(row, "odometerKm") === null ? null : formatMetric(rawNumber(row, "odometerKm"), "km", 1) },
  ].filter((detail): detail is { label: string; value: string } => Boolean(detail.value));

  return (
    <Panel title="Latest Eicher Status">
      {!row.latestRecord && (
        <p className="mb-3 text-sm text-coal-500">No live location record is available for this Eicher VIN yet.</p>
      )}
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {details.map((detail) => <Detail key={detail.label} label={detail.label} value={detail.value} />)}
      </dl>
    </Panel>
  );
}

function LiveStatus({ row }: { row: FleetVehicleRow }) {
  if (!isLiveOemSource(row.vehicle.source)) return <StatusBadge status={row.vehicle.status} />;
  const stale = rawBoolean(row, "isStale");
  const movement = normalizedMovement(row);
  const tone = stale || movement === "OFFLINE" ? "danger" : movement === "MOVING" ? "good" : movement === "STANDSTILL" ? "warning" : "neutral";
  return <Badge tone={tone}>{movementLabel(movement, stale)}</Badge>;
}

function FreshnessStatus({ row }: { row: FleetVehicleRow }) {
  if (!isLiveOemSource(row.vehicle.source)) return <Badge tone="neutral">Not applicable</Badge>;
  const state = rawString(row, "freshnessState") || "no-data";
  const tone = state === "fresh" ? "good" : state === "delayed" ? "warning" : state === "stale" ? "danger" : "neutral";
  return <Badge tone={tone}>{freshnessLabel(state)}</Badge>;
}

function freshnessLabel(value: string | null) {
  if (value === "fresh") return "Fresh";
  if (value === "delayed") return "Delayed";
  if (value === "stale") return "Stale";
  return "No data";
}

function movementLabel(value: string | null, stale: boolean) {
  if (stale) return "Data stale";
  if (value === "MOVING") return "Moving";
  if (value === "STANDSTILL") return "Engine-on standstill";
  if (value === "PARKED") return "Parked / ignition off";
  if (value === "STOPPED_UNKNOWN_IGNITION") return "Stopped / ignition unknown";
  if (value === "OFFLINE") return "Offline";
  return "Unknown";
}

function normalizedMovement(row: FleetVehicleRow): Exclude<LiveFilter, "ALL" | "STALE"> {
  const movement = rawString(row, "movementState");
  if (movement === "MOVING" || movement === "STANDSTILL" || movement === "PARKED" || movement === "OFFLINE" || movement === "UNKNOWN") return movement;
  if (row.vehicle.status === "running") return "MOVING";
  if (row.vehicle.status === "idle") return "STANDSTILL";
  if (row.vehicle.status === "stopped") return "PARKED";
  if (row.vehicle.status === "offline") return "OFFLINE";
  return "UNKNOWN";
}

function rawNumber(row: FleetVehicleRow, key: string): number | null {
  const value = row.latestRecord?.rawMetrics?.[key];
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rawString(row: FleetVehicleRow, key: string): string | null {
  const value = row.latestRecord?.rawMetrics?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function driverDisplay(row: FleetVehicleRow): string {
  if (row.vehicle.source === "EICHER_VECV_LIVE") return "Not supplied";
  return row.latestRecord?.driverName
    || rawString(row, "driverName")
    || rawString(row, "maskedDriverId")
    || "Not available";
}

function driverTimeLabel(row: FleetVehicleRow): string {
  const activities = rawNumber(row, "driverTimeActivityCount");
  const dtjActivities = rawNumber(row, "driverTimeDtjActivityCount");
  if (activities === null && dtjActivities === null) return "Not available";
  if ((activities || 0) === 0 && (dtjActivities || 0) === 0) return "No current activity";
  return `${formatNumber(activities || 0)} activity / ${formatNumber(dtjActivities || 0)} DTJ`;
}

function eicherAccessStatus(row: FleetVehicleRow): string {
  const raw = rawString(row, "apiAccessStatus");
  if (raw) return titleCase(raw.replace(/_/g, " "));
  return row.vehicle.trackerProvider.toLowerCase().includes("pending") ? "API access pending" : "API enabled";
}

function eicherIgnition(row: FleetVehicleRow): string | null {
  const value = rawString(row, "ignitionState");
  return value && value !== "UNKNOWN" ? value : null;
}

function rawBoolean(row: FleetVehicleRow, key: string): boolean {
  return row.latestRecord?.rawMetrics?.[key] === true;
}

function rawArray(row: FleetVehicleRow, key: string): Array<Record<string, unknown>> {
  const value = row.latestRecord?.rawMetrics?.[key];
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function formatMetric(value: number | null, unit: string, digits: number) {
  return value === null ? "—" : `${formatNumber(value, digits)} ${unit}`;
}

function formatCoordinate(value: number | null): string | null {
  return value === null ? null : formatNumber(value, 6);
}

function formatDuration(value: number | null) {
  if (value === null) return "—";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatAgeMinutes(value: number | null) {
  if (value === null) return "Not available";
  if (value < 1) return "Less than a minute";
  if (value < 60) return `${Math.round(value)} min ago`;
  return `${(value / 60).toFixed(value < 600 ? 1 : 0)} hr ago`;
}

function formatEvent(value: string | null) {
  return value ? titleCase(value) : "—";
}

function compareRows(left: FleetVehicleRow, right: FleetVehicleRow, sort: LiveSort) {
  if (sort === "VIN") return left.vehicle.trackerId.localeCompare(right.vehicle.trackerId);
  if (sort === "STANDSTILL") return standstillSortValue(right) - standstillSortValue(left);
  if (sort === "ODOMETER") return (rawNumber(right, "lifetimeOdometerKm") ?? -1) - (rawNumber(left, "lifetimeOdometerKm") ?? -1);
  if (sort === "FUEL") return (rawNumber(right, "fuelPercent") ?? -1) - (rawNumber(left, "fuelPercent") ?? -1);
  return (rawString(right, "eventTime") || "").localeCompare(rawString(left, "eventTime") || "");
}

function standstillSortValue(row: FleetVehicleRow): number {
  if (row.vehicle.source === "EICHER_VECV_LIVE") return normalizedMovement(row) === "STANDSTILL" ? 0 : -1;
  return rawNumber(row, "currentStandstillSeconds") ?? -1;
}

function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-semibold uppercase tracking-wide text-coal-500">{label}</dt><dd className="mt-1 break-words font-medium text-coal-900">{value}</dd></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-md border border-coal-200 bg-coal-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-coal-500">{label}</p><p className="mt-1 text-lg font-semibold text-coal-950">{value}</p></div>; }

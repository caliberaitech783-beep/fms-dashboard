import {
  Activity,
  Fuel,
  Gauge,
  Truck,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardOverview, EicherLiveDashboardRow, VehiclePerformanceRow } from "../../types/dashboard";
import { formatDateTime, formatEfficiency, formatHours, formatLitres, formatNumber } from "../../utils/formatters";
import { KpiCard } from "../cards/KpiCard";
import { ChartFrame } from "../charts/ChartFrame";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { LoadingState } from "../ui/LoadingState";
import { Panel } from "../ui/Panel";
import { StatusBadge } from "../ui/StatusBadge";

interface ManagementDashboardProps {
  overview: DashboardOverview | null;
  loading: boolean;
}

const kpiIcons = [Truck, Activity, Fuel, Gauge, Gauge];


export function ManagementDashboard({ overview, loading }: ManagementDashboardProps) {
  if (!overview) {
    return <LoadingState />;
  }

  const vehicleColumns: DataTableColumn<VehiclePerformanceRow>[] = [
    { header: "Vehicle", render: (row) => row.vehicle.vehicleNumber },
    { header: "Category", render: (row) => row.vehicle.assetCategory },
    { header: "OEM / Model", render: (row) => `${row.vehicle.company} ${row.vehicle.modelNumber}` },
    { header: "Fuel", render: (row) => formatLitres(row.fuelConsumedLitres), align: "right" },
    { header: "Run", render: (row) => formatHours(row.runningHours), align: "right" },
    { header: "Idle", render: (row) => formatHours(row.idleHours), align: "right" },
    { header: "Efficiency", render: (row) => formatEfficiency(row.efficiency, row.vehicle.assetCategory === "Truck" ? "km/L" : "L/hr"), align: "right" },
  ];

  const eicherLiveColumns: DataTableColumn<EicherLiveDashboardRow>[] = [
    { header: "Registration", render: (row) => row.registrationNumber, className: "min-w-36" },
    { header: "Chassis", render: (row) => row.chassisNumber, className: "min-w-44" },
    { header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    { header: "Speed", render: (row) => metricText(row.speedKph, "km/h", 1), align: "right" },
    { header: "Odometer", render: (row) => metricText(row.odometerKm, "km", 1), align: "right" },
    { header: "Direction", render: (row) => metricText(row.vehicleDirection, "deg", 0), align: "right" },
    { header: "Location", render: (row) => row.currentLocation || coordinateText(row.latitude, row.longitude), className: "min-w-64" },
    { header: "Device", render: (row) => row.deviceId || "-", className: "min-w-36" },
    { header: "GPS Time", render: (row) => formatDateTime(row.gpsTimestamp), className: "min-w-36" },
    { header: "Last Update", render: (row) => formatDateTime(row.lastSuccessfulUpdate), className: "min-w-36" },
  ];
  const showEicherLiveLocations = Array.isArray(overview.eicherLiveLocations);

  return (
    <div className="space-y-6" aria-busy={loading}>
      {loading && <p role="status" className="text-sm text-coal-500">Updating selected filters and period data...</p>}
      {overview.periodNotice && <p role="status" className="rounded-md border border-coal-200 bg-coal-50 px-4 py-3 text-sm text-coal-600">{overview.periodNotice}</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {overview.kpis.map((metric, index) => {
          const Icon = kpiIcons[index] ?? Activity;
          return <KpiCard key={metric.label} metric={metric} icon={<Icon className="h-5 w-5" />} />;
        })}
      </div>

      {showEicherLiveLocations && (
        <Panel title="Eicher Live Location Data" subtitle="Latest VECV location records for the selected Eicher fleet">
          <DataTable
            columns={eicherLiveColumns}
            rows={overview.eicherLiveLocations ?? []}
            getRowKey={(row) => row.vehicleId}
          />
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartFrame height={360} title="Truck Model Efficiency · km/L" subtitle="Distance travelled per litre of fuel">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={overview.modelPerformance.filter((row) => row.efficiencyUnit === "km/L")}>
              <CartesianGrid strokeDasharray="3 3" stroke="#205363" />
              <XAxis dataKey="name" interval={0} angle={-20} textAnchor="end" height={74} />
              <YAxis />
              <Tooltip formatter={(value: number) => [formatNumber(value, 2) + " km/L", "Efficiency"]} />
              <Bar maxBarSize={44} dataKey="efficiency" name="km/L" fill="#72ddec" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
        {(["standstill", "averageDiesel"] as const).map((metric) => (
          <ChartFrame key={metric} title={metric === "standstill" ? "Standstill · %" : "Avg Diesel · L/h"} subtitle="Selected shift / period by vehicle">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={overview.vehicleMetrics ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#205363" />
                <XAxis dataKey="name" interval={0} angle={-20} textAnchor="end" height={74} />
                <YAxis />
                <Tooltip formatter={(value: number) => [formatNumber(value, 2), metric === "standstill" ? "%" : "L/h"]} />
                <Bar maxBarSize={44} dataKey={metric} name={metric === "standstill" ? "Standstill %" : "Avg Diesel L/h"} fill="#39b8af" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        ))}



      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Top 10 High Fuel-consuming Vehicles">
          <DataTable columns={vehicleColumns} rows={overview.highFuelVehicles} getRowKey={(row) => row.vehicle.id} />
        </Panel>
        <Panel title="Top 10 Low-efficiency Vehicles">
          <DataTable columns={vehicleColumns} rows={overview.lowEfficiencyVehicles} getRowKey={(row) => row.vehicle.id} />
        </Panel>
        <Panel title="Top 10 Idle Vehicles">
          <DataTable columns={vehicleColumns} rows={overview.idleVehicles} getRowKey={(row) => row.vehicle.id} />
        </Panel>
      </div>

    </div>
  );
}

function coordinateText(latitude: number | null, longitude: number | null): string {
  if (latitude === null || longitude === null) return "-";
  return `${formatNumber(latitude, 6)}, ${formatNumber(longitude, 6)}`;
}

function metricText(value: number | null, unit: string, digits: number): string {
  return value === null ? "-" : `${formatNumber(value, digits)} ${unit}`;
}

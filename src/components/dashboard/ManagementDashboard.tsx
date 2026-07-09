import {
  Activity,
  AlertTriangle,
  Clock,
  Fuel,
  Gauge,
  HardHat,
  Route,
  Truck,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardOverview, VehiclePerformanceRow } from "../../types/dashboard";
import type { Alert, IntegrationSource } from "../../types/fleet";
import { formatDateTime, formatEfficiency, formatHours, formatLitres, formatM3, formatNumber, titleCase } from "../../utils/formatters";
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

const kpiIcons = [
  Truck,
  Activity,
  Clock,
  AlertTriangle,
  Fuel,
  Gauge,
  Gauge,
  Route,
  HardHat,
  Fuel,
  Clock,
  AlertTriangle,
];

const chartColors = ["#a56414", "#1f9d74", "#2f80ed", "#d64545", "#5d7484", "#e3a008"];

export function ManagementDashboard({ overview, loading }: ManagementDashboardProps) {
  if (loading || !overview) {
    return <LoadingState />;
  }

  const vehicleColumns: DataTableColumn<VehiclePerformanceRow>[] = [
    { header: "Vehicle", render: (row) => row.vehicle.vehicleNumber },
    { header: "Category", render: (row) => row.vehicle.assetCategory },
    { header: "OEM / Model", render: (row) => `${row.vehicle.company} ${row.vehicle.modelNumber}` },
    { header: "Fuel", render: (row) => formatLitres(row.fuelConsumedLitres), align: "right" },
    { header: "Run", render: (row) => formatHours(row.runningHours), align: "right" },
    { header: "Idle", render: (row) => formatHours(row.idleHours), align: "right" },
    { header: "Efficiency", render: (row) => formatEfficiency(row.efficiency, row.vehicle.fuelMeasurementUnit), align: "right" },
  ];

  const alertColumns: DataTableColumn<Alert>[] = [
    { header: "Type", render: (row) => titleCase(row.type) },
    { header: "Severity", render: (row) => <StatusBadge status={row.severity} /> },
    { header: "Vehicle", render: (row) => row.vehicleId },
    { header: "Message", render: (row) => row.message, className: "min-w-72" },
    { header: "Created", render: (row) => formatDateTime(row.createdAt) },
  ];

  const integrationColumns: DataTableColumn<IntegrationSource>[] = [
    { header: "OEM", render: (row) => row.company },
    { header: "Source", render: (row) => row.sourceType },
    { header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    { header: "Last Sync", render: (row) => formatDateTime(row.lastSyncAt) },
    { header: "Records", render: (row) => formatNumber(row.recordsSyncedToday), align: "right" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
        {overview.kpis.map((metric, index) => {
          const Icon = kpiIcons[index] ?? Activity;
          return <KpiCard key={metric.label} metric={metric} icon={<Icon className="h-5 w-5" />} />;
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartFrame title="Production vs Fuel Consumed Trend" subtitle="Daily production and fuel burn across selected filters">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={overview.productionFuelTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7ebee" />
              <XAxis dataKey="name" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip formatter={(value: number, name: string) => [formatNumber(value, 1), titleCase(name)]} />
              <Legend />
              <Area yAxisId="left" type="monotone" dataKey="productionM3" name="Production m³" stroke="#1f9d74" fill="#1f9d74" fillOpacity={0.18} />
              <Area yAxisId="right" type="monotone" dataKey="fuelConsumedLitres" name="Fuel L" stroke="#a56414" fill="#a56414" fillOpacity={0.18} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame title="Shift-wise Comparison" subtitle="Fuel, production, trips, and running hours by shift">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={overview.shiftComparison}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7ebee" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value: number) => formatNumber(value, 1)} />
              <Legend />
              <Bar dataKey="fuelConsumedLitres" name="Fuel L" fill="#a56414" radius={[4, 4, 0, 0]} />
              <Bar dataKey="productionM3" name="Production m³" fill="#1f9d74" radius={[4, 4, 0, 0]} />
              <Bar dataKey="runningHours" name="Running hr" fill="#2f80ed" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame title="Site-wise Fuel and Production Performance">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={overview.sitePerformance}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7ebee" />
              <XAxis dataKey="name" interval={0} angle={-18} textAnchor="end" height={70} />
              <YAxis />
              <Tooltip formatter={(value: number) => formatNumber(value, 1)} />
              <Legend />
              <Bar dataKey="fuelConsumedLitres" name="Fuel L" fill="#a56414" radius={[4, 4, 0, 0]} />
              <Bar dataKey="productionM3" name="Production m³" fill="#1f9d74" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame title="Company/OEM-wise Fuel Performance">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={overview.companyPerformance}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7ebee" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value: number) => formatNumber(value, 1)} />
              <Legend />
              <Bar dataKey="fuelConsumedLitres" name="Fuel L" fill="#5d7484" radius={[4, 4, 0, 0]} />
              <Bar dataKey="productionM3" name="Production m³" fill="#e3a008" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame title="Model-wise Efficiency Comparison" subtitle="Sorted by fuel intensity and model contribution">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={overview.modelPerformance}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7ebee" />
              <XAxis dataKey="name" interval={0} angle={-20} textAnchor="end" height={74} />
              <YAxis />
              <Tooltip formatter={(value: number) => formatNumber(value, 2)} />
              <Bar dataKey="efficiency" name="Efficiency / rate index" fill="#2f80ed" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame title="Vehicle Status Distribution">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={overview.statusDistribution} dataKey="value" nameKey="status" outerRadius={95} label>
                {overview.statusDistribution.map((entry, index) => (
                  <Cell key={entry.status} fill={chartColors[index % chartColors.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number, name: string) => [formatNumber(value), titleCase(name)]} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame title="Fuel Consumed by Category">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={overview.categoryFuel}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7ebee" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value: number) => formatNumber(value, 1)} />
              <Bar dataKey="fuelConsumedLitres" name="Fuel L" fill="#a56414" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame title="Running vs Idle Hours Trend">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={overview.runningIdleTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7ebee" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value: number) => formatHours(value)} />
              <Legend />
              <Line type="monotone" dataKey="runningHours" name="Running" stroke="#1f9d74" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="idleHours" name="Idle" stroke="#e3a008" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
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

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Recent Critical Alerts">
          <DataTable columns={alertColumns} rows={overview.criticalAlerts} getRowKey={(row) => row.id} />
        </Panel>
        <Panel title="Tracker Integration Health">
          <DataTable columns={integrationColumns} rows={overview.integrationHealth} getRowKey={(row) => row.id} />
        </Panel>
      </div>
    </div>
  );
}

import { AlertTriangle, Fuel, Gauge, Truck } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fuelService } from "../../services/fuelService";
import type { FleetTelemetryRecord } from "../../types/fleet";
import { formatEfficiency, formatLitres, formatNumber, formatPercent } from "../../utils/formatters";
import { KpiCard } from "../cards/KpiCard";
import { ChartFrame } from "../charts/ChartFrame";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { LoadingState } from "../ui/LoadingState";
import { Panel } from "../ui/Panel";

type FuelSummary = Awaited<ReturnType<typeof fuelService.getFuelSummary>>;
type FuelRow = FuelSummary["normDeviation"][number];

interface FuelDashboardProps {
  summary: FuelSummary | null;
  loading: boolean;
}

export function FuelDashboard({ summary, loading }: FuelDashboardProps) {
  if (loading || !summary) {
    return <LoadingState />;
  }

  const fuelRows: DataTableColumn<FuelRow>[] = [
    { header: "Vehicle", render: (row) => row.vehicle.vehicleNumber },
    { header: "Category", render: (row) => row.vehicle.assetCategory },
    { header: "OEM / Model", render: (row) => `${row.vehicle.company} ${row.vehicle.modelNumber}` },
    { header: "Fuel", render: (row) => formatLitres(row.fuelConsumedLitres), align: "right" },
    { header: "Efficiency", render: (row) => formatEfficiency(row.efficiency, row.vehicle.fuelMeasurementUnit), align: "right" },
    { header: "Norm", render: (row) => row.vehicle.standardFuelNorm === null ? "Norm not configured" : formatEfficiency(row.vehicle.standardFuelNorm, row.vehicle.fuelMeasurementUnit), align: "right" },
    { header: "Variance", render: (row) => formatPercent(row.varianceFromNorm), align: "right" },
    { header: "Fuel / Trip", render: (row) => `${formatNumber(row.fuelPerTrip, 2)} L`, align: "right" },
    { header: "Fuel / m³", render: (row) => `${formatNumber(row.fuelPerM3, 3)} L/m³`, align: "right" },
  ];

  const fuelDropColumns: DataTableColumn<FleetTelemetryRecord>[] = [
    { header: "Vehicle", render: (row) => row.vehicleId },
    { header: "Shift", render: (row) => `Shift ${row.shift}` },
    { header: "Fuel Level", render: (row) => formatLitres(row.fuelLevelLitres), align: "right" },
    { header: "Fuel Filled", render: (row) => formatLitres(row.fuelFilledLitres), align: "right" },
    { header: "Fuel Used", render: (row) => formatLitres(row.fuelConsumedLitres), align: "right" },
    { header: "Location", render: (row) => row.location },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard metric={{ label: "Total Fuel Consumed", value: formatLitres(summary.kpis.totalFuelConsumed), subLabel: "All filtered records", tone: "info" }} icon={<Fuel className="h-5 w-5" />} />
        <KpiCard metric={{ label: "Truck km/L", value: formatEfficiency(summary.kpis.averageTruckEfficiency, "km/L"), subLabel: "Truck category only", tone: "good" }} icon={<Truck className="h-5 w-5" />} />
        <KpiCard metric={{ label: "HEMM L/hr", value: formatEfficiency(summary.kpis.averageHemmFuelRate, "L/hr"), subLabel: "HEMM category only", tone: "warning" }} icon={<Gauge className="h-5 w-5" />} />
        <KpiCard metric={{ label: "Abnormal Fuel Drops", value: formatNumber(summary.abnormalFuelDrops.length), subLabel: "Sudden low tank level", tone: "danger" }} icon={<AlertTriangle className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <FuelBar title="Fuel Consumed by Site" data={summary.fuelBySite} />
        <FuelBar title="Fuel Consumed by Category" data={summary.fuelByCategory} />
        <FuelBar title="Fuel Consumed by Company/OEM" data={summary.fuelByCompany} />
        <FuelBar title="Fuel Consumed by Model" data={summary.fuelByModel.slice(0, 14)} />
        <FuelBar title="Fuel Consumed by Shift" data={summary.fuelByShift} />

        <ChartFrame title="Truck km/L Comparison" subtitle="Lowest truck efficiency appears first">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={summary.truckComparison}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7ebee" />
              <XAxis dataKey={(row: FuelRow) => row.vehicle.vehicleNumber} interval={0} angle={-20} textAnchor="end" height={70} />
              <YAxis />
              <Tooltip formatter={(value: number) => formatNumber(value, 2)} />
              <Bar dataKey="efficiency" name="km/L" fill="#1f9d74" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame title="HEMM L/hr Comparison" subtitle="Highest HEMM fuel rate appears first">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={summary.hemmComparison}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7ebee" />
              <XAxis dataKey={(row: FuelRow) => row.vehicle.vehicleNumber} interval={0} angle={-20} textAnchor="end" height={70} />
              <YAxis />
              <Tooltip formatter={(value: number) => formatNumber(value, 2)} />
              <Bar dataKey="efficiency" name="L/hr" fill="#a56414" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Fuel Norm Deviation">
          <DataTable columns={fuelRows} rows={summary.normDeviation} getRowKey={(row) => row.vehicle.id} />
        </Panel>
        <Panel title="Abnormal Fuel Drop List">
          <DataTable columns={fuelDropColumns} rows={summary.abnormalFuelDrops} getRowKey={(row) => row.id} />
        </Panel>
      </div>
    </div>
  );
}

function FuelBar({ title, data }: { title: string; data: Array<{ name: string; fuelConsumedLitres: number; productionM3?: number }> }) {
  return (
    <ChartFrame title={title}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e7ebee" />
          <XAxis dataKey="name" interval={0} angle={-20} textAnchor="end" height={70} />
          <YAxis />
          <Tooltip formatter={(value: number) => formatNumber(value, 1)} />
          <Legend />
          <Bar dataKey="fuelConsumedLitres" name="Fuel L" fill="#a56414" radius={[4, 4, 0, 0]} />
          <Bar dataKey="productionM3" name="Production m³" fill="#1f9d74" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

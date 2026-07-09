import { Boxes, Fuel, Gauge, Route } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { productionService } from "../../services/productionService";
import type { VehiclePerformanceRow } from "../../types/dashboard";
import { formatLitres, formatM3, formatNumber } from "../../utils/formatters";
import { KpiCard } from "../cards/KpiCard";
import { ChartFrame } from "../charts/ChartFrame";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { LoadingState } from "../ui/LoadingState";
import { Panel } from "../ui/Panel";

type ProductionSummary = Awaited<ReturnType<typeof productionService.getProductionSummary>>;

interface ProductionDashboardProps {
  summary: ProductionSummary | null;
  loading: boolean;
}

export function ProductionDashboard({ summary, loading }: ProductionDashboardProps) {
  if (loading || !summary) {
    return <LoadingState />;
  }

  if (!summary.hasProductionData) {
    return (
      <Panel title="Production Dashboard">
        <EmptyState
          title="Production data is not available"
          message="Production data is not available in the current sample. Connect a trip/production API or upload a production report in the next phase."
        />
      </Panel>
    );
  }

  const vehicleColumns: DataTableColumn<VehiclePerformanceRow>[] = [
    { header: "Vehicle", render: (row) => row.vehicle.vehicleNumber },
    { header: "Category", render: (row) => row.vehicle.assetCategory },
    { header: "Company / Model", render: (row) => `${row.vehicle.company} ${row.vehicle.modelNumber}` },
    { header: "Trips", render: (row) => formatNumber(row.trips), align: "right" },
    { header: "Production", render: (row) => formatM3(row.productionM3), align: "right" },
    { header: "Fuel", render: (row) => formatLitres(row.fuelConsumedLitres), align: "right" },
    { header: "Fuel / m³", render: (row) => `${formatNumber(row.fuelPerM3, 3)} L/m³`, align: "right" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard metric={{ label: "Total Trips", value: formatNumber(summary.totals.trips), subLabel: "Selected period", tone: "neutral" }} icon={<Route className="h-5 w-5" />} />
        <KpiCard metric={{ label: "Total Production", value: formatM3(summary.totals.productionM3), subLabel: "Trips x capacity", tone: "good" }} icon={<Boxes className="h-5 w-5" />} />
        <KpiCard metric={{ label: "Avg Production / Vehicle", value: formatM3(summary.totals.averageProductionPerVehicle), subLabel: "Filtered vehicles", tone: "info" }} icon={<Gauge className="h-5 w-5" />} />
        <KpiCard metric={{ label: "Fuel per m³", value: `${formatNumber(summary.totals.fuelPerM3, 3)} L/m³`, subLabel: "Production intensity", tone: "warning" }} icon={<Fuel className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <MetricBar title="Production by Shift" data={summary.productionByShift} />
        <MetricBar title="Production by Site" data={summary.productionBySite} />
        <MetricBar title="Production by Lead" data={summary.productionByLead} />
        <ChartFrame title="Production vs Fuel Consumed">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={summary.productionFuelTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7ebee" />
              <XAxis dataKey="name" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip formatter={(value: number) => formatNumber(value, 1)} />
              <Legend />
              <Area yAxisId="left" dataKey="productionM3" name="Production m³" stroke="#1f9d74" fill="#1f9d74" fillOpacity={0.18} />
              <Area yAxisId="right" dataKey="fuelConsumedLitres" name="Fuel L" stroke="#a56414" fill="#a56414" fillOpacity={0.18} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Production by Vehicle">
          <DataTable columns={vehicleColumns} rows={summary.productionByVehicle.slice(0, 30)} getRowKey={(row) => row.vehicle.id} />
        </Panel>
        <Panel title="Trips per Vehicle">
          <DataTable columns={vehicleColumns} rows={summary.tripsPerVehicle.slice(0, 30)} getRowKey={(row) => row.vehicle.id} />
        </Panel>
      </div>
    </div>
  );
}

function MetricBar({
  title,
  data,
}: {
  title: string;
  data: Array<{ name: string; productionM3: number; trips?: number; fuelConsumedLitres: number }>;
}) {
  return (
    <ChartFrame title={title}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e7ebee" />
          <XAxis dataKey="name" interval={0} angle={-20} textAnchor="end" height={70} />
          <YAxis />
          <Tooltip formatter={(value: number) => formatNumber(value, 1)} />
          <Legend />
          <Bar dataKey="productionM3" name="Production m³" fill="#1f9d74" radius={[4, 4, 0, 0]} />
          <Bar dataKey="trips" name="Trips" fill="#2f80ed" radius={[4, 4, 0, 0]} />
          <Bar dataKey="fuelConsumedLitres" name="Fuel L" fill="#a56414" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

import { X } from "lucide-react";
import { useMemo, useState } from "react";
import type { Alert } from "../../types/fleet";
import type { FleetVehicleRow } from "../../services/fleetService";
import { formatDate, formatDateTime, formatEfficiency, formatHours, formatLitres, formatM3, formatNumber, formatPercent, titleCase } from "../../utils/formatters";
import { Button } from "../ui/Button";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { LoadingState } from "../ui/LoadingState";
import { Panel } from "../ui/Panel";
import { StatusBadge } from "../ui/StatusBadge";

interface FleetDashboardProps {
  rows: FleetVehicleRow[];
  alerts: Alert[];
  loading: boolean;
}

export function FleetDashboard({ rows, alerts, loading }: FleetDashboardProps) {
  const [selected, setSelected] = useState<FleetVehicleRow | null>(null);
  const statusSummary = useMemo(
    () => ["running", "idle", "stopped", "offline", "maintenance"].map((status) => ({
      status,
      count: rows.filter((row) => row.vehicle.status === status).length,
    })),
    [rows],
  );

  if (loading) {
    return <LoadingState />;
  }

  const columns: DataTableColumn<FleetVehicleRow>[] = [
    { header: "Vehicle", render: (row) => <span className="font-semibold text-coal-900">{row.vehicle.vehicleNumber}</span> },
    { header: "Site", render: (row) => row.siteName },
    { header: "Category", render: (row) => row.vehicle.assetCategory },
    { header: "Type", render: (row) => row.vehicle.assetType ?? "Unavailable" },
    { header: "OEM", render: (row) => row.vehicle.company },
    { header: "Model", render: (row) => row.vehicle.modelNumber ?? "Unavailable" },
    { header: "Status", render: (row) => <StatusBadge status={row.vehicle.status} /> },
    { header: "Running", render: (row) => formatHours(row.runningHours), align: "right" },
    { header: "Idle", render: (row) => formatHours(row.idleHours), align: "right" },
    { header: "Fuel", render: (row) => formatLitres(row.fuelConsumedLitres), align: "right" },
    { header: "Efficiency", render: (row) => formatEfficiency(row.efficiency, row.vehicle.fuelMeasurementUnit), align: "right" },
    { header: "Tracker", render: (row) => <StatusBadge status={row.trackerHealth} /> },
    { header: "Last Data", render: (row) => formatDateTime(row.lastDataReceived) },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
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

      <Panel title="Vehicle List" subtitle="Click a row to inspect vehicle profile, selected period summary, alerts, tracker sync, and raw source metrics.">
        <DataTable columns={columns} rows={rows} getRowKey={(row) => row.vehicle.id} onRowClick={setSelected} maxHeight="max-h-[620px]" />
      </Panel>

      {selected && (
        <VehicleDetailDrawer
          row={selected}
          alerts={alerts.filter((alert) => alert.vehicleId === selected.vehicle.id).slice(0, 8)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

interface VehicleDetailDrawerProps {
  row: FleetVehicleRow;
  alerts: Alert[];
  onClose: () => void;
}

function VehicleDetailDrawer({ row, alerts, onClose }: VehicleDetailDrawerProps) {
  const variance = row.varianceFromNorm ?? 0;

  return (
    <div className="fixed inset-0 z-50 bg-coal-950/45" onClick={onClose}>
      <aside
        className="absolute right-0 top-0 h-full w-full max-w-xl overflow-y-auto bg-white shadow-command"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-coal-200 bg-white px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-coal-500">Vehicle Detail</p>
            <h2 className="mt-1 text-xl font-semibold text-coal-950">{row.vehicle.vehicleNumber}</h2>
          </div>
          <Button icon={<X className="h-4 w-4" />} variant="ghost" onClick={onClose} aria-label="Close detail drawer" />
        </div>
        <div className="space-y-5 p-5">
          <Panel title="Vehicle Profile">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Detail label="Site" value={row.siteName} />
              <Detail label="Company" value={row.vehicle.company} />
              <Detail label="Model" value={row.vehicle.modelNumber ?? "Not available"} />
              <Detail label="Type" value={row.vehicle.assetType ?? "Not available"} />
              <Detail label="Category" value={row.vehicle.assetCategory} />
              <Detail label="Types of work" value={row.vehicle.contractType ?? "Not available"} />
              <Detail label="Commissioned" value={formatDate(row.vehicle.commissioningDate)} />
              <Detail label="Tracker" value={`${row.vehicle.trackerProvider} / ${row.vehicle.trackerId}`} />
            </dl>
          </Panel>

          <Panel title="Selected Period Summary">
            <div className="grid gap-3 sm:grid-cols-2">
              <Metric label="Fuel" value={formatLitres(row.fuelConsumedLitres)} />
              <Metric label="Running Hours" value={formatHours(row.runningHours)} />
              <Metric label="Idle Hours" value={formatHours(row.idleHours)} />
              <Metric label="Trips" value={row.trips ? formatNumber(row.trips) : "Unavailable"} />
              <Metric label="Production" value={row.productionM3 ? formatM3(row.productionM3) : "Unavailable"} />
              <Metric label="Efficiency" value={formatEfficiency(row.efficiency, row.vehicle.fuelMeasurementUnit)} />
              <Metric label="Fuel per m³" value={`${formatNumber(row.fuelPerM3, 3)} L/m³`} />
              <Metric label="Norm Variance" value={formatPercent(variance)} />
            </div>
          </Panel>

          <Panel title="Recent Alerts">
            {alerts.length ? (
              <div className="space-y-3">
                {alerts.map((alert) => (
                  <div key={alert.id} className="rounded-md border border-coal-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-coal-900">{titleCase(alert.type)}</p>
                      <StatusBadge status={alert.severity} />
                    </div>
                    <p className="mt-2 text-sm text-coal-600">{alert.message}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-coal-500">No active alerts for this vehicle.</p>
            )}
          </Panel>

          <Panel title="Last Sync Information">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Detail label="Tracker Health" value={titleCase(row.trackerHealth)} />
              <Detail label="Last Data Received" value={formatDateTime(row.lastDataReceived)} />
              <Detail label="Latest Shift" value={row.latestRecord?.shift ? `Shift ${row.latestRecord.shift}` : "-"} />
              <Detail label="Latest Status" value={row.latestRecord?.status ? titleCase(row.latestRecord.status) : "-"} />
            </dl>
          </Panel>

          <Panel title="Raw Source Metrics">
            <div className="grid gap-2 text-sm">
              {Object.entries(row.latestRecord?.rawMetrics ?? {}).map(([key, value]) => (
                <div key={key} className="flex flex-col gap-1 rounded-md border border-coal-200 p-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-medium text-coal-700">{key}</span>
                  <span className="break-words text-coal-900">{String(value ?? "-")}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </aside>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-coal-500">{label}</dt>
      <dd className="mt-1 break-words font-medium text-coal-900">{value}</dd>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-coal-200 bg-coal-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-coal-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-coal-950">{value}</p>
    </div>
  );
}

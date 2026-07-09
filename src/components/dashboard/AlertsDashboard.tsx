import { CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Alert, AlertSeverity } from "../../types/fleet";
import type { FleetVehicleRow } from "../../services/fleetService";
import { alertService } from "../../services/alertService";
import { formatDateTime, formatNumber, titleCase } from "../../utils/formatters";
import { Button } from "../ui/Button";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { LoadingState } from "../ui/LoadingState";
import { Panel } from "../ui/Panel";
import { StatusBadge } from "../ui/StatusBadge";

interface AlertsDashboardProps {
  alerts: Alert[];
  fleetRows: FleetVehicleRow[];
  loading: boolean;
}

export function AlertsDashboard({ alerts, fleetRows, loading }: AlertsDashboardProps) {
  const [severity, setSeverity] = useState<AlertSeverity | "All">("All");
  const [alertType, setAlertType] = useState("All");
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set());
  const vehicleMap = useMemo(() => new Map(fleetRows.map((row) => [row.vehicle.id, row])), [fleetRows]);
  const alertTypes = useMemo(() => [...new Set(alerts.map((alert) => alert.type))].sort(), [alerts]);
  const filteredAlerts = alerts.filter((alert) => {
    if (severity !== "All" && alert.severity !== severity) return false;
    if (alertType !== "All" && alert.type !== alertType) return false;
    return true;
  });
  const summary = ["critical", "warning", "info"].map((item) => ({
    severity: item,
    count: alerts.filter((alert) => alert.severity === item).length,
  }));

  if (loading) {
    return <LoadingState />;
  }

  const columns: DataTableColumn<Alert>[] = [
    { header: "Type", render: (row) => titleCase(row.type), className: "min-w-44" },
    { header: "Severity", render: (row) => <StatusBadge status={row.severity} /> },
    { header: "Vehicle", render: (row) => vehicleMap.get(row.vehicleId)?.vehicle.vehicleNumber ?? row.vehicleId },
    { header: "Site", render: (row) => vehicleMap.get(row.vehicleId)?.siteName ?? row.siteId },
    {
      header: "Company / Model",
      render: (row) => {
        const vehicle = vehicleMap.get(row.vehicleId)?.vehicle;
        return vehicle ? `${vehicle.company} ${vehicle.modelNumber}` : "-";
      },
    },
    { header: "Message", render: (row) => row.message, className: "min-w-80" },
    { header: "Created", render: (row) => formatDateTime(row.createdAt) },
    { header: "Status", render: (row) => <StatusBadge status={row.acknowledged || acknowledgedIds.has(row.id) ? "acknowledged" : "unacknowledged"} /> },
    {
      header: "Action",
      render: (row) => (
        <Button
          size="sm"
          icon={<CheckCircle2 className="h-4 w-4" />}
          disabled={row.acknowledged || acknowledgedIds.has(row.id)}
          onClick={(event) => {
            event.stopPropagation();
            alertService.acknowledgeAlert(row.id).then(() => {
              setAcknowledgedIds((current) => new Set(current).add(row.id));
            });
          }}
        >
          Ack
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {summary.map((item) => (
          <Panel key={item.severity}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-coal-500">{titleCase(item.severity)}</p>
                <p className="mt-2 text-3xl font-semibold text-coal-950">{formatNumber(item.count)}</p>
              </div>
              <StatusBadge status={item.severity} />
            </div>
          </Panel>
        ))}
      </div>

      <Panel
        title="Alerts and Exceptions"
        subtitle="Generated from Phase 1 thresholds in constants/thresholds.ts."
        actions={
          <div className="flex flex-wrap gap-2">
            <select className="h-9 rounded-md border border-coal-200 bg-white px-3 text-sm" value={severity} onChange={(event) => setSeverity(event.target.value as AlertSeverity | "All")}>
              <option value="All">All Severities</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
            <select className="h-9 rounded-md border border-coal-200 bg-white px-3 text-sm" value={alertType} onChange={(event) => setAlertType(event.target.value)}>
              <option value="All">All Alert Types</option>
              {alertTypes.map((type) => (
                <option key={type} value={type}>
                  {titleCase(type)}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <DataTable columns={columns} rows={filteredAlerts} getRowKey={(row) => row.id} maxHeight="max-h-[680px]" />
      </Panel>
    </div>
  );
}

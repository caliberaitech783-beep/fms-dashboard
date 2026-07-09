import { Database, PlugZap } from "lucide-react";
import type { IntegrationSource } from "../../types/fleet";
import { formatDateTime, formatNumber } from "../../utils/formatters";
import { KpiCard } from "../cards/KpiCard";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { LoadingState } from "../ui/LoadingState";
import { Panel } from "../ui/Panel";
import { StatusBadge } from "../ui/StatusBadge";

interface IntegrationsDashboardProps {
  integrations: IntegrationSource[];
  loading: boolean;
}

export function IntegrationsDashboard({ integrations, loading }: IntegrationsDashboardProps) {
  if (loading) {
    return <LoadingState />;
  }

  const columns: DataTableColumn<IntegrationSource>[] = [
    { header: "OEM Source", render: (row) => <span className="font-semibold text-coal-900">{row.company}</span> },
    { header: "Source Type", render: (row) => row.sourceType },
    { header: "Connection Status", render: (row) => <StatusBadge status={row.status} /> },
    { header: "Last Sync", render: (row) => formatDateTime(row.lastSyncAt) },
    { header: "Next Sync", render: (row) => formatDateTime(row.nextSyncAt) },
    { header: "Records Today", render: (row) => formatNumber(row.recordsSyncedToday), align: "right" },
    { header: "Error", render: (row) => row.errorMessage ?? "-", className: "min-w-80" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard metric={{ label: "OEM Sources", value: formatNumber(integrations.length), subLabel: "Configured connectors", tone: "info" }} icon={<Database className="h-5 w-5" />} />
        <KpiCard metric={{ label: "Connected", value: formatNumber(integrations.filter((item) => item.status === "connected").length), subLabel: "Healthy feeds", tone: "good" }} icon={<PlugZap className="h-5 w-5" />} />
        <KpiCard metric={{ label: "Delayed / Failed", value: formatNumber(integrations.filter((item) => ["delayed", "failed"].includes(item.status)).length), subLabel: "Needs action", tone: "warning" }} icon={<PlugZap className="h-5 w-5" />} />
        <KpiCard metric={{ label: "Records Synced Today", value: formatNumber(integrations.reduce((sum, item) => sum + item.recordsSyncedToday, 0)), subLabel: "All OEM sources", tone: "neutral" }} icon={<Database className="h-5 w-5" />} />
      </div>

      <Panel title="Tracker Integration Health" subtitle="Adapter stubs exist for Volvo, Scania, LiuGong, Eicher, Tata Hitachi, Case, and Komatsu.">
        <DataTable columns={columns} rows={integrations} getRowKey={(row) => row.id} />
      </Panel>
    </div>
  );
}

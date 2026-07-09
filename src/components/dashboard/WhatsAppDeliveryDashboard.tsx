import { Send } from "lucide-react";
import { useState } from "react";
import type { DashboardFilters, WhatsAppDeliveryLog, WhatsAppReportSchedule } from "../../types/fleet";
import { whatsappReportService } from "../../services/whatsappReportService";
import { formatDateTime, titleCase } from "../../utils/formatters";
import { Button } from "../ui/Button";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { LoadingState } from "../ui/LoadingState";
import { Panel } from "../ui/Panel";
import { StatusBadge } from "../ui/StatusBadge";

interface WhatsAppDeliveryDashboardProps {
  schedules: WhatsAppReportSchedule[];
  logs: WhatsAppDeliveryLog[];
  filters: DashboardFilters;
  loading: boolean;
}

export function WhatsAppDeliveryDashboard({
  schedules,
  logs,
  filters,
  loading,
}: WhatsAppDeliveryDashboardProps) {
  const [message, setMessage] = useState<string | null>(null);

  if (loading) {
    return <LoadingState />;
  }

  const scheduleColumns: DataTableColumn<WhatsAppReportSchedule>[] = [
    { header: "Report Type", render: (row) => row.reportType },
    { header: "Site", render: (row) => row.siteId },
    { header: "Shift", render: (row) => row.shift },
    { header: "Recipients", render: (row) => row.recipients.join(", "), className: "min-w-56" },
    { header: "Frequency", render: (row) => titleCase(row.frequency) },
    { header: "Enabled", render: (row) => <StatusBadge status={row.enabled ? "connected" : "stopped"} /> },
  ];

  const logColumns: DataTableColumn<WhatsAppDeliveryLog>[] = [
    { header: "Report", render: (row) => row.reportName, className: "min-w-56" },
    { header: "PDF File", render: (row) => row.pdfFileName, className: "min-w-56" },
    { header: "Recipient", render: (row) => `${row.recipientName} (${row.recipientNumber})`, className: "min-w-64" },
    { header: "Sent Time", render: (row) => formatDateTime(row.sentAt) },
    { header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    { header: "Failure Reason", render: (row) => row.failureReason ?? "-", className: "min-w-64" },
    { header: "Retry", render: (row) => row.retryCount, align: "right" },
  ];

  return (
    <div className="space-y-6">
      <Panel
        title="WhatsApp PDF Report Delivery Placeholder"
        subtitle="Real WhatsApp Business API integration is intentionally deferred. Service methods and environment variables are ready for Phase 2."
        actions={
          <Button
            icon={<Send className="h-4 w-4" />}
            variant="primary"
            onClick={() => {
              whatsappReportService.generateReportPdf("Shift-wise Fuel Report", filters)
                .then((pdf) => whatsappReportService.sendReportViaWhatsApp(pdf, ["Mine Manager"]))
                .then((result) => setMessage(result.queued ? "Test report queued through placeholder service." : "Test report was not queued."));
            }}
          >
            Send Test Report
          </Button>
        }
      >
        {message && (
          <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            {message}
          </div>
        )}
        <DataTable columns={scheduleColumns} rows={schedules} getRowKey={(row) => row.id} />
      </Panel>

      <Panel title="WhatsApp PDF Delivery Log">
        <DataTable columns={logColumns} rows={logs} getRowKey={(row) => row.id} />
      </Panel>
    </div>
  );
}

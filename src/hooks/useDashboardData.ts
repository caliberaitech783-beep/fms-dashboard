import { useEffect, useState } from "react";
import type { DashboardOverview } from "../types/dashboard";
import type { Alert, DashboardFilters, IntegrationSource, Report, WhatsAppDeliveryLog, WhatsAppReportSchedule } from "../types/fleet";
import type { FleetVehicleRow } from "../services/fleetService";
import { dashboardService } from "../services/dashboardService";
import { fleetService } from "../services/fleetService";
import { alertService } from "../services/alertService";
import { integrationService } from "../services/integrationService";
import { reportService } from "../services/reportService";
import { whatsappReportService } from "../services/whatsappReportService";

export interface DashboardDataState {
  overview: DashboardOverview | null;
  fleetRows: FleetVehicleRow[];
  alerts: Alert[];
  integrations: IntegrationSource[];
  reports: Report[];
  whatsAppSchedules: WhatsAppReportSchedule[];
  whatsAppDeliveryLogs: WhatsAppDeliveryLog[];
  loading: boolean;
  error: string | null;
}

export function useDashboardData(filters: DashboardFilters, refreshKey: number, section: string = "management") {
  const [state, setState] = useState<DashboardDataState>({
    overview: null,
    fleetRows: [],
    alerts: [],
    integrations: [],
    reports: [],
    whatsAppSchedules: [],
    whatsAppDeliveryLogs: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    setState((current) => ({ ...current, loading: true, error: null }));

    const update = (patch: Partial<DashboardDataState>) => {
      if (mounted) setState((current) => ({ ...current, ...patch }));
    };
    const load = async () => {
      switch (section) {
        case "management":
          update({ overview: await dashboardService.getOverview(filters, (overview) => update({ overview }), controller.signal) });
          break;
        case "fleet": {
          const [fleetRows, alerts] = await Promise.all([fleetService.getVehicles(filters), alertService.getAlerts(filters)]);
          update({ fleetRows, alerts });
          break;
        }
        case "master-data": update({ fleetRows: await fleetService.getVehicles(filters) }); break;
        case "reports": update({ reports: await reportService.getReports() }); break;
        case "integrations": update({ integrations: await integrationService.getIntegrationStatus() }); break;
        case "whatsapp": {
          const [whatsAppSchedules, whatsAppDeliveryLogs] = await Promise.all([whatsappReportService.getSchedules(), whatsappReportService.getDeliveryLogs()]);
          update({ whatsAppSchedules, whatsAppDeliveryLogs });
          break;
        }
      }
      update({ loading: false });
    };
    // Coalesce quick filter changes before starting expensive OEM requests.
    const timer = window.setTimeout(() => { void load()
      .catch((error: Error) => {
        if (!mounted) {
          return;
        }

        setState((current) => ({
          ...current,
          loading: false,
          error: error.message,
        }));
      }); }, 180);

    return () => {
      window.clearTimeout(timer);
      mounted = false;
      controller.abort();
    };
  }, [filters, refreshKey, section]);

  return state;
}

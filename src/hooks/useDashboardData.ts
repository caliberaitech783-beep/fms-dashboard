import { useEffect, useState } from "react";
import type { DashboardOverview } from "../types/dashboard";
import type { Alert, DashboardFilters, IntegrationSource, Report, WhatsAppDeliveryLog, WhatsAppReportSchedule } from "../types/fleet";
import type { FleetVehicleRow } from "../services/fleetService";
import { dashboardService } from "../services/dashboardService";
import { fleetService } from "../services/fleetService";
import { fuelService } from "../services/fuelService";
import { productionService } from "../services/productionService";
import { alertService } from "../services/alertService";
import { integrationService } from "../services/integrationService";
import { reportService } from "../services/reportService";
import { whatsappReportService } from "../services/whatsappReportService";

export interface DashboardDataState {
  overview: DashboardOverview | null;
  fleetRows: FleetVehicleRow[];
  fuelSummary: Awaited<ReturnType<typeof fuelService.getFuelSummary>> | null;
  productionSummary: Awaited<ReturnType<typeof productionService.getProductionSummary>> | null;
  alerts: Alert[];
  integrations: IntegrationSource[];
  reports: Report[];
  whatsAppSchedules: WhatsAppReportSchedule[];
  whatsAppDeliveryLogs: WhatsAppDeliveryLog[];
  loading: boolean;
  error: string | null;
}

export function useDashboardData(filters: DashboardFilters, refreshKey: number) {
  const [state, setState] = useState<DashboardDataState>({
    overview: null,
    fleetRows: [],
    fuelSummary: null,
    productionSummary: null,
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

    setState((current) => ({ ...current, loading: true, error: null }));

    Promise.all([
      dashboardService.getOverview(filters),
      fleetService.getVehicles(filters),
      fuelService.getFuelSummary(filters),
      productionService.getProductionSummary(filters),
      alertService.getAlerts(filters),
      integrationService.getIntegrationStatus(),
      reportService.getReports(),
      whatsappReportService.getSchedules(),
      whatsappReportService.getDeliveryLogs(),
    ])
      .then(([overview, fleetRows, fuelSummary, productionSummary, alerts, integrations, reports, whatsAppSchedules, whatsAppDeliveryLogs]) => {
        if (!mounted) {
          return;
        }

        setState({
          overview,
          fleetRows,
          fuelSummary,
          productionSummary,
          alerts,
          integrations,
          reports,
          whatsAppSchedules,
          whatsAppDeliveryLogs,
          loading: false,
          error: null,
        });
      })
      .catch((error: Error) => {
        if (!mounted) {
          return;
        }

        setState((current) => ({
          ...current,
          loading: false,
          error: error.message,
        }));
      });

    return () => {
      mounted = false;
    };
  }, [filters, refreshKey]);

  return state;
}

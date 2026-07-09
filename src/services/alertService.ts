import type { Alert, DashboardFilters } from "../types/fleet";
import { ALERT_THRESHOLDS } from "../constants/thresholds";
import { generateAlerts } from "../utils/calculations";
import { getFilteredPortalData } from "./dataAccess";

export const alertService = {
  async getAlerts(filters: DashboardFilters): Promise<Alert[]> {
    const { filteredVehicles, filteredRecords } = await getFilteredPortalData(filters);
    return generateAlerts(filteredRecords, filteredVehicles, ALERT_THRESHOLDS);
  },
  async acknowledgeAlert(alertId: string): Promise<{ ok: true; alertId: string }> {
    // TODO: Persist acknowledgements and audit actor/timestamp once backend storage is available.
    return { ok: true, alertId };
  },
};

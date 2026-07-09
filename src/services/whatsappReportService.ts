import type { DashboardFilters, WhatsAppDeliveryLog } from "../types/fleet";
import { apiClient } from "./apiClient";

export const whatsappReportService = {
  async generateReportPdf(reportType: string, filters: DashboardFilters): Promise<{ fileName: string; filters: DashboardFilters }> {
    // TODO: Render the selected report to PDF before sending through WhatsApp Business API.
    return {
      fileName: `${reportType.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${filters.dateTo}.pdf`,
      filters,
    };
  },

  async sendReportViaWhatsApp(pdf: { fileName: string }, recipients: string[]): Promise<{ queued: boolean; recipients: string[] }> {
    // TODO: Integrate WHATSAPP_BUSINESS_API_URL, WHATSAPP_ACCESS_TOKEN, and WHATSAPP_SENDER_NUMBER.
    console.info(`WhatsApp report send queued for ${pdf.fileName}.`);
    return { queued: true, recipients };
  },

  async getSchedules() {
    return apiClient.fleet.fetchWhatsAppSchedules();
  },

  async getDeliveryLogs(): Promise<WhatsAppDeliveryLog[]> {
    return apiClient.fleet.fetchWhatsAppDeliveryLogs();
  },
};

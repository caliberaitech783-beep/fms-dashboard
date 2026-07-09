import { apiClient } from "./apiClient";

export const integrationService = {
  async getIntegrationStatus() {
    return apiClient.fleet.fetchIntegrations();
  },
};

import { activeFleetAdapter } from "./adapters";

export const apiClient = {
  fleet: activeFleetAdapter,
};

// Future API integration point:
// Replace activeFleetAdapter with a composed adapter that calls OEM-specific APIs.
// Credentials and base URLs should be read from Vite env variables, for example:
// import.meta.env.VITE_VOLVO_API_BASE_URL and import.meta.env.VITE_VOLVO_API_KEY.
// External payloads must be normalized into the internal Vehicle and FleetTelemetryRecord
// types before they reach services or UI components.

import type { Site } from "../types/fleet";

// Approved dashboard names; IDs remain compatible with existing OEM mappings.
export const DASHBOARD_SITES: Site[] = [
  { id: "site-wcl-sasti-ocm", name: "Sasti OC", location: "WCL", contractType: "Coal", active: true },
  { id: "site-wcl-gauri-pauni", name: "Gauri Pauni OC (2nd)", location: "WCL", contractType: "Coal", active: true },
  { id: "site-wcl-dhoptala-ocm", name: "Dhoptala OC (2nd)", location: "WCL", contractType: "Coal", active: true },
  { id: "site-wcl-majri-ocm", name: "Majri OC", location: "WCL", contractType: "Coal", active: true },
  { id: "site-ncl-dch-west", name: "Dudhichua OC", location: "NCL", contractType: "OB", active: true },
  { id: "site-ncl-dch-east", name: "Dudhichua East OC", location: "NCL", contractType: "OB", active: true },
  { id: "site-wcl-lalpeth-ocm", name: "Lalpeth OC", location: "WCL", contractType: "Coal", active: true },
  { id: "site-ncl-jayant-1", name: "Jayant OC", location: "NCL", contractType: "Coal", active: true },
];
export function dashboardSiteId(id: string | null) {
  return id === "site-ncl-jayant-2" ? "site-ncl-jayant-1" : id;
}


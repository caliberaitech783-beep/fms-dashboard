import { getAuthSession } from "../auth/sessionService";
export interface EquipmentRecord {
  id: string;
  equipment: string;
  serialNumber: string;
  category: string;
  model: string;
  oem: string;
  location: string;
  roadStatus: string;
}
const base = (import.meta.env.VITE_AUTH_API_BASE_URL || "https://cmll-fms-api-b3-783.azurewebsites.net/api").replace(/\/$/, "");
async function request(rows?: EquipmentRecord[]) {
  const token = getAuthSession()?.token;
  if (!token) throw new Error("Please sign in to access Equipment Master.");
  const response = await fetch(`${base}/equipment-master`, {
    method: rows ? "POST" : "GET", signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(rows ? { body: JSON.stringify({ rows }) } : {}),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || "Equipment Master is unavailable.");
  return body;
}
export const equipmentMasterService = {
  async list(): Promise<EquipmentRecord[]> { return (await request()).rows; },
  async save(rows: EquipmentRecord[]): Promise<void> { await request(rows); },
};

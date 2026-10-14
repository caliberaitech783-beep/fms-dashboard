import { getAuthSession } from "../auth/sessionService";
export interface EquipmentRecord {
  id: string;
  driver?: string;
  equipment: string;
  serialNumber: string;
  category: string;
  model: string;
  oem: string;
  location: string;
  roadStatus: string;
}
const base = (import.meta.env.VITE_AUTH_API_BASE_URL || "https://cmll-fms-api-b3-783.azurewebsites.net/api").replace(/\/$/, "");
async function request(body?: object, view = "") {
  const token = getAuthSession()?.token;
  if (!token) throw new Error("Please sign in to access Equipment Master.");
  const response = await fetch(`${base}/equipment-master${view}`, {
    method: body ? "POST" : "GET", signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Equipment Master is unavailable.");
  return result;
}
export const equipmentMasterService = {
  async sites(): Promise<{ id: string; name: string }[]> { return (await request(undefined, "/sites")).sites; },
  async list(): Promise<EquipmentRecord[]> { return (await request()).rows; },
  async sync(): Promise<{ updated: number }> { return request({ action: "sync" }); },
  async remove(ids: string[]): Promise<{ deleted: number }> { return request({ action: "delete", ids }); },
  async save(rows: EquipmentRecord[]): Promise<void> { await request({ rows }); },
};

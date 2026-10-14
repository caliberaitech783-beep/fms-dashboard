const { listEquipment } = require("../lib/vehicles/equipmentMasterStore");
const { selectEquipment, equipmentSite } = require("../lib/vehicles/equipmentRoster");
async function subscribedFleet() {
 return selectEquipment(await listEquipment(), "LiuGong", service.fleet.map(m=>m.serialNumber)).map(row=>({
  serialNumber:row.serialNumber,doorNumber:row.equipment,model:row.model,
  productGroup:/truck|haul/i.test(row.category) || row.serialNumber.startsWith("LGI") ? "Mining Truck" : "Excavator",
  location: equipmentSite(row)?.id === "site-wcl-sasti-ocm" ? "Sasti" : row.location,
  siteId:equipmentSite(row)?.id || null,siteName:row.location,
 }));
}
const { app } = require("@azure/functions");
require("../lib/loadLocalEnv").loadLocalEnv();
const auth = require("../lib/authStore");
const service = require("../lib/liugong/service");
const store = require("../lib/liugong/store");
async function handler(request) {
  const origins = (process.env.ALLOWED_ORIGINS || "https://fms.cmll.in").split(",").map(s => s.trim());
  const origin = request.headers.get("origin");
  const headers = { "Access-Control-Allow-Origin": origins.includes(origin) ? origin : origins[0],
    "Access-Control-Allow-Headers": "Content-Type,Authorization", "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Cache-Control": "private, no-store", Vary: "Origin" };
  if (request.method === "OPTIONS") return { status: 204, headers };
  try {
    const token = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return { status: 401, headers, jsonBody: { message: "Authentication required." } };
    const payload = auth.verifyToken(token), actor = await auth.getUser(payload.sub);
    auth.assertTokenForUser(payload, actor);
    if (!["Super Admin", "Management", "Fleet Manager"].includes(actor.role)) return { status: 403, headers };
    const from = request.query.get("from"), to = request.query.get("to");
    const fleet = await subscribedFleet();
    const latest = from || to || !fleet.length ? null : await store.loadSnapshot(fleet[0].serialNumber);
    const jsonBody = from || to ? await service.report(from, to, store, fleet) : { vehicles: service.vehicles(fleet),
      integration: { id: "liugong-nbi", company: "LiuGong", sourceType: "API",
        status: latest && Date.now() - Date.parse(latest.fetchedAt) < 30 * 60000 ? "connected" : "delayed",
        lastSyncAt: latest?.fetchedAt || null, nextSyncAt: null, recordsSyncedToday: 0,
        errorMessage: latest ? "Daily totals; see each report row for coverage and last sync." : "Initial daily synchronization is pending." } };
    return { status: 200, headers, jsonBody };
  } catch (error) {
    return { status: error.statusCode || 502, headers, jsonBody: { message: "LiuGong data is unavailable. Check authentication and the selected date range." } };
  }
}
app.http("liugongFleet", { route: "integrations/liugong/vehicles", authLevel: "anonymous", methods: ["GET", "OPTIONS"], handler });
app.timer("liugongDailySync", { schedule: "0 */10 * * * *", runOnStartup: true,
  handler: async (_timer, context) => { try { context.log("LiuGong sync", await service.synchronize({fleet:await subscribedFleet()})); }
    catch { context.error("LiuGong synchronization failed; previous daily records retained."); } } });
module.exports = { handler };

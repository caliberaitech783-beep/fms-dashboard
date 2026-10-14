const { app } = require("@azure/functions");
const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");
const auth = require("../lib/authStore");
const { listVehicles } = require("../lib/vehicles/vehicleStore");
const { normalizeEquipment, importedEquipment } = require("../lib/vehicles/equipmentMaster");
let setupPromise;
async function getTable() {
  if (!setupPromise) setupPromise = (async () => {
    const connection = process.env.AzureWebJobsStorage || "";
    const table = connection === "UseDevelopmentStorage=true" || connection.startsWith("DefaultEndpointsProtocol=")
      ? TableClient.fromConnectionString(connection, "FmsEquipmentMaster")
      : new TableClient(`https://${process.env.STORAGE_ACCOUNT_NAME}.table.core.windows.net`, "FmsEquipmentMaster",
        new AzureNamedKeyCredential(process.env.STORAGE_ACCOUNT_NAME, process.env.STORAGE_ACCOUNT_KEY));
    await table.createTable().catch(error => { if (error.statusCode !== 409) throw error; });
    return table;
  })().catch(error => { setupPromise = null; throw error; });
  return setupPromise;
}
function response(request, status, jsonBody) {
  const origins = (process.env.ALLOWED_ORIGINS || "https://fms.cmll.in").split(",").map(value => value.trim());
  const origin = request.headers.get("origin");
  return { status, jsonBody, headers: {
    "Access-Control-Allow-Origin": origins.includes(origin) ? origin : origins[0],
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Cache-Control": "private, no-store", Vary: "Origin",
  } };
}
async function handle(request, context) {
  if (request.method === "OPTIONS") return response(request, 204, null);
  try {
    const token = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return response(request, 401, { message: "Authentication required." });
    const payload = auth.verifyToken(token);
    const actor = auth.assertTokenForUser(payload, await auth.getUser(payload.sub));
    if (!["Super Admin", "MIS User"].includes(actor.role)) return response(request, 403, { message: "Permission denied." });
    const table = await getTable();
    if (request.method === "GET") {
      const rows = new Map((await listVehicles()).map(row => { const record = importedEquipment(row); return [record.id, record]; }));
      for await (const entity of table.listEntities({ queryOptions: { filter: "PartitionKey eq 'EQUIPMENT'" } })) {
        const record = JSON.parse(entity.recordJson); rows.set(record.id, record);
      }
      return response(request, 200, { rows: [...rows.values()] });
    }
    const body = await request.json().catch(() => null);
    if (!Array.isArray(body?.rows) || !body.rows.length || body.rows.length > 2000) return response(request, 400, { message: "Supply between 1 and 2,000 equipment records." });
    const rows = body.rows.map(normalizeEquipment);
    if (new Set(rows.map(row => row.id)).size !== rows.length) return response(request, 400, { message: "The import contains duplicate serial numbers." });
    // Store page-specific master records; existing OEM mappings and reports are unaffected.
    for (let offset = 0; offset < rows.length; offset += 100) {
      await table.submitTransaction(rows.slice(offset, offset + 100).map(row => ["upsert", {
        partitionKey: "EQUIPMENT", rowKey: row.id, recordJson: JSON.stringify(row),
        updatedAt: new Date().toISOString(), updatedBy: actor.userId,
      }, "Replace"]));
    }
    return response(request, 200, { saved: rows.length });
  } catch (error) {
    context.error("Equipment master request failed", error.statusCode || "internal");
    return response(request, [400, 401, 403].includes(error.statusCode) ? error.statusCode : 500,
      { message: error.statusCode === 400 ? error.message : "Unable to load or save Equipment Master. Please retry." });
  }
}
app.http("equipmentMaster", { route: "equipment-master", authLevel: "anonymous", methods: ["GET", "POST", "OPTIONS"], handler: handle });

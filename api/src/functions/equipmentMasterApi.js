const { app } = require("@azure/functions");
const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");
const auth = require("../lib/authStore");
const { listVehicles } = require("../lib/vehicles/vehicleStore");
const { normalizeEquipment, mergeEquipment, syncEquipment } = require("../lib/vehicles/equipmentMaster");
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
    async function currentRows() {
      const imported = await listVehicles();
      const entities = [];
      for await (const entity of table.listEntities({ queryOptions: { filter: "PartitionKey eq 'EQUIPMENT'" } })) entities.push(entity);
      return { imported, rows: mergeEquipment(imported, entities) };
    }
    async function persist(entities) {
      for (let offset = 0; offset < entities.length; offset += 100) {
        await table.submitTransaction(entities.slice(offset, offset + 100).map(entity => ["upsert", {
          partitionKey: "EQUIPMENT", ...entity, updatedAt: new Date().toISOString(), updatedBy: actor.userId,
        }, "Replace"]));
      }
    }
    if (request.method === "GET") return response(request, 200, { rows: (await currentRows()).rows });
    const body = await request.json().catch(() => null);
    if (body?.action === "delete" || body?.action === "sync") {
      const { rows, imported } = await currentRows();
      if (body.action === "sync") {
        const changed = syncEquipment(rows, imported);
        await persist(changed.map(row => ({ rowKey: row.id, recordJson: JSON.stringify(row) })));
        return response(request, 200, { updated: changed.length });
      }
      if (!Array.isArray(body.ids) || !body.ids.length || body.ids.some(id => typeof id !== "string")) return response(request, 400, { message: "Select equipment to delete." });
      const ids = new Set(body.ids);
      const deleting = rows.filter(row => ids.has(row.id));
      // Tombstones prevent imported records reappearing; OEM source data is retained.
      await persist(deleting.map(row => ({ rowKey: row.id, deleted: true })));
      return response(request, 200, { deleted: deleting.length });
    }
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

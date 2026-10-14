const { createHash } = require("node:crypto");
const FIELDS = ["equipment", "serialNumber", "category", "model", "oem", "location", "roadStatus", "driver"];
const ROAD_STATUSES = ["On road", "Off road", "Unknown"];
function normalizeEquipment(input) {
  if (!input || typeof input !== "object") throw Object.assign(new Error("Invalid equipment record."), { statusCode: 400 });
  const row = Object.fromEntries(FIELDS.map(key => [key, String(input[key] ?? "").trim()]));
  if (!row.equipment || !row.serialNumber) throw Object.assign(new Error("Equipment / door number and serial number are required."), { statusCode: 400 });
  if (Object.values(row).some(value => value.length > 200)) throw Object.assign(new Error("Equipment fields must be 200 characters or fewer."), { statusCode: 400 });
  row.serialNumber = row.serialNumber.toUpperCase();
  row.roadStatus ||= "Unknown";
  if (!ROAD_STATUSES.includes(row.roadStatus)) throw Object.assign(new Error("Road status must be On road, Off road or Unknown."), { statusCode: 400 });
  row.id = createHash("sha256").update(row.serialNumber).digest("hex");
  return row;
}
function importedEquipment(row) {
  const source = row.sourceColumns || {};
  const serialNumber = row.vin || "";
  const record = {
    id: serialNumber ? createHash("sha256").update(serialNumber.trim().toUpperCase()).digest("hex") : `imported-${row.rowKey}`,
    driver: source.Driver || source["Driver Name"] || source.driverName || "",
    equipment: row.vehicleNumber || "", serialNumber, model: row.vehicleModel || "",
    location: row.siteName || row.rawSiteName || "", category: source.Category || source["Product Group"] || "",
    oem: source.OEM || source.Company || "", roadStatus: "Unknown",
  };
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, String(value)]));
}
function mergeEquipment(imported, entities) {
  const rows = new Map(imported.map(row => { const record = importedEquipment(row); return [record.id, record]; }));
  for (const entity of entities) {
    if (entity.deleted) rows.delete(entity.rowKey);
    else { const record = JSON.parse(entity.recordJson); rows.set(record.id, record); }
  }
  return [...rows.values()];
}
function syncEquipment(rows, imported) {
  const sources = new Map(imported.map(row => { const record = importedEquipment(row); return [record.id, record]; }));
  return rows.flatMap(row => {
    const source = sources.get(row.id);
    if (!source) return [];
    const next = { ...row, model: source.model || row.model, driver: source.driver || row.driver || "" };
    return next.model !== row.model || next.driver !== (row.driver || "") ? [next] : [];
  });
}
module.exports = { normalizeEquipment, importedEquipment, mergeEquipment, syncEquipment };

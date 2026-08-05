const path = require("node:path");
const { parseVehicleWorkbook } = require("../src/lib/vehicles/vehicleExcelImporter");
const { prepareImportedVehicle } = require("../src/lib/vehicles/vehicleMasterIntegration");
const { upsertVehicles } = require("../src/lib/vehicles/vehicleStore");

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filePath = args.find((value) => !value.startsWith("--"));
  if (!filePath) throw new Error("Usage: npm run vehicles:import -- <workbook.xlsx> [--dry-run]");
  const parsed = await parseVehicleWorkbook(path.resolve(filePath));
  const records = parsed.records.map(prepareImportedVehicle);
  const unmappedSites = [...new Set(records.filter((record) => !record.siteId).map((record) => record.rawSiteName))];
  if (dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      fileName: parsed.fileName,
      sheetName: parsed.sheetName,
      rows: records.length,
      unmappedSites,
    }, null, 2));
    return;
  }
  const result = await upsertVehicles(records, { sourceFileName: parsed.fileName });
  console.log(JSON.stringify({ ...result, unmappedSites }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

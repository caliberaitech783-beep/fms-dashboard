const fs = require("node:fs");
const path = require("node:path");
const { loadLocalEnv } = require("../src/lib/loadLocalEnv");
const { importConnectedFleetWorkbook } = require("../src/lib/scania/scaniaConnectedFleetImporter");

loadLocalEnv();

function loadEndpointSettings(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^#][^=]*?)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim().replace(/^['"]|['"]$/g, "");
    if ((key.endsWith("_URL") || key === "SCANIA_START_DATE") && value) {
      process.env[key] = value;
    }
  }
}

async function main() {
  const workbookPath = path.resolve(process.argv[2] || "");
  loadEndpointSettings(process.argv[3] ? path.resolve(process.argv[3]) : null);
  delete process.env.SCANIA_ACCESS_TOKEN;
  const result = await importConnectedFleetWorkbook({ workbookPath });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    message: String(error?.message || "Scania Connected Fleet import failed."),
    status: error?.statusCode || null,
    kind: error?.kind || null,
  })}\n`);
  process.exitCode = 1;
});

const fs = require("node:fs");
const path = require("node:path");

let loaded = false;

function unquote(value) {
  const normalized = String(value || "").trim();
  if (
    normalized.length >= 2
    && (
      (normalized.startsWith("\"") && normalized.endsWith("\""))
      || (normalized.startsWith("'") && normalized.endsWith("'"))
    )
  ) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function loadLocalEnv(filePath = path.resolve(__dirname, "..", "..", ".env")) {
  if (loaded || !fs.existsSync(filePath)) return;
  const contents = fs.readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#][^=]*?)\s*=\s*(.*)$/);
    if (!match) continue;
    const name = match[1].trim();
    if (!name || Object.prototype.hasOwnProperty.call(process.env, name)) continue;
    process.env[name] = unquote(match[2]);
  }
  loaded = true;
}

module.exports = {
  loadLocalEnv,
  unquote,
};

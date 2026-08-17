const [sourcePath, destinationPath, outputPath, reportPath] = process.argv.slice(2);

if (!sourcePath || !destinationPath || !outputPath || !reportPath) {
  throw new Error(
    "Usage: node merge-azure-app-settings.mjs <source> <destination> <output> <report>",
  );
}

const { readFile, writeFile } = await import("node:fs/promises");
const sourceSettings = JSON.parse(await readFile(sourcePath, "utf8"));
const destinationSettings = JSON.parse(await readFile(destinationPath, "utf8"));

const source = toMap(sourceSettings);
const destination = toMap(destinationSettings);
const merged = new Map(destination);
const flexIncompatibleSettingNames = new Set([
  "AZUREWEBJOBSDASHBOARD",
  "FUNCTIONS_WORKER_RUNTIME",
  "WEBSITE_CONTENTAZUREFILECONNECTIONSTRING",
  "WEBSITE_CONTENTSHARE",
  "WEBSITE_NODE_DEFAULT_VERSION",
]);
let copiedFromSource = 0;
let preservedAtDestination = 0;

for (const [name, value] of source) {
  const destinationValue = destination.get(name);
  if (isDestinationProtected(name) && hasValue(destinationValue)) {
    preservedAtDestination += 1;
    continue;
  }

  merged.set(name, value);
  copiedFromSource += 1;
}

const excludedForFlexConsumption = [];
for (const name of merged.keys()) {
  if (flexIncompatibleSettingNames.has(name.toUpperCase())) {
    merged.delete(name);
    excludedForFlexConsumption.push(name);
  }
}
excludedForFlexConsumption.sort((left, right) => left.localeCompare(right));

const output = Object.fromEntries(
  [...merged.entries()].sort(([left], [right]) => left.localeCompare(right)),
);
const report = {
  generatedAt: new Date().toISOString(),
  sourceSettingCount: source.size,
  destinationSettingCount: destination.size,
  mergedSettingCount: merged.size,
  copiedFromSource,
  preservedAtDestination,
  excludedForFlexConsumption,
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(
  `Prepared ${report.mergedSettingCount} settings: copied ${copiedFromSource} from the source, preserved ${preservedAtDestination} destination-specific values, and excluded ${excludedForFlexConsumption.length} Flex-incompatible platform values.`,
);

function toMap(settings) {
  if (!Array.isArray(settings)) {
    throw new Error("Azure app settings input must be an array.");
  }

  return new Map(
    settings
      .filter(
        (setting) =>
          setting &&
          typeof setting.name === "string" &&
          typeof setting.value === "string",
      )
      .map((setting) => [setting.name, setting.value]),
  );
}

function hasValue(value) {
  return typeof value === "string" && value.length > 0;
}

function isDestinationProtected(name) {
  const normalized = name.toUpperCase();
  const protectedPrefixes = [
    "APPINSIGHTS_",
    "APPLICATIONINSIGHTS_",
    "AZUREWEBJOBS",
    "CASE_",
    "DEPLOYMENT_STORAGE_",
    "FUNCTIONS_",
    "ORYX_",
    "SCM_",
    "WEBSITE_",
    "XDT_MICROSOFTAPPLICATIONINSIGHTS",
  ];
  const protectedNames = new Set(["ENABLE_ORYX_BUILD"]);

  return (
    protectedNames.has(normalized) ||
    protectedPrefixes.some((prefix) => normalized.startsWith(prefix))
  );
}

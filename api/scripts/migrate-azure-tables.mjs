import {
  TableClient,
  TableServiceClient,
  TableTransaction,
} from "@azure/data-tables";

const sourceConnectionString = process.env.SOURCE_CONNECTION_STRING;
const destinationConnectionString = process.env.DESTINATION_CONNECTION_STRING;
const reportPath = process.env.MIGRATION_REPORT_PATH;
const concurrency = parsePositiveInteger(process.env.MIGRATION_CONCURRENCY, 8);
const maxBatchCount = parsePositiveInteger(process.env.MIGRATION_BATCH_COUNT, 80);
const maxBatchBytes = parsePositiveInteger(
  process.env.MIGRATION_BATCH_BYTES,
  2_500_000,
);

if (!sourceConnectionString || !destinationConnectionString) {
  throw new Error(
    "SOURCE_CONNECTION_STRING and DESTINATION_CONNECTION_STRING are required.",
  );
}

if (!reportPath) {
  throw new Error("MIGRATION_REPORT_PATH is required.");
}

const excludedTablePrefixes = ["AzureFunctionsDiagnosticEvents"];
const sourceService = TableServiceClient.fromConnectionString(
  sourceConnectionString,
);
const destinationService = TableServiceClient.fromConnectionString(
  destinationConnectionString,
);

const tableNames = [];
for await (const table of sourceService.listTables()) {
  if (
    table.name &&
    !excludedTablePrefixes.some((prefix) => table.name.startsWith(prefix))
  ) {
    tableNames.push(table.name);
  }
}
tableNames.sort((left, right) => left.localeCompare(right));

if (tableNames.length === 0) {
  throw new Error("No application tables were found in the source storage account.");
}

console.log(`Found ${tableNames.length} application tables to migrate.`);

const report = {
  startedAt: new Date().toISOString(),
  excludedTablePrefixes,
  tables: [],
};

for (const tableName of tableNames) {
  const tableReport = await copyTable(tableName);
  report.tables.push(tableReport);
  await writeJson(reportPath, report);
  console.log(
    `${tableName}: copied ${tableReport.sourceEntities} entities; destination contains ${tableReport.destinationEntities}.`,
  );
}

report.completedAt = new Date().toISOString();
report.sourceEntities = report.tables.reduce(
  (total, table) => total + table.sourceEntities,
  0,
);
report.destinationEntities = report.tables.reduce(
  (total, table) => total + table.destinationEntities,
  0,
);
report.validated = report.tables.every((table) => table.validated);

await writeJson(reportPath, report);

if (!report.validated) {
  throw new Error(
    "Migration validation failed because one or more destination entity counts differ from the source.",
  );
}

console.log(
  `Validated ${report.tables.length} tables and ${report.sourceEntities} entities.`,
);

async function copyTable(tableName) {
  const startedAt = new Date().toISOString();
  const sourceClient = TableClient.fromConnectionString(
    sourceConnectionString,
    tableName,
    { disableTypeConversion: true },
  );
  const destinationClient = TableClient.fromConnectionString(
    destinationConnectionString,
    tableName,
  );

  await ensureTable(destinationClient);

  let sourceEntities = 0;
  let submittedOperations = 0;
  const pages = sourceClient.listEntities().byPage({ maxPageSize: 1000 });

  for await (const page of pages) {
    const partitionGroups = new Map();

    for (const sourceEntity of page) {
      const entity = sanitizeEntity(sourceEntity);
      sourceEntities += 1;

      const group = partitionGroups.get(entity.partitionKey) ?? [];
      group.push(entity);
      partitionGroups.set(entity.partitionKey, group);
    }

    const work = [];
    for (const entities of partitionGroups.values()) {
      for (const batch of splitIntoBatches(entities)) {
        work.push(async () => {
          await upsertBatch(destinationClient, batch);
          submittedOperations += batch.length;
        });
      }
    }

    await runWithConcurrency(work, concurrency);
  }

  if (submittedOperations !== sourceEntities) {
    throw new Error(
      `${tableName}: submitted ${submittedOperations} operations for ${sourceEntities} source entities.`,
    );
  }

  const destinationEntities = await countEntities(destinationClient);
  const validated = sourceEntities === destinationEntities;

  return {
    tableName,
    startedAt,
    completedAt: new Date().toISOString(),
    sourceEntities,
    destinationEntities,
    validated,
  };
}

async function ensureTable(client) {
  try {
    await withRetry(() => client.createTable());
  } catch (error) {
    if (statusCode(error) !== 409) {
      throw error;
    }
  }
}

function sanitizeEntity(sourceEntity) {
  const entity = {};

  for (const [key, value] of Object.entries(sourceEntity)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === "etag" ||
      normalizedKey === "odata.etag" ||
      normalizedKey === "timestamp"
    ) {
      continue;
    }
    entity[key] = value;
  }

  if (typeof entity.partitionKey !== "string" || typeof entity.rowKey !== "string") {
    throw new Error("Encountered an entity without string partitionKey and rowKey values.");
  }

  return entity;
}

function splitIntoBatches(entities) {
  const batches = [];
  let currentBatch = [];
  let currentBytes = 0;

  for (const entity of entities) {
    const entityBytes = approximateBytes(entity);
    const exceedsCount = currentBatch.length >= maxBatchCount;
    const exceedsBytes =
      currentBatch.length > 0 && currentBytes + entityBytes > maxBatchBytes;

    if (exceedsCount || exceedsBytes) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBytes = 0;
    }

    currentBatch.push(entity);
    currentBytes += entityBytes;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

async function upsertBatch(client, entities) {
  if (entities.length === 1) {
    await withRetry(() => client.upsertEntity(entities[0], "Replace"));
    return;
  }

  const transaction = new TableTransaction();
  for (const entity of entities) {
    transaction.upsertEntity(entity, "Replace");
  }

  try {
    await withRetry(() => client.submitTransaction(transaction.actions));
  } catch (error) {
    if (entities.length === 1) {
      throw error;
    }

    const midpoint = Math.ceil(entities.length / 2);
    await upsertBatch(client, entities.slice(0, midpoint));
    await upsertBatch(client, entities.slice(midpoint));
  }
}

async function countEntities(client) {
  let count = 0;
  for await (const page of client.listEntities({
    queryOptions: { select: ["PartitionKey", "RowKey"] },
  }).byPage({ maxPageSize: 1000 })) {
    count += page.length;
  }
  return count;
}

async function runWithConcurrency(work, limit) {
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < work.length) {
      const index = nextIndex;
      nextIndex += 1;
      await work[index]();
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, Math.max(work.length, 1)) },
    () => worker(),
  );
  await Promise.all(workers);
}

async function withRetry(operation, attempts = 7) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const status = statusCode(error);
      const retryable =
        status === 408 ||
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504;

      if (!retryable || attempt === attempts) {
        throw error;
      }

      const delayMs = Math.min(30_000, 750 * 2 ** (attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

function statusCode(error) {
  return Number(error?.statusCode ?? error?.status ?? 0);
}

function approximateBytes(entity) {
  return Buffer.byteLength(
    JSON.stringify(entity, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function writeJson(path, value) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

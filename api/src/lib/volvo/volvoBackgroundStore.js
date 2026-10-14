const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");
const { createHash, randomUUID } = require("node:crypto");
let ready;
async function table() {
  if (!ready) ready = (async () => {
    const connection = process.env.AzureWebJobsStorage || "";
    const client = connection.startsWith("DefaultEndpointsProtocol=") || connection === "UseDevelopmentStorage=true"
      ? TableClient.fromConnectionString(connection, "VolvoBackground")
      : new TableClient(`https://${process.env.STORAGE_ACCOUNT_NAME}.table.core.windows.net`, "VolvoBackground", new AzureNamedKeyCredential(process.env.STORAGE_ACCOUNT_NAME, process.env.STORAGE_ACCOUNT_KEY));
    await client.createTable().catch(e => { if (e.statusCode !== 409) throw e; });
    return client;
  })().catch(e => { ready = null; throw e; });
  return ready;
}
const hash = value => createHash("sha256").update(value).digest("hex");
async function get(partitionKey, rowKey) {
  try { return await (await table()).getEntity(partitionKey, rowKey); }
  catch (e) { if (e.statusCode === 404) return null; throw e; }
}
async function create(entity) {
  try { await (await table()).createEntity(entity); return true; }
  catch (e) { if (e.statusCode === 409) return false; throw e; }
}
async function replace(entity, etag) {
  try { await (await table()).updateEntity(entity, "Replace", { etag }); return true; }
  catch (e) { if (e.statusCode === 412 || e.statusCode === 404) return false; throw e; }
}
async function read(key) {
  const partition = hash(key), manifest = await get(partition, "manifest");
  if (!manifest) return null;
  const parts = [];
  for (let i = 0; i < manifest.count; i++) {
    const part = await get(partition, `${manifest.version}-${i}`);
    if (!part) return null;
    parts.push(part.data);
  }
  return { value: JSON.parse(parts.join("")), savedAt: manifest.savedAt };
}
async function write(key, value) {
  const partitionKey = hash(key), version = randomUUID(), text = JSON.stringify(value), parts = [];
  // Keep each property safely below Azure's UTF-16 string limit, including surrogate pairs.
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + 28000, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    parts.push(text.slice(offset, end)); offset = end;
  }
  const client = await table();
  const old = await get(partitionKey, "manifest");
  for (let i = 0; i < parts.length; i++) await client.upsertEntity({ partitionKey, rowKey: `${version}-${i}`, data: parts[i] }, "Replace");
  await client.upsertEntity({ partitionKey, rowKey: "manifest", version, count: parts.length, savedAt: new Date().toISOString() }, "Replace");
  // Old versions are retained briefly so readers with an earlier manifest can finish.
  if (old) for await (const entity of client.listEntities({ queryOptions: { filter: `PartitionKey eq '${partitionKey}'` } })) {
    if (entity.rowKey !== "manifest" && !entity.rowKey.startsWith(version) && Date.now() - new Date(entity.timestamp).getTime() > 3600000) await client.deleteEntity(partitionKey, entity.rowKey).catch(() => {});
  }
}
async function jobs() {
  const result = [];
  for await (const row of (await table()).listEntities({ queryOptions: { filter: "PartitionKey eq 'JOB'" } })) result.push(row);
  return result.sort((a,b) => a.dueAt - b.dueAt);
}
module.exports = { get, create, replace, read, write, jobs, hash };

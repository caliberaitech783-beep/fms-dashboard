const { createOemTableStore } = require("../oem/oemTableStore");
const { oemStoreDefinition } = require("../oem/oemRegistry");

const SNAPSHOT_RESOURCE = "latest-vecv-location-snapshot";
const definition = oemStoreDefinition("Eicher");

const store = createOemTableStore({
  oem: definition.name,
  tableNames: definition.tableNames,
});

async function saveEicherSnapshot(snapshot) {
  if (!snapshot || snapshot.source !== "EICHER_VECV_LIVE") return null;
  return store.saveCursor(SNAPSHOT_RESOURCE, {
    snapshot,
    savedAt: new Date().toISOString(),
  });
}

async function loadEicherSnapshot() {
  const value = await store.getCursor(SNAPSHOT_RESOURCE);
  return value?.snapshot || null;
}

module.exports = {
  SNAPSHOT_RESOURCE,
  loadEicherSnapshot,
  saveEicherSnapshot,
};

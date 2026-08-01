const { createOemTableStore } = require("../oem/oemTableStore");
const { oemStoreDefinition } = require("../oem/oemRegistry");

const definition = oemStoreDefinition("Scania");

module.exports = createOemTableStore({
  oem: definition.name,
  tableNames: definition.tableNames,
});

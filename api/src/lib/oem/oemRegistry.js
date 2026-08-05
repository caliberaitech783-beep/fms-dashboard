const { defaultTableNames } = require("./oemTableStore");

const OEM_DEFINITIONS = [
  { name: "Volvo", prefix: "VOLVO", implemented: true },
  { name: "Scania", prefix: "SCANIA", implemented: true },
  { name: "Eicher", prefix: "EICHER", implemented: true },
  { name: "LiuGong", prefix: "LIUGONG", implemented: false },
  { name: "TataHitachi", prefix: "TATA_HITACHI", implemented: false },
  { name: "Case", prefix: "CASE", implemented: false },
  { name: "Komatsu", prefix: "KOMATSU", implemented: false },
];

function tableNamesForDefinition(definition, env = process.env) {
  if (definition.name === "Volvo") {
    return {
      events: env.VOLVO_EVENTS_TABLE_NAME || "VolvoVehicleEvents",
      state: env.VOLVO_STATE_TABLE_NAME || "VolvoVehicleState",
      cursor: env.VOLVO_CURSOR_TABLE_NAME || "VolvoSyncCursor",
      scores: env.VOLVO_SCORES_TABLE_NAME || "VolvoDriverScores",
    };
  }
  const defaults = defaultTableNames(definition.name);
  return {
    master: env[`${definition.prefix}_MASTER_TABLE_NAME`] || defaults.master,
    state: env[`${definition.prefix}_STATE_TABLE_NAME`] || defaults.state,
    position: env[`${definition.prefix}_POSITION_TABLE_NAME`] || defaults.position,
    cursor: env[`${definition.prefix}_CURSOR_TABLE_NAME`] || defaults.cursor,
  };
}

function listOemStoreDefinitions(env = process.env) {
  return OEM_DEFINITIONS.map((definition) => ({
    ...definition,
    tableNames: tableNamesForDefinition(definition, env),
  }));
}

function oemStoreDefinition(name, env = process.env) {
  const definition = OEM_DEFINITIONS.find((item) => item.name.toLowerCase() === String(name).toLowerCase());
  return definition ? { ...definition, tableNames: tableNamesForDefinition(definition, env) } : null;
}

module.exports = {
  OEM_DEFINITIONS,
  listOemStoreDefinitions,
  oemStoreDefinition,
  tableNamesForDefinition,
};

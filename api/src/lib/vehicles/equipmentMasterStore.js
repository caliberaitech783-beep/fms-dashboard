const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");
const { listVehicles } = require("./vehicleStore");
const { mergeEquipment } = require("./equipmentMaster");
let setupPromise;
async function getTable() {
  if (!setupPromise) setupPromise = (async () => {
    const connection = process.env.AzureWebJobsStorage || "";
    const table = connection === "UseDevelopmentStorage=true" || connection.startsWith("DefaultEndpointsProtocol=")
      ? TableClient.fromConnectionString(connection, "FmsEquipmentMaster")
      : new TableClient(`https://${process.env.STORAGE_ACCOUNT_NAME}.table.core.windows.net`, "FmsEquipmentMaster",
        new AzureNamedKeyCredential(process.env.STORAGE_ACCOUNT_NAME, process.env.STORAGE_ACCOUNT_KEY));
    await table.createTable().catch(error => { if (error.statusCode !== 409) throw error; });
    return table;
  })().catch(error => { setupPromise = null; throw error; });
  return setupPromise;
}
async function listEquipment() {
 const table=await getTable();
 const entities=[];
 for await(const entity of table.listEntities({queryOptions:{filter:"PartitionKey eq 'EQUIPMENT'"}})) entities.push(entity);
 return mergeEquipment(await listVehicles(),entities);
}
module.exports={getTable,listEquipment};

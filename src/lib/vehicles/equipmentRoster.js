const { createHash } = require('node:crypto');
const { resolveImportedSite } = require('./vehicleMasterIntegration');
const key = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
function equipmentOem(row, apiOem) {
 const text = `${row.oem || ''} ${row.model || ''}`.toLowerCase();
 for (const name of ['Volvo','Scania','LiuGong','Eicher','CASE']) if (text.includes(name.toLowerCase())) return name;
 const vin=key(row.serialNumber);
 if(vin.startsWith('YV2')) return 'Volvo';
 if(vin.startsWith('YS2')) return 'Scania';
 if(vin.startsWith('LGI') || vin.startsWith('CLG')) return 'LiuGong';
 return apiOem || null;
}
function equipmentSite(row) {
 const name=String(row.location || '').trim();
 if(/^dudhichua oc$/i.test(name)) return {id:'site-ncl-dch-west',name,group:'NCL'};
 const site=resolveImportedSite(name);
 return site ? {...site,name} : null;
}
function selectEquipment(rows, oem, apiVins=[]) {
 const known = new Set(apiVins.map(key));
 return rows.filter(row=>equipmentOem(row,known.has(key(row.serialNumber)) ? oem : null)===oem);
}
function rosterRevision(rows) {
 return createHash('sha256').update(JSON.stringify([...rows].sort((a,b)=>key(a.serialNumber).localeCompare(key(b.serialNumber))))).digest('hex');
}
function importedRoster(rows,oem,apiVins=[]) {
 return selectEquipment(rows,oem,apiVins).map(row=>{
  const site=equipmentSite(row);
  return {vin:row.serialNumber,vehicleNumber:row.equipment,vehicleModel:row.model,rawSiteName:row.location,
    siteId:site?.id || null,siteName:site?.name || null,siteGroup:site?.group || null,
    contractType:site?.contractType || null,serviceStatus:'Active',active:true,driver:row.driver || '',equipmentMaster:true};
 });
}
function volvoRoster(apiVehicles,rows) {
 const byVin=new Map(apiVehicles.map(v=>[key(v.vin || v.VIN),v]));
 return importedRoster(rows,'Volvo',[...byVin.keys()]).map(record=>({
   ...(byVin.get(key(record.vin)) || {}),vin:record.vin,VIN:record.vin,
   CustomerVehicleName:record.vehicleNumber,customerVehicleName:record.vehicleNumber,
   Model:record.vehicleModel,model:record.vehicleModel,Brand:'VOLVO TRUCKS',Type:'TRUCK',
   importedVehicleMaster:record,
 }));
}
module.exports={key,equipmentOem,equipmentSite,selectEquipment,rosterRevision,importedRoster,volvoRoster};

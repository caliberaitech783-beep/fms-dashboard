const { test } = require('node:test');
const assert = require('node:assert/strict');
const {volvoRoster, importedRoster, rosterRevision, equipmentSite} = require('../src/lib/vehicles/equipmentRoster');
const {mergeEquipment,normalizeEquipment} = require('../src/lib/vehicles/equipmentMaster');
test('Equipment Master maps all 19 connected trucks even when only nine have metric data',()=>{
 const equipment=Array.from({length:19},(_,i)=>({serialNumber:`YV2TEST${String(i).padStart(10,'0')}`,equipment:['V957','V604','V947','V502','V605','V948','V590','V500','V952','V956','V949','V946','V503','V950','V501','V603','V606','V945','V944'][i],model:'Volvo FMX',location:'Sasti OC',oem:'',category:'Truck'}));
 const api=equipment.map((r,i)=>({vin:r.serialNumber,CustomerVehicleName:'old',...(i<9 ? {rawMetric:12} : {})}));
 api.push({vin:'YV2UNSUBSCRIBED',CustomerVehicleName:'outside'});
 const rows=volvoRoster(api,equipment);
 assert.equal(rows.length,19);
 assert.equal(new Set(rows.map(r=>r.vin)).size,19);
 assert.equal(rows[0].CustomerVehicleName,'V957');
 assert.equal(rows[0].rawMetric,12);
 assert.equal(rows[18].rawMetric,undefined);
 assert.ok(rows.every(r=>r.importedVehicleMaster.siteId==='site-wcl-sasti-ocm'));
});
test('master reassignment and deletion override historical OEM site and membership',()=>{
 const imported=[{vin:'YV2TEST',vehicleNumber:'old',vehicleModel:'Volvo FMX',rawSiteName:'Sasti'}];
 const edited=normalizeEquipment({serialNumber:'YV2TEST',equipment:'DN 953',model:'Volvo FMX',location:'Dhoptala OC (2nd)'});
 const rows=mergeEquipment(imported,[{rowKey:edited.id,recordJson:JSON.stringify(edited)}]);
 assert.equal(volvoRoster([{vin:'YV2TEST'}],rows)[0].importedVehicleMaster.siteId,'site-wcl-dhoptala-ocm');
 assert.equal(volvoRoster([{vin:'YV2TEST'}],mergeEquipment(imported,[{rowKey:edited.id,deleted:true}])).length,0);
});
test('OEM memberships do not leak across brands and unassigned sites remain unassigned',()=>{
 const rows=[{serialNumber:'YS2TEST',oem:'Scania',location:'Sasti OC'}, {serialNumber:'YV2TEST',location:''}];
 assert.equal(importedRoster(rows,'Volvo').length,1);
 assert.equal(importedRoster(rows,'Volvo')[0].siteId,null);
 assert.equal(equipmentSite({location:'Dudhichua OC'}).id,'site-ncl-dch-west');
});
test('roster revision is order-independent and changes after remapping or deleting a vehicle',()=>{
 const a={serialNumber:'A',location:'Sasti OC'},b={serialNumber:'B',location:'Majri OC'};
 assert.equal(rosterRevision([a,b]),rosterRevision([b,a]));
 assert.notEqual(rosterRevision([a,b]),rosterRevision([a]));
 assert.notEqual(rosterRevision([a,b]),rosterRevision([{...a,location:'Dhoptala OC (2nd)'},b]));
});

test('LiuGong report reads only the Equipment Master fleet and preserves an unassigned site',async()=>{
 const service=require('../src/lib/liugong/service');
 const calls=[];
 const fleet=[{serialNumber:'LGINEW',doorNumber:'HP-99',model:'DW105A',productGroup:'Mining Truck',siteId:null,siteName:''}];
 const report=await service.report('2026-10-14','2026-10-14',{loadSnapshot:async vin=>{calls.push(vin);return null;}},fleet);
 assert.deepEqual(calls,['LGINEW']);
 assert.equal(report.vehicles.length,1);
 assert.equal(report.vehicles[0].siteId,null);
 assert.equal(report.rows[0].fuelLitres,null);
});


test('truck VIN suffixes match subscribed API VINs without including unconnected inventory',()=>{
 const rows=[
  {serialNumber:'YV2XBZ0GXS8994984D28',equipment:'V501',model:'Volvo FMX',location:'Sasti OC'},
  {serialNumber:'YV2XG30G8T8902867',equipment:'V957',model:'Volvo FMX',location:'Sasti OC'},
  {serialNumber:'YV2XTY0GXP8982610F26',equipment:'V253',model:'Volvo FMX',location:'Sasti OC'},
  {serialNumber:'VCEC550EK00380210',equipment:'VPC72',oem:'Volvo',location:'Sasti OC'}
 ];
 const result=volvoRoster([{vin:'YV2XBZ0GXS8994984'},{vin:'YV2XG30G8T8902867'}],rows);
 assert.deepEqual(result.map(r=>r.CustomerVehicleName),['V501','V957']);
 assert.equal(result[0].vin,'YV2XBZ0GXS8994984');
});

test('Sasti includes exactly the approved 19 even when three are absent from the OEM catalog',()=>{
 const doors=['V957','V604','V947','V502','V605','V948','V590','V500','V952','V956','V949','V946','V503','V950','V501','V603','V606','V945','V944'];
 const missing=new Set(['V945','V946','V948']);
 const master=[...doors,...Array.from({length:7},(_,i)=>`V${252+i}`),'VPC72'].map((door,i)=>({equipment:door,serialNumber:`VIN${i}`,oem:'Volvo',location:'Sasti OC'}));
 const api=master.filter(r=>!missing.has(r.equipment)).map(r=>({vin:r.serialNumber}));
 const result=volvoRoster(api,master);
 assert.deepEqual(result.map(r=>r.CustomerVehicleName),doors);
 assert.deepEqual(result.filter(r=>!r.oemCatalogAvailable).map(r=>r.CustomerVehicleName).sort(),[...missing].sort());
 assert.ok(result.filter(r=>!r.oemCatalogAvailable).every(r=>r.rawMetric===undefined));
});

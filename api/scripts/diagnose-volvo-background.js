const {execFileSync}=require("node:child_process");
const az=args=>JSON.parse(execFileSync("az",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
(async()=>{
 const resources=az(["resource","list","--name","cmll-fms-api-b3-783","--resource-type","Microsoft.Web/sites","-o","json"]);
 const settings=az(["functionapp","config","appsettings","list","--name","cmll-fms-api-b3-783","--resource-group",resources[0].resourceGroup,"-o","json"]);
 for(const {name,value} of settings) if(name.startsWith("VOLVO_") || ["AzureWebJobsStorage","STORAGE_ACCOUNT_NAME","STORAGE_ACCOUNT_KEY"].includes(name)) process.env[name]=value;
 const db=require("../src/lib/volvo/volvoBackgroundStore");
 const equipment=await require("../src/lib/vehicles/equipmentMasterStore").listEquipment();
 const roster=require("../src/lib/vehicles/equipmentRoster");
 const sasti=roster.importedRoster(equipment,"Volvo").filter(row=>row.siteId === "site-wcl-sasti-ocm");
 console.log(JSON.stringify({equipmentMaster:{total:equipment.length,sastiVolvo:sasti.length,vehicles:sasti.map(row=>({door:row.vehicleNumber,vin:row.vin}))}}));
 const {requestReport}=require("../src/lib/volvo/volvoReportJobs");
 const date=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata"}).format(new Date());
 const query=new URLSearchParams({date,shift:"A",site:"site-wcl-sasti-ocm",startTime:date+"T05:00:00+05:30",stopTime:date+"T13:00:00+05:30"});
 const verify=process.env.VERIFY_SASTI === "true";
 if(verify) {
   const vehicles=await require("../src/lib/volvo/volvoRfmsClient").createVolvoClientFromEnv().fetchAllVehicles();
   const subscribed=roster.volvoRoster(vehicles,equipment).filter(row=>row.importedVehicleMaster.siteId === "site-wcl-sasti-ocm");
   console.log(JSON.stringify({subscribedSasti:{count:subscribed.length,vehicles:subscribed.map(row=>({door:row.CustomerVehicleName,vin:row.vin}))}}));
 }
 if(verify) { const result=await requestReport(query); console.log(JSON.stringify({sastiVerification:{status:result.status,rows:result.report.rows.length,period:result.report.period,notice:result.report.notice}})); }
 const jobs=await db.jobs();
 console.log(JSON.stringify({phase:"before",collector:await db.read("collector-status"),cursor:await db.get("CONTROL","HISTORY_CURSOR"),gate:await db.get("CONTROL","REQUEST"),jobs:jobs.map(j=>({query:JSON.parse(j.query),status:j.status,attempts:j.attempts,lastStatus:j.lastStatus,dueAt:j.dueAt,leaseUntil:j.leaseUntil}))}));
 for(const job of jobs.filter(j=>j.status === "complete")) {
   const saved=await db.read(job.key);
   console.log(JSON.stringify({savedReport:JSON.parse(job.query),savedAt:saved?.savedAt,rowCount:saved?.value?.rows?.length,vehicles:saved?.value?.rows?.map(r=>({door:r.Vehicles,distance:r["Driving (km)"]})),period:saved?.value?.period}));
 }
 if(process.env.VOLVO_DIAGNOSTIC_COLLECT !== "true" && !verify) return;
 const {loadDriverStandstillReport}=require("../src/functions/volvoApi");
 const {processReportJobs}=require("../src/lib/volvo/volvoReportJobs");
 console.log(JSON.stringify(await processReportJobs(async request=>{
   try { return await loadDriverStandstillReport(request); }
   catch(e){ let message=String(e.message); for(const {value} of settings) if(value && value.length>6) message=message.split(value).join("[redacted]");console.log(JSON.stringify({collectionError:message,status:e.statusCode,code:e.code}));throw e; }
 }, verify ? {...db,jobs:async()=>(await db.jobs()).filter(job=>{const q=JSON.parse(job.query);return q.date===date && q.site===query.get("site") && q.startTime===query.get("startTime") && q.stopTime===query.get("stopTime") && q.rosterRevision===roster.rosterRevision(equipment);})} : db)));
 if(verify) { const result=await requestReport(query); console.log(JSON.stringify({sastiVerification:{status:result.status,rows:result.report.rows.length,period:result.report.period,notice:result.report.notice}})); }
 console.log(JSON.stringify({phase:"after",jobs:(await db.jobs()).map(j=>({status:j.status,attempts:j.attempts,lastStatus:j.lastStatus,dueAt:j.dueAt}))}));
})().catch(e=>{console.error('Volvo diagnostic failed',e.statusCode || e.code || 'internal');process.exit(1)});

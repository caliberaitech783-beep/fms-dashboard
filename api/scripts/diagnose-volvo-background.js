const {execFileSync}=require("node:child_process");
const az=args=>JSON.parse(execFileSync("az",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
(async()=>{
 const resources=az(["resource","list","--name","cmll-fms-api-b3-783","--resource-type","Microsoft.Web/sites","-o","json"]);
 const settings=az(["functionapp","config","appsettings","list","--name","cmll-fms-api-b3-783","--resource-group",resources[0].resourceGroup,"-o","json"]);
 for(const {name,value} of settings) if(name.startsWith("VOLVO_") || ["AzureWebJobsStorage","STORAGE_ACCOUNT_NAME","STORAGE_ACCOUNT_KEY"].includes(name)) process.env[name]=value;
 const db=require("../src/lib/volvo/volvoBackgroundStore");
 const jobs=await db.jobs();
 console.log(JSON.stringify({phase:"before",collector:await db.read("collector-status"),cursor:await db.get("CONTROL","HISTORY_CURSOR"),gate:await db.get("CONTROL","REQUEST"),jobs:jobs.map(j=>({query:JSON.parse(j.query),status:j.status,attempts:j.attempts,lastStatus:j.lastStatus,dueAt:j.dueAt,leaseUntil:j.leaseUntil}))}));
 for(const job of jobs.filter(j=>j.status === "complete")) {
   const saved=await db.read(job.key);
   console.log(JSON.stringify({savedReport:JSON.parse(job.query),savedAt:saved?.savedAt,rowCount:saved?.value?.rows?.length,period:saved?.value?.period}));
 }
 if(process.env.VOLVO_DIAGNOSTIC_COLLECT !== "true") return;
 const {loadDriverStandstillReport}=require("../src/functions/volvoApi");
 const {processReportJobs}=require("../src/lib/volvo/volvoReportJobs");
 console.log(JSON.stringify(await processReportJobs(async request=>{
   try { return await loadDriverStandstillReport(request); }
   catch(e){ let message=String(e.message); for(const {value} of settings) if(value && value.length>6) message=message.split(value).join("[redacted]");console.log(JSON.stringify({collectionError:message,status:e.statusCode,code:e.code}));throw e; }
 })));
 console.log(JSON.stringify({phase:"after",jobs:(await db.jobs()).map(j=>({status:j.status,attempts:j.attempts,lastStatus:j.lastStatus,dueAt:j.dueAt}))}));
})().catch(e=>{console.error('Volvo diagnostic failed',e.statusCode || e.code || 'internal');process.exit(1)});

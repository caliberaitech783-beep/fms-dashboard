const {execFileSync} = require("node:child_process");
const az = args => execFileSync("az",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
(async()=>{
  const group = az(["resource","list","--name","cmll-fms-api-b3-783","--resource-type","Microsoft.Web/sites","--query","[0].resourceGroup","-o","tsv"]);
  const key = az(["functionapp","keys","list","--name","cmll-fms-api-b3-783","--resource-group",group,"--query","masterKey","-o","tsv"]);
  if (!key) throw Error("Function key unavailable");
  console.log("::add-mask::"+key);
  const base = "https://cmll-fms-api-b3-783.azurewebsites.net";
  const headers = {"x-functions-key":key,"Content-Type":"application/json"};
  let triggered = false;
  for(let i=0;i<18;i++) {
    if(!triggered) {
      const trigger = await fetch(base+"/admin/functions/volvoReportCollector",{method:"POST",headers,body:JSON.stringify({input:"deployment verification"}),signal:AbortSignal.timeout(10000)}).catch(()=>null);
      triggered = Boolean(trigger?.ok);
    }
    const response = await fetch(base+"/api/internal/volvo-collection-status",{headers,signal:AbortSignal.timeout(10000)}).catch(()=>null);
    if(response?.ok) {
      const status = await response.json();
      if(status.collector && Date.now()-Date.parse(status.collector.startedAt)<600000) {
        console.log(JSON.stringify({collector:status.collector,historyThrough:status.historyThrough,queued:status.queued,completed:status.completed}));
        return;
      }
    }
    await new Promise(resolve=>setTimeout(resolve,10000));
  }
  throw Error("Volvo background collector heartbeat was not observed");
})().catch(()=>{console.error("Volvo background collector verification failed; inspect Azure function logs.");process.exit(1)});

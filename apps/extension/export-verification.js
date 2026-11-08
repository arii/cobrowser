// Deliberately scoped to the public synthetic fixture, never arbitrary websites.
export function expectedFixtureCsv(values){
  const {Team:team,'Start inclusive':start,'End exclusive':end}=values;
  if(!['red','blue'].includes(team) || !/^2026-\d{2}-\d{2}$/.test(start??'') || !/^2026-\d{2}-\d{2}$/.test(end??'') || start>=end)return null;
  const rows=['team,date,value'];
  for(let time=Date.UTC(2026,9,19);time<=Date.UTC(2026,10,18);time+=86400000){
    const date=new Date(time),key=date.toISOString().slice(0,10);
    if(key>=start && key<end)rows.push(`${team},${key},${(team==='red'?100:200)+date.getUTCDate()}`);
  }
  return rows.join('\n')+'\n';
}
export async function watchFixtureExport(tabId,origin,expected){
  let result=null;
  const pending=new Set();
  const command=(method,params)=>chrome.debugger.sendCommand({tabId},method,params);
  const listener=(source,method,event)=>{
    if(source.tabId!==tabId || method!=='Fetch.requestPaused')return;
    const task=(async()=>{
      try{
        if(event.request.url.split('?')[0]!==`${origin}/export`){await command('Fetch.continueRequest',{requestId:event.requestId});return;}
        const body=await command('Fetch.getResponseBody',{requestId:event.requestId});
        const text=body.base64Encoded?atob(body.body):body.body;
        // Fulfill the very same response bytes: no second export request is made.
        await command('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:event.responseStatusCode,responseHeaders:event.responseHeaders,body:body.base64Encoded?body.body:btoa(body.body)});
        result={status:event.responseStatusCode===200 && text===expected?'verified':'failed',scope:'synthetic-fixture-csv',message:'Export response bytes compared with explicit requested team and date bounds.'};
      }catch{
        result={status:'failed',scope:'synthetic-fixture-csv',message:'Export response bytes could not be verified.'};
        await command('Fetch.continueRequest',{requestId:event.requestId}).catch(()=>{});
      }
    })();pending.add(task);void task.finally(()=>pending.delete(task));
  };
  chrome.debugger.onEvent.addListener(listener);
  try{await command('Fetch.enable',{patterns:[{urlPattern:`${origin}/export*`,requestStage:'Response'}]});}
  catch(error){chrome.debugger.onEvent.removeListener(listener);throw error;}
  return {result:()=>result,close:async()=>{await Promise.allSettled([...pending]);await command('Fetch.disable',{}).catch(()=>{});chrome.debugger.onEvent.removeListener(listener);}};
}

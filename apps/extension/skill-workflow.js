// Website configuration is explicit; model output never controls navigation.
export function websiteUrl(value){
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol) || url.username || url.password || value.length>2000)throw new Error('Use an HTTP or HTTPS website address without embedded credentials.');
  url.hash='';return url.href;
}
export function workflowSites(skill){
  const sites=skill.sites?.length?skill.sites:[{id:'main',url:skill.origin+'/'}];
  if(sites.length>8)throw new Error('A skill can use up to eight websites.');
  const ids=new Set();
  return sites.map(site=>{if(!/^[a-zA-Z0-9_-]{1,60}$/.test(site.id) || ids.has(site.id))throw new Error('Invalid or duplicate website identifier.');ids.add(site.id);return {id:site.id,url:websiteUrl(site.url)};});
}
export function configureWorkflow(skill,urls,instruction='',addition=null){
  if(typeof instruction!=='string' || instruction.length>4000)throw new Error('Keep the instruction under 4,000 characters.');
  if(!Array.isArray(urls) || !urls.length || urls.length>8)throw new Error('List between one and eight website addresses.');
  const old=workflowSites(skill);
  const sites=urls.map((url,index)=>({id:old[index]?.id??`source_${index}`,url:websiteUrl(url)}));
  let steps=skill.steps.map(step=>({...step,siteId:step.siteId??'main'}));
  if(steps.some(step=>!sites.some(site=>site.id===step.siteId)))throw new Error('Keep websites that have workflow steps.');
  if(addition){
    const mapping=new Map();
    for(const site of workflowSites(addition)){
      let mapped=sites.find(item=>item.url===site.url);
      if(!mapped){let index=sites.length;while(sites.some(item=>item.id===`part_${index}`))index++;mapped={id:`part_${index}`,url:site.url};sites.push(mapped);}
      mapping.set(site.id,mapped.id);
    }
    steps.push(...addition.steps.map(step=>({...step,siteId:mapping.get(step.siteId??'main'),parameter:step.parameter?`input_${steps.length+addition.steps.indexOf(step)+1}`:null})));
  }
  if(sites.length>8 || steps.length>48)throw new Error('Limit a workflow to eight websites and 48 steps.');
  return {...skill,sites,steps,instruction:instruction.trim(),active:false};
}

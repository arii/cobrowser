// Raw frames live only in worker memory; storage receives DOM/evidence metadata.
let latest,previous,lastAt=0,busy=false,lastTab;
const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(v=>v.toString(16).padStart(2,'0')).join('');
async function smallImage(data){
  const bitmap=await createImageBitmap(await (await fetch(data)).blob());
  const width=Math.min(bitmap.width,900),height=Math.round(bitmap.height*width/bitmap.width);
  const canvas=new OffscreenCanvas(width,height);canvas.getContext('2d').drawImage(bitmap,0,0,width,height);bitmap.close();
  const blob=await canvas.convertToBlob({type:'image/jpeg',quality:.55});const bytes=new Uint8Array(await blob.arrayBuffer());
  let text='';for(const byte of bytes)text+=String.fromCharCode(byte);
  return {mediaType:'image/jpeg',base64:btoa(text)};
}
export function currentVisualEvidence(){return latest;}
export function clearVisualEvidence(){latest=previous=undefined;lastAt=0;lastTab=undefined;}
export async function captureVisualContext(state){
  if(busy)return;
  const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});
  if(!tab?.id||tab.incognito||!/^https?:/.test(tab.url??'')||!(await chrome.windows.get(tab.windowId)).focused)return;
  if(Date.now()-lastAt<(lastTab===tab.id?10000:2000))return;
  busy=true;let token,prepared;
  try{
    token=crypto.randomUUID();
    prepared=await chrome.tabs.sendMessage(tab.id,{kind:'recording:prepare-capture',token},{frameId:0});
    if(!prepared?.ok)return;
    const pixels=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'jpeg',quality:65});
    const after=await chrome.tabs.sendMessage(tab.id,{kind:'recording:finish-capture',token},{frameId:0});
    const current=await chrome.tabs.get(tab.id);const win=await chrome.windows.get(tab.windowId);
    if(!after?.valid||after.documentId!==prepared.documentId||current.url!==tab.url||!current.active||!win.focused)return;
    const image=await smallImage(pixels),at=new Date().toISOString(),origin=new URL(tab.url).origin;
    const frame={image,at,origin,tabId:tab.id,sessionId:state.sessionId};
    const same=previous?.sessionId===state.sessionId&&previous?.tabId===tab.id&&previous?.origin===origin;
    const points=state.events.filter(event=>event.tabId===tab.id&&event.sessionId===state.sessionId&&Date.parse(event.at)>=lastAt);
    const samples=points.filter(event=>event.kind==='pointer'&&event.x!==undefined).slice(-30).map(({at,x,y})=>({at,x,y}));
    let distance=0;for(let i=1;i<samples.length;i++)distance+=Math.hypot(samples[i].x-samples[i-1].x,samples[i].y-samples[i-1].y);
    const frames=[...(same?[previous.frame]:[]),frame];
    latest={id:crypto.randomUUID(),tabId:tab.id,at,reason:lastTab===tab.id?'interval':'tab-change',before:same?previous.dom:null,after:after.dom,
      motion:{samples,distance,clicks:points.filter(e=>e.kind==='click').length,scrolls:points.filter(e=>e.kind==='scroll').length,keys:points.filter(e=>e.kind==='key').length},
      imageHashes:await Promise.all(frames.map(item=>hash(item.image.base64))),visualSummary:null,frames};
    previous={...frame,frame,dom:after.dom};lastAt=Date.now();lastTab=tab.id;
    state.visualCapture={at,status:'captured',id:latest.id};
  }catch{state.visualCapture={at:new Date().toISOString(),status:'unavailable'};lastAt=Date.now();}
  finally{
    if(prepared?.ok)await chrome.tabs.sendMessage(tab.id,{kind:'recording:finish-capture',token},{frameId:0}).catch(()=>{});
    busy=false;
  }
}

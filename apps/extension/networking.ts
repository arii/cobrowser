// A bounded networking recipe: demonstrations contain control metadata, never typed values.
export const NETWORKING = 'guest-list-linkedin-v1';
export type Guest = {name:string;company:string;profileUrl?:string};
export type Profile = {name:string;detail:string;url:string};
export const normalized = (value:string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function profileUrl(value:string):string|null {
  try {const url=new URL(value);if(url.protocol!=='https:'||url.hostname!=='www.linkedin.com'||!/^\/in\/[^/]+\/?$/.test(url.pathname)||url.username||url.password)return null;return url.origin+url.pathname.replace(/\/$/,'');}catch{return null;}
}
export function matchGuest(guest:Guest,profiles:Profile[]) {
  const unique=[...new Map(profiles.filter(p=>profileUrl(p.url)).map(p=>[profileUrl(p.url),p])).values()];
  if(guest.profileUrl){const exact=unique.filter(p=>profileUrl(p.url)===profileUrl(guest.profileUrl!));return exact.length===1?exact[0]:null;}
  // Require an independent affiliation as well as the full name; never choose by rank.
  if(!guest.company.trim())return null;
  const matches=unique.filter(p=>normalized(p.name)===normalized(guest.name)&&(` ${normalized(p.detail)} `).includes(` ${normalized(guest.company)} `));
  return matches.length===1?matches[0]:null;
}
export function guestKey(guest:Guest){return JSON.stringify([normalized(guest.name),normalized(guest.company)]);}
export function networkingIssues(skill:any):string[]{
  try {
    if(skill.family!==NETWORKING||skill.networking?.version!==1)return ['Unsupported networking recipe.'];
    const url=new URL(skill.sites?.[0]?.url);
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.href.length>2000)return ['Invalid guest-list address.'];
    if(skill.sites?.length!==2||skill.sites[1].url!=='https://www.linkedin.com/')return ['Networking requires a guest list and LinkedIn.'];
    if(!Number.isInteger(skill.networking.maxGuests)||skill.networking.maxGuests<1||skill.networking.maxGuests>100)return ['Choose between 1 and 100 guests.'];
    if(!skill.examples?.some((e:any)=>e.eventIds?.length>=3&&e.effect==='content-changed'))return ['Demonstrate a guest-list visit and a completed LinkedIn invitation first.'];
    return [];
  }catch{return ['Invalid networking configuration.'];}
}
export function discoverNetworking(events:any[],starts:Record<string,string>,tabs:{id?:number;url?:string;title?:string}[]) {
  const human=events.filter(e=>e.provenance==='human'&&!['agent','probe'].includes(e.source));
  const sent=human.findLast(e=>e.origin==='https://www.linkedin.com'&&e.kind==='click'&&/^(send|send without a note|send invitation)$/i.test(e.target?.label??'')&&e.effect==='content-changed');
  if(!sent)return [];
  const before=human.filter(e=>e.sessionId===sent.sessionId&&Date.parse(e.at)<=Date.parse(sent.at)&&Date.parse(sent.at)-Date.parse(e.at)<30*60*1000);
  const connect=before.findLast(e=>e.origin===sent.origin&&e.tabId===sent.tabId&&/^connect(?: with .+)?$/i.test(e.target?.label??''));
  if(!connect)return [];
  const source=before.findLast(e=>e.origin!==sent.origin&&tabs.some(tab=>tab.id===e.tabId&&tab.url&&new URL(tab.url).origin===e.origin&&/guest|attendee|participant/i.test(`${tab.title} ${tab.url}`)));
  if(!source)return [];
  const url=starts[`${source.sessionId}:${source.tabId}:${source.origin}`];
  if(!url)return [];
  const key=JSON.stringify([NETWORKING,url]),evidenceIds=[source.id,connect.id,sent.id];
  return [{family:NETWORKING,networking:{version:1,maxGuests:25},key,goalKey:key,origin:source.origin,title:'Connect with event guests on LinkedIn',customTitle:true,
    sites:[{id:'guests',url},{id:'linkedin',url:'https://www.linkedin.com/'}],steps:[],qualityVersion:3,evidenceIds,exampleCount:1,
    examples:[{at:sent.at,eventIds:evidenceIds,effect:'content-changed'}],blockers:[],outcome:'LinkedIn invitation pending',
    assessment:'Learned across your guest-list and LinkedIn tabs. Review the guest list before sending. This live recipe checks identities and invitation states; it has no independent site certification.',
    reusability:{source:'local',confidence:.85,reusable:true,reason:'Observed a guest-list visit, Connect, and Send with a page change in one session.'}}];
}
export async function networkingBinding(skill:any){
  const bytes=new TextEncoder().encode(JSON.stringify({family:skill.family,networking:skill.networking,sites:skill.sites,instruction:skill.instruction}));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
}


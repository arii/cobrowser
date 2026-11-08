// Injected in the extension's isolated world. A closed shadow root keeps task
// answers out of the website DOM; the host is excluded from recording/context.
export function skillHelpPrompt(prompt){
  const key='__cobrowserSkillHelp';
  const previous=globalThis[key];
  if(!prompt){previous?.remove();delete globalThis[key];return;}
  if(previous?.token===prompt.token && previous.host.isConnected)return;
  previous?.remove();
  const host=document.createElement('div');host.setAttribute('data-sensitive','');host.setAttribute('data-cobrowser-skill-help','');
  host.style.cssText='all:initial!important;position:fixed!important;inset:16px 16px auto!important;z-index:2147483647!important;display:block!important;pointer-events:auto!important;';
  const shadow=host.attachShadow({mode:'closed'});
  const style=document.createElement('style');style.textContent=`:host{color-scheme:light}*{box-sizing:border-box}.prompt{max-width:680px;margin:auto;padding:20px;background:#fff;color:#172033;border:1px solid #cbd5e1;border-top:4px solid #244ce0;border-radius:12px;box-shadow:0 12px 48px #0004;font:14px/1.5 system-ui}h2{font-size:18px;margin:0 0 8px}p{margin:8px 0;white-space:pre-wrap}textarea{display:block;width:100%;min-height:76px;margin:8px 0;padding:10px;border:1px solid #94a3b8;border-radius:6px;font:inherit;color:#172033;background:#fff}button{padding:8px 14px;border:1px solid #cbd5e1;border-radius:6px;font:inherit;cursor:pointer;background:#f4f7fb;color:#172033;margin:6px 8px 0 0}.primary{background:#244ce0;color:#fff;border-color:#244ce0}.error{color:#a32a20}.hint{font-size:12px;color:#596579}button:disabled{opacity:.5}select{display:block;width:100%;padding:8px;border:1px solid #94a3b8;border-radius:6px;font:inherit;background:#fff;color:#172033}`;
  const panel=document.createElement('section');panel.className='prompt';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Skill needs your input');
  const heading=document.createElement('h2');heading.textContent=prompt.providerFailure?'Input provider unavailable':'Skill needs your input';
  const title=document.createElement('p');title.textContent=prompt.title;
  const question=document.createElement('label');question.textContent=prompt.question;
  const answer=document.createElement('textarea');answer.maxLength=2000;answer.setAttribute('aria-label','Additional input');question.append(answer);
  const mode=document.createElement('select');mode.setAttribute('aria-label','Response type');
  for(const [value,label] of prompt.input?[['value','Exact field value · no model call'],...(!prompt.providerFailure?[['clarification','Clarification · ask the model']]:[])]:[['clarification','Page fix or additional context']]){const option=document.createElement('option');option.value=value;option.textContent=label;mode.append(option);}
  mode.value=prompt.providerFailure?'value':'clarification';if(!mode.value)mode.value='value';
  const hint=document.createElement('p');hint.className='hint';hint.textContent=prompt.input?`Exact values are entered without a model call. Clarifications ask the model again.${prompt.input.tag==='SELECT'?' Available options: '+prompt.input.options.join(', '):''}`:'You can fix the page while paused, then describe what changed. Dispatched actions will not be repeated.';
  const submit=document.createElement('button');submit.className='primary';submit.textContent='Continue skill';
  const stop=document.createElement('button');stop.textContent='Stop skill';
  const minimize=document.createElement('button');minimize.textContent='Minimize';
  const error=document.createElement('p');error.className='error';error.setAttribute('role','alert');
  let timer;
  const remove=()=>{clearInterval(timer);host.remove();if(globalThis[key]?.host===host)delete globalThis[key];};
  const send=async(kind)=>{
    if(kind==='skills:answer' && mode.value!=='value' && !answer.value.trim()){error.textContent='Add a detail or describe the fix before continuing.';answer.focus();return;}
    submit.disabled=stop.disabled=true;error.textContent='';
    try{
      const response=await chrome.runtime.sendMessage({kind,runId:prompt.runId,helpToken:prompt.token,mode:mode.value,value:answer.value,answer:answer.value});
      if(!response?.ok)throw new Error(response?.error??'The skill did not respond.');
      remove();
    }catch(cause){error.textContent=cause.message;submit.disabled=stop.disabled=false;}
  };
  submit.onclick=()=>void send('skills:answer');stop.onclick=()=>void send('skills:cancel');
  minimize.onclick=()=>{const collapsed=!question.hidden;for(const node of [question,mode,hint,submit,error])node.hidden=collapsed;minimize.textContent=collapsed?'Show prompt':'Minimize';if(!collapsed)answer.focus();};
  answer.onkeydown=event=>{if(event.key==='Enter' && (event.ctrlKey||event.metaKey)){event.preventDefault();void send('skills:answer');}};
  panel.append(heading,title,question,mode,hint,submit,stop,minimize,error);shadow.append(style,panel);document.documentElement.append(host);
  globalThis[key]={host,token:prompt.token,remove};answer.focus();
  // Remove a stale prompt after a response from Skills, cancellation, or restart.
  timer=setInterval(()=>{void chrome.runtime.sendMessage({kind:'skills:help-status',runId:prompt.runId,helpToken:prompt.token}).then(result=>{if(!result?.ok || !result.waiting)remove();}).catch(remove);},1000);
}

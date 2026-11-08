(() => {
  if (window !== window.top) return;
  if (!['http:','https:'].includes(location.protocol)) return;
  // Re-injection replaces our listeners, including after an extension reload.
  try {window.__harnessRecorder?.stop?.();} catch {}
  const controller=new AbortController();
  let messageListener;
  window.__harnessRecorder={stop:()=>{controller.abort();try{chrome.runtime.onMessage.removeListener(messageListener);}catch{}}};
  let lastScroll = 0, lastPointer = 0;
  const documentId=crypto.randomUUID();
  let maskRoot,maskToken,maskSignature;
  const removeMask=()=>{maskRoot?.remove();maskRoot=undefined;};
  controller.signal.addEventListener('abort',removeMask);
  let interactionSequence=0,lastSubmitClick,submissionSequence=0;
  const describeControl=control=>{
    if(!control || control.disabled || control.readOnly || !control.getClientRects().length || getComputedStyle(control).visibility==='hidden' || control.closest('[data-cobrowser-probe],[data-cobrowser-agent],[contenteditable],[data-sensitive],[autocomplete^="cc-"],[autocomplete="current-password"],[autocomplete="new-password"]') || ['password','hidden','file','checkbox','radio'].includes(control.type))return;
    const name=control.tagName,copy=control.cloneNode(true);copy.querySelectorAll('input,select,textarea,[data-sensitive],[contenteditable],script,style').forEach(node=>node.remove());
    const label=(control.getAttribute('aria-label') || (control.labels?[...control.labels].map(label=>{const node=label.cloneNode(true);node.querySelectorAll('input,select,textarea,[data-sensitive]').forEach(child=>child.remove());return node.textContent;}).join(' '):'') || (['BUTTON','A'].includes(name)?copy.textContent:'')).replace(/\s+/g,' ').trim().slice(0,100);
    if(/^CDP typing probe$/i.test(label))return;
    if(label)return {tag:name,label,type:(control.getAttribute('type') || (name==='BUTTON' && control.form?'submit':'')).toLowerCase()};
  };
  const send = (kind, target, metadata = {}) => {
    if (document.visibilityState !== 'visible') return;
    const element = target instanceof Element ? target : null;
    // Capture bounded control labels for replay, never values or printable keystrokes.
    if (element?.closest('[data-cobrowser-probe], [data-cobrowser-agent], [data-sensitive], [autocomplete^="cc-"], [autocomplete="current-password"], [autocomplete="new-password"], input[type="password"], input[type="hidden"]')) return;
    const control = element?.closest('input,select,textarea,button,a');
    if(control && /^CDP typing probe$/i.test(control.getAttribute('aria-label')??''))return;
    const name = control?.tagName ?? element?.closest('form')?.tagName;
    const replayTarget=describeControl(control);
    const formTargets=kind==='click' && control?.form && control.type==='submit'?[...control.form.elements].filter(node=>['INPUT','SELECT','TEXTAREA'].includes(node.tagName) && node.name && !node.disabled).map(describeControl).filter(Boolean).slice(0,12):null;
    const tag = kind === 'scroll' || kind === 'page-visible' ? 'PAGE' : name ?? 'OTHER';
    const sequence=['click','change','key'].includes(kind)?++interactionSequence:interactionSequence;
    const before=kind==='click' && replayTarget?JSON.stringify(context()):null;
    const saved=chrome.runtime.sendMessage({kind:'recording:event',event:{kind,tag,...metadata,...(['click','change'].includes(kind) && replayTarget?{target:replayTarget}:{}),...(formTargets?.length?{formTargets}:{})}});
    if(kind==='click')lastSubmitClick=control?.form && control.type==='submit'?{control,saved,at:Date.now()}:null;
    // Attribute only a visible content change before the next interaction. Keep page
    // text transient: persist just a boolean effect signal bound to the saved action.
    if(before!==null){
      let reported=false;
      const observe=async()=>{
        if(reported || controller.signal.aborted || interactionSequence!==sequence || document.visibilityState!=='visible')return;
        if(JSON.stringify(context())!==before){
          const result=await saved;
          if(!reported && result?.ok && result.value?.id){reported=true;await chrome.runtime.sendMessage({kind:'recording:effect',id:result.value.id});}
        }
      };
      for(const delay of [100,400,1200])setTimeout(()=>{void observe().catch(()=>{});},delay);
    }
    void saved.catch(()=>{});
  };
  for (const kind of ['click','change','submit']) {
    document.addEventListener(kind, event => { if (event.isTrusted) send(kind,event.target,kind === 'click' && event.detail>0 ? {x:Math.max(0,Math.min(1,event.clientX/innerWidth)),y:Math.max(0,Math.min(1,event.clientY/innerHeight))} : {}); }, {capture:true,signal:controller.signal});
  }
  document.addEventListener('submit',event=>{
    if(!event.isTrusted)return;
    const click=lastSubmitClick,form=event.target;
    // Observe a real, uncancelled native GET submission. A repeated download need
    // not change the DOM. This proves submission, never downloaded-file correctness.
    setTimeout(()=>{
      if(event.defaultPrevented || !click || Date.now()-click.at>1500 || click.control.form!==form || form.method.toLowerCase()!=='get' || new URL(form.action,location.href).origin!==location.origin || !/^(export|download|search|filter)\b/i.test(describeControl(click.control)?.label??''))return;
      submissionSequence++;
      void click.saved.then(result=>{if(result?.value?.id)return chrome.runtime.sendMessage({kind:'recording:effect',id:result.value.id,effect:'form-submitted'});}).catch(()=>{});
    },0);
  },{capture:true,signal:controller.signal});
  document.addEventListener('mousemove', event => {
    if (event.isTrusted && Date.now()-lastPointer>1000) {lastPointer=Date.now();send('pointer',event.target,{x:Math.max(0,Math.min(1,event.clientX/innerWidth)),y:Math.max(0,Math.min(1,event.clientY/innerHeight))});}
  }, {passive:true,signal:controller.signal});
  document.addEventListener('keydown', event => {
    if (event.isTrusted && !event.repeat && ['Tab','Enter','Escape','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) send('key',event.target,{key:event.key});
  }, {capture:true,signal:controller.signal});
  document.addEventListener('scroll', event => {
    if (event.isTrusted && Date.now() - lastScroll > 1000) { lastScroll = Date.now(); send('scroll'); }
  }, {passive:true,capture:true,signal:controller.signal});
  document.addEventListener('visibilitychange', () => send('page-visible'),{signal:controller.signal});
  const context = () => {
    const excluded='input,textarea,select,[contenteditable],[data-sensitive],[autocomplete^="cc-"],script,style,noscript,iframe,[hidden],[aria-hidden="true"]';
    const headings=[...document.querySelectorAll('h1,h2,[role="heading"]')].filter(element=>!element.closest(excluded)).slice(0,3).map(element=>{const copy=element.cloneNode(true);copy.querySelectorAll(excluded).forEach(node=>node.remove());return copy.textContent.replace(/\s+/g,' ').trim().slice(0,120);});
    const root=document.querySelector('main,article,[role="main"]')??document.body??document.documentElement;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let excerpt='',visited=0,node;
    while ((node=walker.nextNode()) && visited++<3000 && excerpt.length<1200) {
      const parent=node.parentElement;
      if (parent && !parent.closest(excluded) && parent.getClientRects().length) excerpt+=' '+node.textContent.replace(/\s+/g,' ').trim();
    }
    return {title:document.title.slice(0,160),headings,excerpt:excerpt.trim().slice(0,1200)};
  };
  const snapshot=()=>{
    const data=context();
    const nodes=[...document.querySelectorAll('h1,h2,button,a,input,select,textarea,[role="button"],[role="tab"]')].filter(element=>element.getClientRects().length && !element.closest('[data-sensitive],input[type="password"],input[type="hidden"]')).slice(0,40).map(element=>({
      tag:element.tagName.slice(0,20),role:(element.getAttribute('role')??'').slice(0,40),
      text:element.matches('input,select,textarea,[contenteditable]')?'[value excluded]':(()=>{const copy=element.cloneNode(true);copy.querySelectorAll('input,select,textarea,[contenteditable],[data-sensitive],script,style,[hidden],[aria-hidden="true"]').forEach(node=>node.remove());return copy.textContent.replace(/\s+/g,' ').trim().slice(0,80);})(),
    }));
    return {documentId,at:new Date().toISOString(),origin:location.origin,...data,viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY},nodes};
  };
  const rectangles=()=>[...document.querySelectorAll('input,textarea,select,[contenteditable],[data-sensitive],iframe')].map(element=>element.getBoundingClientRect()).filter(r=>r.width>0 && r.height>0 && r.bottom>0 && r.right>0 && r.top<innerHeight && r.left<innerWidth).map(r=>({x:Math.floor(Math.max(0,r.left)),y:Math.floor(Math.max(0,r.top)),w:Math.ceil(Math.min(innerWidth,r.right)-Math.max(0,r.left)),h:Math.ceil(Math.min(innerHeight,r.bottom)-Math.max(0,r.top))}));
  messageListener=(message, _sender, respond) => {
    if(message?.kind==='recording:dom') {respond(snapshot());return;}
    if(message?.kind==='recording:prepare-capture'){
      if(document.visibilityState!=='visible' || !document.hasFocus() || getComputedStyle(document.documentElement).transform!=='none'){respond({ok:false});return;}
      removeMask();maskToken=message.token;
      const rects=rectangles();maskSignature=JSON.stringify([rects,innerWidth,innerHeight,scrollX,scrollY]);
      maskRoot=document.createElement('div');maskRoot.setAttribute('data-cobrowser-mask','');
      maskRoot.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
      for(const r of rects){const block=document.createElement('div');block.style.cssText=`position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:#000!important;`;maskRoot.append(block);}
      document.documentElement.append(maskRoot);
      setTimeout(()=>{if(maskToken===message.token)removeMask();},2000);
      requestAnimationFrame(()=>requestAnimationFrame(()=>respond({ok:true,documentId,dom:snapshot()})));
      return true;
    }
    if(message?.kind==='recording:finish-capture'){
      const valid=maskRoot?.isConnected && maskToken===message.token && maskSignature===JSON.stringify([rectangles(),innerWidth,innerHeight,scrollX,scrollY]);
      removeMask();respond({valid:Boolean(valid),documentId,dom:snapshot()});return;
    }

    if (message?.kind === 'recording:context-request') respond({...context(),submissionSequence,recorderVersion:4});
    if (message?.kind === 'recording:ping') respond({ok:true});
  };
  chrome.runtime.onMessage.addListener(messageListener);
  send('page-visible');
})();

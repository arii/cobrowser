(() => {
  if (window !== window.top) return;
  if (!['http:','https:'].includes(location.protocol)) return;
  if (window.__harnessRecorder) return;
  window.__harnessRecorder = true;
  let lastScroll = 0, lastPointer = 0;
  const send = (kind, target, metadata = {}) => {
    if (document.visibilityState !== 'visible') return;
    const element = target instanceof Element ? target : null;
    // Never read values, page text, names, IDs, or printable keystrokes.
    if (element?.closest('[data-sensitive], [autocomplete^="cc-"], [autocomplete="current-password"], [autocomplete="new-password"], input[type="password"], input[type="hidden"]')) return;
    const name = element?.closest('input,select,textarea,button,a,form')?.tagName;
    const tag = kind === 'scroll' || kind === 'page-visible' ? 'PAGE' : name ?? 'OTHER';
    void chrome.runtime.sendMessage({kind:'recording:event',event:{kind,tag,...metadata}}).catch(() => {});
  };
  for (const kind of ['click','change','submit']) {
    document.addEventListener(kind, event => { if (event.isTrusted) send(kind,event.target,kind === 'click' && event.detail>0 ? {x:Math.max(0,Math.min(1,event.clientX/innerWidth)),y:Math.max(0,Math.min(1,event.clientY/innerHeight))} : {}); }, true);
  }
  document.addEventListener('mousemove', event => {
    if (event.isTrusted && Date.now()-lastPointer>1000) {lastPointer=Date.now();send('pointer',event.target,{x:Math.max(0,Math.min(1,event.clientX/innerWidth)),y:Math.max(0,Math.min(1,event.clientY/innerHeight))});}
  }, {passive:true});
  document.addEventListener('keydown', event => {
    if (event.isTrusted && !event.repeat && ['Tab','Enter','Escape','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) send('key',event.target,{key:event.key});
  }, true);
  document.addEventListener('scroll', event => {
    if (event.isTrusted && Date.now() - lastScroll > 1000) { lastScroll = Date.now(); send('scroll'); }
  }, {passive:true,capture:true});
  document.addEventListener('visibilitychange', () => send('page-visible'));
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.kind === 'recording:ping') respond({ok:true});
  });
  send('page-visible');
})();

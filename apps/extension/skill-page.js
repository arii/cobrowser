// Runs inside a listed website. Values in private/editable controls stay excluded.
export function readSkillPage(){
  const excluded='input,textarea,select,[contenteditable],[data-sensitive],[autocomplete^="cc-"],script,style,noscript,iframe,[hidden],[aria-hidden="true"]';
  const label=control=>{
    const copy=control.cloneNode(true);copy.querySelectorAll(excluded).forEach(node=>node.remove());
    return (control.getAttribute('aria-label') || (control.labels?[...control.labels].map(item=>{const node=item.cloneNode(true);node.querySelectorAll(excluded).forEach(child=>child.remove());return node.textContent;}).join(' '):'') || (['BUTTON','A'].includes(control.tagName)?copy.textContent:'')).replace(/\s+/g,' ').trim().slice(0,100);
  };
  const walker=document.createTreeWalker(document.body??document.documentElement,NodeFilter.SHOW_TEXT);
  let text='',visited=0,node;
  while((node=walker.nextNode()) && visited++<15000 && text.length<12000){
    const parent=node.parentElement;
    if(parent && !parent.closest(excluded) && parent.getClientRects().length && getComputedStyle(parent).visibility!=='hidden')text+=' '+node.textContent.replace(/\s+/g,' ').trim();
  }
  const controls=[...document.querySelectorAll('button,a,input,select,textarea')].filter(control=>!control.disabled && !control.readOnly && control.getClientRects().length && !control.closest('[data-sensitive],[contenteditable],[autocomplete^="cc-"],[autocomplete="current-password"],[autocomplete="new-password"]') && !['password','hidden','file','checkbox','radio'].includes(control.type)).map(control=>({target:{tag:control.tagName,label:label(control),type:(control.getAttribute('type') || (control.tagName==='BUTTON' && control.form?'submit':'')).toLowerCase()},options:control.tagName==='SELECT'?[...control.options].filter(option=>!option.disabled).slice(0,100).map(option=>option.textContent.trim()):[]})).filter(control=>control.target.label).slice(0,100);
  return {origin:location.origin,title:document.title.slice(0,160),text:text.trim().slice(0,12000),controls};
}

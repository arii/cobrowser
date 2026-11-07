import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
function Popup() {
  // Keep one set of probe handlers shared with Phase 0, including error feedback.
  useEffect(() => { void import('../../popup.js'); }, []);
  return <main style={{width:360,font:'14px system-ui'}}>
    <p><a href="recording.html" target="_blank">Open live recording monitor</a></p>
    <p>Fixture recording and synthetic probes (127.0.0.1:3210).</p>
    <div id="setup" hidden>Load this popup from the installed extension toolbar menu.</div>
    <button id="ping">Relay ping</button><button id="assign">Create agent tab</button>
    <button id="screenshot">Screenshot/context</button><button id="stop">Detach</button>
    <p>Screenshot first. Input uses CSS viewport coordinates.</p>
    <label>X <input id="x" type="number" defaultValue="65" size={5}/></label>
    <label>Y <input id="y" type="number" defaultValue="425" size={5}/></label>
    <input id="text" defaultValue="manual-CDP-probe"/><button id="clickType">Click and type</button>
    <pre id="status" role="status" aria-live="polite" style={{whiteSpace:'pre-wrap'}}/>
    <img id="preview" style={{width:'100%'}}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Popup/>);

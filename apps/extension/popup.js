let observationId;
const status = document.getElementById('status');
if (location.protocol !== 'chrome-extension:' || !globalThis.chrome?.runtime?.id) {
  document.getElementById('setup').hidden = false;
  status.textContent = 'Extension APIs are unavailable in a local file or ordinary webpage. Load the extension using the steps above.';
  for (const button of document.querySelectorAll('button')) button.disabled = true;
} else {
  status.textContent = 'Ready. The fixture and native relay must be running (see README).';
  for (const kind of ['ping','assign','screenshot','stop','clickType']) document.getElementById(kind).onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    status.textContent = `Running ${button.textContent}…`;
    try {
      const args = kind === 'clickType' ? {observationId,x:Number(document.getElementById('x').value),y:Number(document.getElementById('y').value),text:document.getElementById('text').value} : undefined;
      const result = await chrome.runtime.sendMessage({kind,args});
      if (!result) throw new Error('The extension worker did not respond. Reload the extension at chrome://extensions and reopen this popup.');
      if (result.value?.observation) observationId = result.value.observation.id;
      if (result.value?.png) { document.getElementById('preview').src = `data:image/png;base64,${result.value.png}`; delete result.value.png; }
      if (kind === 'stop' || (kind === 'clickType' && result.ok)) observationId = undefined;
      const hint = result.error === 'native-timeout' ? '\nCheck native host registration and start the relay using the README commands.'
        : result.error === 'no-assigned-tab' ? '\nStart the fixture and choose Create agent tab first.'
        : result.error === 'stale-observation' ? '\nChoose Screenshot/context, then click and type within 10 seconds.' : '';
      status.textContent = JSON.stringify(result,null,2) + hint;
    } catch (error) {
      status.textContent = `Unable to run ${button.textContent}: ${error instanceof Error ? error.message : 'Unknown extension error'}`;
    } finally { button.disabled = false; }
  };
}

import { defineContentScript } from 'wxt/utils/define-content-script';
export default defineContentScript({
  matches:['http://127.0.0.1/*'],
  main:async () => { await import('../recording-content.js'); },
});

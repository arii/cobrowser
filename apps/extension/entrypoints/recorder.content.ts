import { defineContentScript } from 'wxt/utils/define-content-script';
export default defineContentScript({
  matches:['http://*/*','https://*/*'],
  main:async () => { await import('../recording-content.js'); },
});

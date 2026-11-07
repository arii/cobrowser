import { defineBackground } from 'wxt/utils/define-background';
export default defineBackground(async () => { await import('../background.js'); });

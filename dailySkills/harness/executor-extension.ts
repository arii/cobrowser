// Runs a seeded skill through the real extension path: skills:run -> perform() -> chrome.debugger input.
import { chromium, type BrowserContext, type Download, type Page } from 'playwright';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export interface RunOutcome {
  started: { ok: boolean; error?: string };
  run: any | null;
  durationMs: number;
  downloads: Download[];
  timedOut: boolean;
}

export class ExtensionExecutor {
  private downloads: Download[] = [];
  private constructor(private context: BrowserContext, private popup: Page, readonly extensionId: string, private profile: string, readonly pageErrors: string[]) {
    context.on('page', page => { page.on('download', download => this.downloads.push(download)); page.on('pageerror', error => pageErrors.push(error.message)); });
  }
  static async launch(raw = false) {
    const extension = resolve(raw ? 'apps/extension' : 'apps/extension/.output/chrome-mv3');
    const profile = await mkdtemp(join(tmpdir(), 'cobrowser-harness-'));
    const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, acceptDownloads: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = worker.url().split('/')[2];
    const popup = await context.newPage();
    const errors: string[] = [];
    popup.on('pageerror', error => errors.push(error.message));
    await popup.goto(`chrome-extension://${id}/popup.html`);
    return new ExtensionExecutor(context, popup, id, profile, errors);
  }
  private async worker() { return this.context.serviceWorkers()[0] ?? await this.context.waitForEvent('serviceworker'); }
  async send(kind: string, args: Record<string, unknown> = {}): Promise<any> {
    return this.popup.evaluate(message => (globalThis as any).chrome.runtime.sendMessage(message), { kind, ...args });
  }
  /** Replace the library with exactly this skill and clear any previous run state. */
  async seed(skill: unknown) {
    await this.popup.evaluate(async skill => {
      const chrome = (globalThis as any).chrome;
      await chrome.storage.local.set({ skillLibrary: [skill], dismissedSkillGoals: [] });
      await chrome.storage.session.remove(['skillRun', 'assigned', 'lastDispatch']);
    }, skill);
  }
  /** Deterministic stand-in for the input model: answers by control label, asks when it has no value. */
  async stubModel(values: Record<string, string>) {
    const worker = await this.worker();
    await worker.evaluate(values => {
      (globalThis as any).chrome.runtime.sendNativeMessage = async (_host: string, message: any) => {
        const value = values[message.target?.label];
        if (value === undefined) return { v: 1, kind: 'skill-input-result', seq: message.seq, decision: { status: 'needs_input', value: null, question: `What should "${message.target?.label}" be?`, explanation: 'The harness stub has no value for this field.', sourceSiteIds: [] } };
        return { v: 1, kind: 'skill-input-result', seq: message.seq, decision: { status: 'resolved', value, question: null, explanation: 'Harness stub value.', sourceSiteIds: [] } };
      };
    }, values);
  }
  async run(skillId: string, options: { instruction: string; parameters: Record<string, string>; expectDownload: boolean; timeoutMs?: number }): Promise<RunOutcome> {
    const since = this.downloads.length, startedAt = Date.now(), deadline = startedAt + (options.timeoutMs ?? 30_000);
    const started = await this.send('skills:run', { id: skillId, instruction: options.instruction, parameters: options.parameters });
    if (!started?.ok) return { started: { ok: false, error: started?.error ?? 'no response' }, run: null, durationMs: Date.now() - startedAt, downloads: [], timedOut: false };
    let run: any = null, timedOut = false;
    for (;;) {
      await this.popup.waitForTimeout(100);
      run = (await this.send('skills:list'))?.value?.run ?? null;
      if (run && !['running', 'needs_input'].includes(run.status)) break;
      if (run?.status === 'needs_input') { await this.send('skills:cancel'); }
      if (Date.now() > deadline) { timedOut = true; await this.send('skills:cancel'); break; }
    }
    if (options.expectDownload && run?.status === 'finished') {
      const until = Date.now() + 3000;
      while (this.downloads.length === since && Date.now() < until) await this.popup.waitForTimeout(100);
    }
    return { started: { ok: true }, run, durationMs: Date.now() - startedAt, downloads: this.downloads.slice(since), timedOut };
  }
  async readTab<T>(tabId: number, fn: string): Promise<T | undefined> {
    const worker = await this.worker();
    const results = await worker.evaluate(`chrome.scripting.executeScript({target:{tabId:${Number(tabId)}},func:${fn}})`) as any;
    return results?.[0]?.result;
  }
  async closeTabs(tabIds: number[]) {
    if (!tabIds?.length) return;
    const worker = await this.worker();
    await worker.evaluate(ids => (globalThis as any).chrome.tabs.remove(ids).catch(() => {}), tabIds);
  }
  async close() { await this.context.close(); await rm(this.profile, { recursive: true, force: true }); }
}
export const downloadBytes = async (download: Download) => readFile((await download.path())!);

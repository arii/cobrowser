// Shared by the service worker, the finish page and the options page. Kept free of side effects so
// extension pages that import it do not drag the service worker's listeners into their bundle.
export type Settings = { apiUrl: string; webUrl: string };
export const DEFAULT_SETTINGS: Settings = { apiUrl: "http://localhost:8000", webUrl: "http://localhost:3000" };

export async function getSettings(): Promise<Settings> {
  const s = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...s } as Settings;
}

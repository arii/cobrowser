import { DEFAULT_SETTINGS, type Settings } from "./settings.js";

const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
chrome.storage.sync.get(DEFAULT_SETTINGS).then((s) => {
  const v = { ...DEFAULT_SETTINGS, ...s } as Settings;
  $("apiUrl").value = v.apiUrl;
  $("webUrl").value = v.webUrl;
});
$("save").addEventListener("click", async () => {
  await chrome.storage.sync.set({ apiUrl: $("apiUrl").value.replace(/\/$/, ""), webUrl: $("webUrl").value.replace(/\/$/, "") });
  document.getElementById("status")!.textContent = "Saved";
});

// Bundles the extension into dist/ (load that folder unpacked in chrome://extensions).
import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");
mkdirSync("dist", { recursive: true });

const common = { bundle: true, target: "chrome120", sourcemap: true, logLevel: "info", outdir: "dist" };
const builds = [
  // service worker + extension pages are ES modules
  { ...common, entryPoints: ["src/background.ts", "src/finish.ts", "src/options.ts"], format: "esm" },
  // content scripts cannot be modules
  { ...common, entryPoints: ["src/content.ts"], format: "iife" },
];

const copyStatic = () => {
  cpSync("manifest.json", "dist/manifest.json");
  cpSync("finish.html", "dist/finish.html");
  cpSync("options.html", "dist/options.html");
  cpSync("icons", "dist/icons", { recursive: true });
};

if (watch) {
  const ctxs = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(ctxs.map((c) => c.watch()));
  copyStatic();
  console.log("watching…");
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  copyStatic();
}

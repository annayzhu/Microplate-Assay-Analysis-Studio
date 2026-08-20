import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(projectRoot, "dist");
const releaseDir = join(projectRoot, "release");
const sourceHtml = await readFile(join(distDir, "index.html"), "utf8");

const scriptMatch = sourceHtml.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/);
const styleMatch = sourceHtml.match(/<link[^>]+href="([^"]+\.css)"[^>]*>/);

if (!scriptMatch || !styleMatch) {
  throw new Error("Offline build failed: Vite JS or CSS asset was not found in dist/index.html.");
}

const assetPath = (reference) => join(distDir, reference.replace(/^\//, ""));
const [javascript, css] = await Promise.all([
  readFile(assetPath(scriptMatch[1]), "utf8"),
  readFile(assetPath(styleMatch[1]), "utf8"),
]);

const offlineHtml = sourceHtml
  .replace(styleMatch[0], () => `<style>\n${css}\n</style>`)
  .replace(scriptMatch[0], () => `<script type="module">\n${javascript}\n</script>`);

await mkdir(releaseDir, { recursive: true });
const outputPath = join(releaseDir, "Microplate-Assay-Studio-Offline.html");
await writeFile(outputPath, offlineHtml, "utf8");
console.log(`Offline app written to ${outputPath}`);

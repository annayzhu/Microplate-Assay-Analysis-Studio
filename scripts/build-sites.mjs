import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const offlineHtmlPath = resolve(projectRoot, "release/Microplate-Assay-Studio-Offline.html");
const workerDirectory = resolve(projectRoot, "dist/server");
const workerPath = resolve(workerDirectory, "index.js");

const html = await readFile(offlineHtmlPath, "utf8");
if (!html.includes("Microplate Assay Studio") || !html.includes("酶标数据入口")) {
  throw new Error("The offline build is incomplete and cannot be prepared for Sites.");
}

const serializedHtml = JSON.stringify(html)
  .replaceAll("\u2028", "\\u2028")
  .replaceAll("\u2029", "\\u2029");

const worker = `const html = ${serializedHtml};

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    return new Response(request.method === "HEAD" ? null : html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
};
`;

await mkdir(workerDirectory, { recursive: true });
await writeFile(workerPath, worker, "utf8");
console.log(`Sites worker written to ${workerPath}`);

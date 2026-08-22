import { chromium } from "/Users/annayzhu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const offlineHtml = process.argv[2];
const screenshotPath = process.argv[3];
if (!offlineHtml) throw new Error("Usage: node scripts/offline-smoke.mjs <offline-html> [screenshot-path]");

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Users/annayzhu/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

try {
  await page.goto(pathToFileURL(resolve(offlineHtml)).href, { waitUntil: "load" });
  await page.getByRole("tab", { name: "粘贴孔板读数" }).click();
  const header = `吸光值\t${Array.from({ length: 12 }, (_, index) => index + 1).join("\t")}`;
  const rows = Array.from({ length: 8 }, (_, rowIndex) => {
    const values = Array.from({ length: 12 }, (_, columnIndex) => ((rowIndex * 12 + columnIndex + 1) / 100).toFixed(2));
    return `${String.fromCharCode(65 + rowIndex)}\t${values.join("\t")}`;
  });
  await page.getByLabel("粘贴孔板读数").fill(["离线验证板", header, ...rows].join("\n"));
  await page.getByRole("button", { name: "解析并预览" }).click();
  await page.getByRole("heading", { name: "导入预览" }).waitFor();
  await page.getByRole("button", { name: "确认载入 1 块板" }).click();
  const visibleText = await page.locator("body").innerText();
  for (const signal of ["离线验证板", "96 个已测孔", "用户已填写", "人工录入"]) {
    if (!visibleText.includes(signal)) throw new Error(`Fresh offline package is missing expected signal: ${signal}`);
  }
  if (screenshotPath) await page.screenshot({ path: resolve(screenshotPath), fullPage: true });
  if (consoleErrors.length) throw new Error(`Offline page reported browser errors:\n${consoleErrors.join("\n")}`);
  console.log(JSON.stringify({ title: await page.title(), validatedSignals: ["离线验证板", "96 个已测孔", "用户已填写", "人工录入"], consoleErrors }, null, 2));
} finally {
  await browser.close();
}

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { assertSignals, dragBetweenWells, openAcceptanceBrowser } from "./acceptance-harness.mjs";

const offlineHtml = process.argv[2];
const screenshotPath = process.argv[3];
if (!offlineHtml) throw new Error("Usage: node scripts/offline-smoke.mjs <offline-html> [screenshot-path]");

const { browser, page, consoleErrors } = await openAcceptanceBrowser({ viewport: { width: 1440, height: 1000 } });

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
  await page.getByRole("heading", { name: "确认导入" }).waitFor();
  await page.getByRole("button", { name: "确认载入 1 块板" }).click();
  const visibleText = await page.locator("body").innerText();
  assertSignals(visibleText, ["离线验证板", "96 个已测孔", "用户已填写", "人工录入"], "Fresh offline package");
  await page.getByRole("button", { name: "进入板图与注释" }).click();
  await dragBetweenWells(page, "A1", "B2");
  await page.getByText("4 个已选", { exact: true }).waitFor();
  await page.getByRole("button", { name: "缩小孔板" }).click();
  if (await page.locator(".plate-scroll").getAttribute("data-zoom") !== "90") throw new Error("Offline zoom control did not step to 90%.");
  if (screenshotPath) await page.screenshot({ path: resolve(screenshotPath), fullPage: true });
  if (consoleErrors.length) throw new Error(`Offline page reported browser errors:\n${consoleErrors.join("\n")}`);
  console.log(JSON.stringify({ title: await page.title(), validatedSignals: ["离线验证板", "96 个已测孔", "用户已填写", "人工录入", "4-well box selection", "90% zoom"], consoleErrors }, null, 2));
} finally {
  await browser.close();
}

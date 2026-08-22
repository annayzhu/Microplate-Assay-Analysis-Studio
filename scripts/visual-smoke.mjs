import { chromium } from "/Users/annayzhu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import { resolve } from "node:path";

const screenshotDir = process.argv[2];
if (!screenshotDir) throw new Error("Usage: node scripts/visual-smoke.mjs <screenshot-directory>");

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Users/annayzhu/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

try {
  await page.goto("http://127.0.0.1:4178/", { waitUntil: "networkidle" });
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-start.png"), fullPage: true });

  await page.getByRole("tab", { name: "读数模板" }).click();
  await page.getByLabel("读数模板板型").selectOption("384");
  const templateDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载读数模板" }).click();
  const downloadedTemplate = await templateDownload;
  if (!downloadedTemplate.suggestedFilename().includes("384well")) {
    throw new Error(`Unexpected reading-template filename: ${downloadedTemplate.suggestedFilename()}`);
  }

  const manualMatrix = (plateName, offset) => {
    const rows = Array.from({ length: 8 }, (_, rowIndex) => {
      const values = Array.from({ length: 12 }, (_, columnIndex) => (offset + (rowIndex * 12 + columnIndex + 1) / 1_000).toFixed(3));
      return `${String.fromCharCode(65 + rowIndex)}\t${values.join("\t")}`;
    });
    return [plateName, `吸光值\t${Array.from({ length: 12 }, (_, index) => index + 1).join("\t")}`, ...rows].join("\n");
  };
  await page.getByRole("tab", { name: "粘贴孔板读数" }).click();
  await page.getByLabel("粘贴孔板读数").fill(`${manualMatrix("培养板 1", 0.4)}\n\n${manualMatrix("培养板 2", 0.8)}`);
  await page.getByRole("button", { name: "解析并预览" }).click();
  await page.getByRole("heading", { name: "导入预览" }).waitFor();
  const previewText = await page.locator("body").innerText();
  for (const signal of ["识别到 2 块独立孔板", "培养板 1", "培养板 2", "96 个已测孔"]) {
    if (!previewText.includes(signal)) throw new Error(`Manual-paste preview is missing expected signal: ${signal}`);
  }
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-manual-preview.png"), fullPage: true });
  await page.getByRole("button", { name: "确认载入 2 块板" }).click();
  await page.getByText("本次导入包含 2 块板", { exact: false }).waitFor();
  await page.getByRole("button", { name: "2. 培养板 2" }).click();
  const manualImportText = await page.locator("body").innerText();
  for (const signal of ["用户已填写", "人工录入", "450 nm", "96 个已测孔"]) {
    if (!manualImportText.includes(signal)) throw new Error(`Manual-paste workspace is missing expected signal: ${signal}`);
  }
  await page.getByRole("button", { name: "进入板图与注释" }).click();
  const manualLayoutText = await page.locator("body").innerText();
  for (const signal of ["96孔板 · 96个已测孔", "未指定 96", "板图尚未完成"]) {
    if (!manualLayoutText.includes(signal)) throw new Error(`Manual-paste layout is missing expected signal: ${signal}`);
  }
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-manual-layout.png"), fullPage: true });
  await page.getByRole("button", { name: /分析与导出/ }).click();
  const manualAnalysisText = await page.locator("body").innerText();
  if (!manualAnalysisText.includes("ROLE_UNASSIGNED")) throw new Error("Manual-paste analysis did not preserve the unassigned-well QC gate.");
  await page.locator(".workspace-nav").getByRole("button", { name: /数据导入/ }).click();
  await page.getByRole("tab", { name: "仪器结果文件" }).click();

  const fixturePath = resolve("tests/fixtures/varioskan-lux-cck8-day0.xlsx");
  await page.locator('input[type="file"][accept=".xml,.xlsx,.xls,.skax"]').setInputFiles(fixturePath);
  await page.waitForTimeout(1_000);

  const importedText = await page.locator("body").innerText();
  const requiredImportSignals = ["本次实验基本信息", "CCK-8 / WST-8", "吸光", "450 nm", "96 个已测孔"];
  for (const signal of requiredImportSignals) {
    if (!importedText.includes(signal)) {
      throw new Error(`Imported view is missing expected signal: ${signal}\n\nVisible page text:\n${importedText.slice(0, 5000)}`);
    }
  }
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-imported.png"), fullPage: true });

  await page.getByRole("button", { name: "进入板图与注释" }).click();
  const layoutText = await page.locator("body").innerText();
  const requiredLayoutSignals = ["96孔板 · 96个已测孔", "样本 72", "质控 12", "空白 12", "板图尚未完成"];
  for (const signal of requiredLayoutSignals) {
    if (!layoutText.includes(signal)) {
      throw new Error(`Layout view is missing expected signal: ${signal}\n\nVisible page text:\n${layoutText.slice(0, 5000)}`);
    }
  }
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-layout.png"), fullPage: true });

  await page.getByRole("button", { name: /分析与导出/ }).click();
  await page.getByRole("heading", { name: "分析与导出" }).waitFor();
  const analysisText = await page.locator("body").innerText();
  if (!analysisText.includes("LAYOUT_INCOMPLETE")) throw new Error("Analysis view did not preserve the incomplete-layout QC gate.");
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-analysis.png"), fullPage: true });

  await page.locator(".workspace-nav").getByRole("button", { name: /数据导入/ }).click();
  const dualLucPath = resolve("酶标仪demo/Promega Dual-Luciferase Reporter Assay with Varioskan LUX.xlsx");
  await page.locator('input[type="file"][accept=".xml,.xlsx,.xls,.skax"]').setInputFiles(dualLucPath);
  await page.getByText("Dual-Luciferase Reporter Assay", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "进入分析与导出" }).click();
  const genericText = await page.locator("body").innerText();
  const requiredGenericSignals = ["测量与计算步骤", "Luminescence: Firefly", "Luminescence: Renilla", "Signal normalization", "Standard curve", "导出全部长表 CSV"];
  for (const signal of requiredGenericSignals) {
    if (!genericText.includes(signal)) throw new Error(`Generic LUX explorer is missing expected signal: ${signal}`);
  }
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-dual-luciferase.png"), fullPage: true });

  if (process.env.VICTOR_XLS) {
    await page.locator(".workspace-nav").getByRole("button", { name: /数据导入/ }).click();
    await page.locator('input[type="file"][accept=".xml,.xlsx,.xls,.skax"]').setInputFiles(process.env.VICTOR_XLS);
    await page.waitForTimeout(1_000);
    const victorText = await page.locator("body").innerText();
    const requiredVictorSignals = ["Resazurin", "荧光", "Ex 570 nm / Em 600 nm", "Counts", "VICTOR 系列", "S/N 4207933", "84 个已测孔"];
    for (const signal of requiredVictorSignals) {
      if (!victorText.includes(signal)) {
        throw new Error(`VICTOR view is missing expected signal: ${signal}\n\nVisible page text:\n${victorText.slice(0, 5000)}`);
      }
    }
    await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-victor-resazurin.png"), fullPage: true });
    await page.getByRole("button", { name: "进入板图与注释" }).click();
    const victorLayoutText = await page.locator("body").innerText();
    for (const signal of ["96孔板 · 84个已测孔", "样本 84", "空白 0"]) {
      if (!victorLayoutText.includes(signal)) throw new Error(`VICTOR layout is missing expected signal: ${signal}`);
    }
    await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-victor-layout.png"), fullPage: true });
  }

  const result = {
    title: await page.title(),
    importSignals: requiredImportSignals,
    layoutSignals: requiredLayoutSignals,
    incompleteLayoutGateVisible: analysisText.includes("LAYOUT_INCOMPLETE"),
    manualUnassignedGateVisible: manualAnalysisText.includes("ROLE_UNASSIGNED"),
    genericLuxSignals: requiredGenericSignals,
    consoleErrors,
  };
  console.log(JSON.stringify(result, null, 2));
  if (consoleErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
}

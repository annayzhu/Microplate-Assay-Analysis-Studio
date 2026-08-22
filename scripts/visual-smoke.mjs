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

async function dragBetweenWells(startWell, endWell, additive = false, selectingScreenshot = "") {
  const start = await page.locator(`[data-well="${startWell}"]`).boundingBox();
  const end = await page.locator(`[data-well="${endWell}"]`).boundingBox();
  if (!start || !end) throw new Error(`Could not locate drag endpoints ${startWell} → ${endWell}`);
  if (additive) await page.keyboard.down("Control");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 });
  if (selectingScreenshot) {
    await page.locator(".plate-selection-box").waitFor();
    await page.screenshot({ path: resolve(screenshotDir, selectingScreenshot), fullPage: false });
  }
  await page.mouse.up();
  if (additive) await page.keyboard.up("Control");
}

try {
  await page.goto("http://127.0.0.1:4178/", { waitUntil: "networkidle" });
  const landingText = await page.locator("body").innerText();
  for (const signal of ["完整分析可用", "数据导入与预览可用", "计划中"]) {
    if (!landingText.includes(signal)) throw new Error(`Module capability states are missing: ${signal}`);
  }
  await page.getByRole("button", { name: /蛋白定量/ }).click();
  const proteinText = await page.locator("body").innerText();
  for (const signal of ["标准品浓度和单位", "仪器标准曲线核查", "本系统标准曲线复算"]) {
    if (!proteinText.includes(signal)) throw new Error(`Protein workflow guidance is missing: ${signal}`);
  }
  for (const tabName of ["仪器结果文件", "粘贴孔板读数", "读数模板"]) {
    if (!await page.getByRole("tab", { name: tabName }).isVisible()) throw new Error(`Shared import tab is missing from protein workflow: ${tabName}`);
  }
  await page.getByRole("button", { name: /ATP 发光定量/ }).click();
  if (!(await page.locator("body").innerText()).includes("积分或选取时间窗")) throw new Error("ATP-specific workflow guidance is missing.");
  await page.getByRole("button", { name: /单 \/ 双荧光素酶/ }).click();
  if (!(await page.locator("body").innerText()).includes("Firefly 与 Renilla 步骤映射")) throw new Error("Luciferase-specific workflow guidance is missing.");
  await page.getByRole("button", { name: /细胞活性 \/ 细胞增殖/ }).click();
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-start.png"), fullPage: true });

  await page.getByRole("button", { name: /蛋白定量/ }).click();
  await page.locator('input[type="file"][accept=".xml,.xlsx,.xls,.skax"]').setInputFiles(resolve("tests/fixtures/varioskan-lux-cck8-day0.xlsx"));
  await page.getByRole("heading", { name: /导入预览与实验类型确认/ }).waitFor();
  const mismatchPreview = await page.locator(".import-preview").innerText();
  if (!mismatchPreview.includes("选择与识别不一致")) throw new Error("Assay mismatch was not made visible in import preview.");
  const mismatchLoadButton = page.getByRole("button", { name: "确认载入 1 块板" });
  if (!await mismatchLoadButton.isDisabled()) throw new Error("Assay mismatch did not require explicit confirmation.");
  await page.getByText("我已核对实验记录", { exact: false }).click();
  if (await mismatchLoadButton.isDisabled()) throw new Error("Explicit assay mismatch confirmation did not unlock import.");
  await page.getByRole("button", { name: "取消" }).click();
  await page.getByRole("button", { name: /细胞活性 \/ 细胞增殖/ }).click();

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
  await dragBetweenWells("A1", "C3", false, "microplate-studio-box-selecting.png");
  await page.getByText("9 个已选", { exact: true }).waitFor();
  await dragBetweenWells("D1", "D2", true);
  await page.getByText("11 个已选", { exact: true }).waitFor();
  await page.keyboard.down("Control");
  await page.locator('[data-well="A1"]').click();
  await page.keyboard.up("Control");
  await page.getByText("10 个已选", { exact: true }).waitFor();

  const zoomBefore = await page.locator(".plate-scroll").getAttribute("data-zoom");
  await page.getByRole("button", { name: "缩小孔板" }).click();
  const zoomAfter = await page.locator(".plate-scroll").getAttribute("data-zoom");
  if (Number(zoomAfter) !== Number(zoomBefore) - 10) throw new Error(`Zoom did not step down by 10%: ${zoomBefore} → ${zoomAfter}`);
  await page.getByRole("button", { name: "重置为百分之百" }).click();
  if (await page.locator(".plate-scroll").getAttribute("data-zoom") !== "100") throw new Error("Zoom reset did not return to 100%.");

  await page.getByLabel("分组 · Group").fill("ManualGroup");
  await page.getByLabel("生物学重复").fill("Bio1");
  await page.getByText("尚未应用", { exact: true }).waitFor();
  await page.locator('[data-well="H12"]').click();
  if (await page.getByLabel("分组 · Group").inputValue() !== "ManualGroup") throw new Error("Draft did not persist after changing the selected wells.");
  await page.getByRole("button", { name: "应用到所选 1 个孔" }).click();
  await page.getByText("已应用", { exact: true }).waitFor();
  await page.getByLabel("分组 · Group").fill("尚未保存的分组");
  let dirtyPromptSeen = false;
  page.once("dialog", async (dialog) => { dirtyPromptSeen = true; await dialog.dismiss(); });
  await page.locator(".workspace-nav").getByRole("button", { name: /分析与导出/ }).click();
  if (!dirtyPromptSeen || !await page.getByRole("heading", { name: "板图与实验注释" }).isVisible()) throw new Error("Dirty annotation draft was not protected before navigation.");
  await page.getByRole("button", { name: "清空填写" }).click();
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-manual-layout.png"), fullPage: true });
  await page.setViewportSize({ width: 980, height: 1000 });
  const compactPlate = await page.locator(".plate-panel").boundingBox();
  const compactAnnotation = await page.locator(".annotation-panel").boundingBox();
  if (!compactPlate || !compactAnnotation || compactAnnotation.y <= compactPlate.y) throw new Error("Narrow layout did not move the annotation panel below the plate.");
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-layout-narrow.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("button", { name: /分析与导出/ }).click();
  const manualAnalysisText = await page.locator("body").innerText();
  if (!manualAnalysisText.includes("ROLE_UNASSIGNED")) throw new Error("Manual-paste analysis did not preserve the unassigned-well QC gate.");
  await page.locator(".workspace-nav").getByRole("button", { name: /数据导入/ }).click();
  const projectDownloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存可复现项目" }).click();
  const projectDownload = await projectDownloadEvent;
  const projectPath = await projectDownload.path();
  if (!projectPath || !projectDownload.suggestedFilename().includes("reproducible-project.json")) throw new Error("Reproducible project export was not produced.");
  await page.locator('input[type="file"][accept=".json"]').setInputFiles(projectPath);
  await page.getByRole("heading", { name: /导入预览与实验类型确认/ }).waitFor();
  if (!(await page.locator(".import-preview").innerText()).includes("可复现项目")) throw new Error("Project file did not re-enter the shared preview seam.");
  await page.getByRole("button", { name: "确认载入 2 块板" }).click();
  await page.getByRole("button", { name: "2. 培养板 2" }).click();
  await page.getByRole("button", { name: "进入板图与注释" }).click();
  await page.locator('[data-well="H12"]').click();
  if (!(await page.locator(".well-detail").innerText()).includes("ManualGroup")) throw new Error("Project round-trip did not restore current annotations.");
  await page.locator(".workspace-nav").getByRole("button", { name: /数据导入/ }).click();
  await page.getByRole("tab", { name: "仪器结果文件" }).click();

  const fixturePath = resolve("tests/fixtures/varioskan-lux-cck8-day0.xlsx");
  await page.locator('input[type="file"][accept=".xml,.xlsx,.xls,.skax"]').setInputFiles(fixturePath);
  await page.getByRole("heading", { name: /导入预览与实验类型确认/ }).waitFor();
  const fixturePreview = await page.locator(".import-preview").innerText();
  if (!fixturePreview.includes("系统识别") || !fixturePreview.includes("细胞活性 / 细胞增殖")) throw new Error("Instrument import did not pass through assay review preview.");
  await page.getByRole("button", { name: "确认载入 1 块板" }).click();

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
  await page.getByRole("heading", { name: /导入预览与实验类型确认/ }).waitFor();
  const dualPreview = await page.locator(".import-preview").innerText();
  if (!dualPreview.includes("单 / 双荧光素酶")) throw new Error("Dual-Luciferase was not routed through the Luciferase module preview.");
  await page.getByRole("button", { name: "确认载入 1 块板" }).click();
  await page.getByText("Dual-Luciferase Reporter Assay", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "进入板图与注释" }).click();
  await page.getByRole("button", { name: "进入分析" }).click();
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

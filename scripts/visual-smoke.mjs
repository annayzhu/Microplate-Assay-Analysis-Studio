import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { assertSignals, dragBetweenWells, manualPlateMatrix, openAcceptanceBrowser } from "./acceptance-harness.mjs";

const screenshotDir = process.argv[2];
if (!screenshotDir) throw new Error("Usage: node scripts/visual-smoke.mjs <screenshot-directory>");
await mkdir(resolve(screenshotDir), { recursive: true });

const { browser, page, consoleErrors } = await openAcceptanceBrowser();
const baseUrl = process.env.MICROPLATE_BASE_URL ?? "http://127.0.0.1:4178/";

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
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
  const topbarBounds = await page.locator(".topbar").boundingBox();
  const assayStripBounds = await page.locator(".assay-strip").boundingBox();
  const sectionCopySize = Number.parseFloat(await page.locator(".section-heading p").first().evaluate((element) => getComputedStyle(element).fontSize));
  if (!topbarBounds || topbarBounds.height > 60) throw new Error(`Top bar is no longer compact: ${topbarBounds?.height ?? "missing"}px.`);
  if (!assayStripBounds || assayStripBounds.height > 230) throw new Error(`Assay selector is no longer compact: ${assayStripBounds?.height ?? "missing"}px.`);
  if (sectionCopySize < 11) throw new Error(`Workspace copy is too small: ${sectionCopySize}px.`);
  if (await page.locator(".eyebrow").count()) throw new Error("Redundant section eyebrow labels returned to the workspace.");

  if (process.env.CCK8_XLS) {
    await page.getByRole("button", { name: /蛋白定量/ }).click();
    await page.locator('input[type="file"][accept=".xml,.xlsx,.xls,.skax"]').setInputFiles(process.env.CCK8_XLS);
    await page.getByRole("heading", { name: /导入预览与实验类型确认/ }).waitFor();
    const mismatchPreview = await page.locator(".import-preview").innerText();
    if (!mismatchPreview.includes("选择与识别不一致")) throw new Error("Assay mismatch was not made visible in import preview.");
    const mismatchLoadButton = page.getByRole("button", { name: "确认载入 1 块板" });
    if (!await mismatchLoadButton.isDisabled()) throw new Error("Assay mismatch did not require explicit confirmation.");
    await page.getByText("我已核对实验记录", { exact: false }).click();
    if (await mismatchLoadButton.isDisabled()) throw new Error("Explicit assay mismatch confirmation did not unlock import.");
    await page.getByRole("button", { name: "取消" }).click();
  }
  await page.getByRole("button", { name: /细胞活性 \/ 细胞增殖/ }).click();

  await page.getByRole("tab", { name: "读数模板" }).click();
  await page.getByLabel("读数模板板型").selectOption("384");
  const templateDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载读数模板" }).click();
  const downloadedTemplate = await templateDownload;
  if (!downloadedTemplate.suggestedFilename().includes("384well")) {
    throw new Error(`Unexpected reading-template filename: ${downloadedTemplate.suggestedFilename()}`);
  }

  await page.getByRole("tab", { name: "粘贴孔板读数" }).click();
  await page.getByLabel("粘贴孔板读数").fill(`${manualPlateMatrix("培养板 1", 0.4)}\n\n${manualPlateMatrix("培养板 2", 0.8)}`);
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
  await dragBetweenWells(page, "A1", "C3", { screenshotPath: resolve(screenshotDir, "microplate-studio-box-selecting.png") });
  await page.getByText("9 个已选", { exact: true }).waitFor();
  await dragBetweenWells(page, "D1", "D2", { additive: true });
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
  const expandedPlateBounds = await page.locator(".plate-panel").boundingBox();
  await page.getByRole("button", { name: "收起批量注释" }).click();
  const collapsedPlateBounds = await page.locator(".plate-panel").boundingBox();
  if (!expandedPlateBounds || !collapsedPlateBounds || collapsedPlateBounds.width <= expandedPlateBounds.width + 150) throw new Error("Collapsing batch annotations did not return meaningful width to the plate.");
  if (await page.getByLabel("分组 · Group").isVisible()) throw new Error("Collapsed batch annotations left form controls in the visible or keyboard flow.");
  if (await page.locator(".annotation-collapsed-count").innerText() !== "1") throw new Error("Collapsed batch annotations did not preserve the selected-well count.");
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-annotation-collapsed.png"), fullPage: true });
  await page.getByRole("button", { name: "展开批量注释" }).click();
  if (!await page.getByLabel("分组 · Group").isVisible()) throw new Error("Batch annotations did not restore after expansion.");
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-manual-layout.png"), fullPage: true });
  await page.setViewportSize({ width: 980, height: 1000 });
  const compactPlate = await page.locator(".plate-panel").boundingBox();
  const compactAnnotation = await page.locator(".annotation-panel").boundingBox();
  if (!compactPlate || !compactAnnotation || compactAnnotation.y <= compactPlate.y) throw new Error("Narrow layout did not move the annotation panel below the plate.");
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-layout-narrow.png"), fullPage: true });
  const narrowOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (narrowOverflow > 1) throw new Error(`Narrow workspace has ${narrowOverflow}px of page-level horizontal overflow.`);
  await page.getByRole("button", { name: "收起批量注释" }).click();
  const compactCollapsedAnnotation = await page.locator(".annotation-panel").boundingBox();
  if (!compactCollapsedAnnotation || compactCollapsedAnnotation.height > 100) throw new Error("Narrow collapsed annotation panel did not become a compact horizontal bar.");
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-layout-narrow-collapsed.png"), fullPage: true });
  await page.getByRole("button", { name: "展开批量注释" }).click();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("button", { name: /分析与导出/ }).click();
  const manualAnalysisText = await page.locator("body").innerText();
  if (!manualAnalysisText.includes("ROLE_UNASSIGNED")) throw new Error("Manual-paste analysis did not preserve the unassigned-well QC gate.");
  if (!manualAnalysisText.includes("只保留语义明确的 blank_corrected_* 基础列")) throw new Error("Analysis UI did not explain the explicit export schema.");
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
  const rawValueBeforeLayoutRoundTrip = await page.locator('[data-well="H12"] strong').innerText();
  const layoutDownloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出当前板布局" }).click();
  const layoutDownload = await layoutDownloadEvent;
  const layoutPath = await layoutDownload.path();
  if (!layoutPath || !layoutDownload.suggestedFilename().includes("reusable-layout.csv")) throw new Error("Reusable plate-layout export was not produced.");
  await page.locator('input[type="file"][accept=".csv,.tsv,.txt"]').setInputFiles(layoutPath);
  await page.getByRole("heading", { name: "板布局导入预览" }).waitFor();
  const layoutPreviewBounds = await page.getByLabel("板布局导入预览").boundingBox();
  if (!layoutPreviewBounds || layoutPreviewBounds.height > 260) throw new Error(`Reusable layout preview is still too tall: ${layoutPreviewBounds?.height ?? "missing"}px.`);
  const layoutPreviewText = await page.getByLabel("板布局导入预览").innerText();
  for (const signal of ["96", "成功匹配孔", "来源板型", "8 × 12", "新检测的原始读数保持不变"]) {
    if (!layoutPreviewText.includes(signal)) throw new Error(`Reusable layout preview is missing expected signal: ${signal}`);
  }
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-layout-import-preview.png"), fullPage: true });
  await page.getByText("清空并重新填写", { exact: true }).click();
  await page.getByRole("button", { name: "应用到当前板的 96 个孔" }).click();
  if (await page.locator('[data-well="H12"] strong').innerText() !== rawValueBeforeLayoutRoundTrip) throw new Error("Layout import changed the displayed raw reading.");
  const restoredLayoutDetail = await page.locator(".well-detail").innerText();
  if (!restoredLayoutDetail.includes("ManualGroup")) throw new Error(`Reusable layout import did not restore annotations.\n${restoredLayoutDetail}`);
  await page.getByLabel("分组 · Group").fill("AdjustedGroup");
  await page.getByRole("button", { name: "应用到所选 1 个孔" }).click();
  if (!(await page.locator(".well-detail").innerText()).includes("AdjustedGroup")) throw new Error("Imported layout could not be adjusted after application.");
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-layout-reuse.png"), fullPage: true });
  await page.locator(".workspace-nav").getByRole("button", { name: /数据导入/ }).click();
  await page.getByRole("tab", { name: "仪器结果文件" }).click();

  let requiredImportSignals = [];
  let requiredLayoutSignals = [];
  let incompleteLayoutGateVisible = false;
  if (process.env.CCK8_XLS) {
    await page.locator('input[type="file"][accept=".xml,.xlsx,.xls,.skax"]').setInputFiles(process.env.CCK8_XLS);
    await page.getByRole("heading", { name: /导入预览与实验类型确认/ }).waitFor();
    const fixturePreview = await page.locator(".import-preview").innerText();
    if (!fixturePreview.includes("系统识别") || !fixturePreview.includes("细胞活性 / 细胞增殖")) throw new Error("Instrument import did not pass through assay review preview.");
    await page.getByRole("button", { name: "确认载入 1 块板" }).click();
    const importedText = await page.locator("body").innerText();
    requiredImportSignals = ["本次实验基本信息", "CCK-8 / WST-8", "吸光", "450 nm", "96 个已测孔"];
    assertSignals(importedText, requiredImportSignals, "Instrument import");
    await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-imported.png"), fullPage: true });
    await page.getByRole("button", { name: "进入板图与注释" }).click();
    const layoutText = await page.locator("body").innerText();
    requiredLayoutSignals = ["96孔板 · 96个已测孔", "样本 72", "质控 12", "空白 12", "板图尚未完成"];
    assertSignals(layoutText, requiredLayoutSignals, "Instrument layout");
    await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-layout.png"), fullPage: true });
    await page.getByRole("button", { name: /分析与导出/ }).click();
    await page.getByRole("heading", { name: "分析与导出" }).waitFor();
    const analysisText = await page.locator("body").innerText();
    incompleteLayoutGateVisible = analysisText.includes("LAYOUT_INCOMPLETE");
    if (!incompleteLayoutGateVisible) throw new Error("Analysis view did not preserve the incomplete-layout QC gate.");
    await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-analysis.png"), fullPage: true });
  }

  let genericLuxSignals = [];
  if (process.env.DUAL_LUC_XLS) {
    await page.locator(".workspace-nav").getByRole("button", { name: /数据导入/ }).click();
    await page.locator('input[type="file"][accept=".xml,.xlsx,.xls,.skax"]').setInputFiles(process.env.DUAL_LUC_XLS);
    await page.getByRole("heading", { name: /导入预览与实验类型确认/ }).waitFor();
    const dualPreview = await page.locator(".import-preview").innerText();
    if (!dualPreview.includes("单 / 双荧光素酶")) throw new Error("Dual-Luciferase was not routed through the Luciferase module preview.");
    await page.getByRole("button", { name: "确认载入 1 块板" }).click();
    await page.getByText("Dual-Luciferase Reporter Assay", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "进入板图与注释" }).click();
    await page.getByRole("button", { name: "进入分析" }).click();
    const genericText = await page.locator("body").innerText();
    genericLuxSignals = ["测量与计算步骤", "Luminescence: Firefly", "Luminescence: Renilla", "Signal normalization", "Standard curve", "导出全部长表 CSV"];
    assertSignals(genericText, genericLuxSignals, "Generic LUX explorer");
    await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-dual-luciferase.png"), fullPage: true });
  }

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
    incompleteLayoutGateVisible,
    manualUnassignedGateVisible: manualAnalysisText.includes("ROLE_UNASSIGNED"),
    genericLuxSignals,
    optionalVendorScenarios: { cck8: Boolean(process.env.CCK8_XLS), dualLuciferase: Boolean(process.env.DUAL_LUC_XLS), victor: Boolean(process.env.VICTOR_XLS) },
    consoleErrors,
  };
  console.log(JSON.stringify(result, null, 2));
  if (consoleErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
}

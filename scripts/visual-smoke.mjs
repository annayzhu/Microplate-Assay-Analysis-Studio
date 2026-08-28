import { resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import XLSX from "xlsx-js-style";
import { assertSignals, dragBetweenWells, manualPlateMatrix, openAcceptanceBrowser } from "./acceptance-harness.mjs";

const screenshotDir = process.argv[2];
if (!screenshotDir) throw new Error("Usage: node scripts/visual-smoke.mjs <screenshot-directory>");
await mkdir(resolve(screenshotDir), { recursive: true });

const { browser, page, consoleErrors } = await openAcceptanceBrowser();
const baseUrl = process.env.MICROPLATE_BASE_URL ?? "http://127.0.0.1:4178/";

async function verifyLayoutPreviousStep(browserPage) {
  const backToImportButton = browserPage.getByRole("button", { name: "返回数据导入" });
  if (!await backToImportButton.isVisible()) throw new Error("The layout page does not expose a visible previous-step action.");
  await backToImportButton.click();
  await browserPage.getByRole("heading", { name: "导入孔板读数" }).waitFor();
  await browserPage.getByRole("button", { name: "进入板图与注释" }).click();
}

async function verifyAnalysisPreviousStep(browserPage) {
  const backToLayoutButton = browserPage.getByRole("button", { name: "返回板图与注释" });
  if (!await backToLayoutButton.isVisible()) throw new Error("The analysis page does not expose a visible previous-step action.");
  await backToLayoutButton.click();
  await browserPage.getByRole("heading", { name: "板图与实验注释" }).waitFor();
  await browserPage.getByRole("button", { name: "进入分析" }).click();
}

function normalizationPlate(name, timepoint, blank, values) {
  const wells = [
    { well: "A1", row: "A", column: 1, rawValue: blank, role: "blank" },
    { well: "A2", row: "A", column: 2, rawValue: blank, role: "blank" },
  ];
  let cursor = 0;
  Object.entries(values).forEach(([group, replicates]) => replicates.forEach((correctedMean, biologicalIndex) => {
    [-0.02, 0.02].forEach((offset, technicalIndex) => {
      const row = String.fromCharCode(66 + Math.floor(cursor / 12));
      const column = cursor % 12 + 1;
      wells.push({
        well: `${row}${column}`, row, column, rawValue: blank + correctedMean + offset,
        instrumentLabel: "", role: group === "Control" ? "control" : "sample",
        sampleId: `${group}-Bio${biologicalIndex + 1}`, group, treatment: "", concentration: "", timepoint,
        biologicalReplicate: `Bio${biologicalIndex + 1}`, technicalReplicate: `T${technicalIndex + 1}`,
        excluded: false, notes: "",
      });
      cursor += 1;
    });
  }));
  wells[0] = { instrumentLabel: "", sampleId: "", group: "", treatment: "", concentration: "", timepoint: "", biologicalReplicate: "", technicalReplicate: "", excluded: false, notes: "", ...wells[0] };
  wells[1] = { instrumentLabel: "", sampleId: "", group: "", treatment: "", concentration: "", timepoint: "", biologicalReplicate: "", technicalReplicate: "", excluded: false, notes: "", ...wells[1] };
  return {
    metadata: {
      sourceKind: "manual-paste", sourceFileName: `${name}.tsv`, sourceExperiment: "Browser normalization", runTimestamp: "",
      assayMethod: "cck8", assayMethodLabel: "CCK-8", assayMethodEvidence: "user-reported", detectionMode: "absorbance", signalUnit: "OD",
      wavelengthNm: 450, excitationWavelengthNm: null, emissionWavelengthNm: null, referenceWavelengthNm: null, measurementName: "Absorbance",
      plateName: name, plateType: "96-well", instrumentManufacturer: "", instrumentModel: "Manual", instrumentSerialNumber: "", assayId: "",
      protocolName: "", readDirection: "", measurementTimeSeconds: null, temperatureStartC: null, temperatureEndC: null, sheetName: name,
      adapterId: "browser:normalization", assayModuleId: "cell-viability", detectedAssayModuleId: "cell-viability", selectedAssayModuleId: "cell-viability",
      confirmedAssayModuleId: "cell-viability", assayAssignmentDecision: "project-restored",
    },
    rows: 8, columns: 12, wells, warnings: [],
  };
}

const normalizationProjectPath = resolve(screenshotDir, "browser-baseline-normalization-project.json");
await writeFile(normalizationProjectPath, JSON.stringify({
  schemaVersion: 3,
  tool: { id: "microplate-assay-studio", version: "0.6.4" },
  generatedAt: new Date(0).toISOString(),
  experiment: { name: "Browser baseline normalization", operator: "", date: "", notes: "" },
  activeModuleId: "cell-viability",
  analysisConfig: { controlGroup: "Control", relativeToControlEnabled: false, technicalCvThresholdPercent: 15, blankCvThresholdPercent: 10, baselineNormalization: { enabled: false, plateSelectionMode: "all", participatingPlateIds: [], baselineTimepoint: "", scope: "within-group", referenceGroup: "", method: "auto", scale: "fold", uncertaintyDisplay: "ci95" } },
  plates: [
    normalizationPlate("Plate Day 0", "Day 0", 0.1, { Control: [1, 1.2, 0.8], Drug: [1, 2, 4] }),
    normalizationPlate("Plate Day 1", "Day 1", 0.2, { Control: [1.4, 1.5, 1.3], Drug: [2, 6, 8] }),
  ],
}, null, 2));

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const landingText = await page.locator("body").innerText();
  for (const signal of ["完整分析可用", "数据导入与预览可用", "计划中"]) {
    if (!landingText.includes(signal)) throw new Error(`Module capability states are missing: ${signal}`);
  }
  await page.getByRole("button", { name: /蛋白定量/ }).click();
  const workflowDisclosure = page.locator(".assay-workflow-panel.compact-workflow");
  if (await workflowDisclosure.count() !== 1) throw new Error("Compact assay guidance disclosure is missing from the import workspace.");
  if (await workflowDisclosure.getAttribute("open") !== null) throw new Error("Assay guidance should be collapsed by default.");
  const importControlBounds = await page.locator(".dropzone").boundingBox();
  const workflowDisclosureBounds = await workflowDisclosure.boundingBox();
  if (!importControlBounds || !workflowDisclosureBounds || workflowDisclosureBounds.y <= importControlBounds.y) {
    throw new Error("Assay guidance is not positioned below the active import control.");
  }
  await workflowDisclosure.locator("summary").click();
  const proteinText = await page.locator("body").innerText();
  for (const signal of ["标准品浓度和单位", "仪器标准曲线核查", "本系统标准曲线复算"]) {
    if (!proteinText.includes(signal)) throw new Error(`Protein workflow guidance is missing: ${signal}`);
  }
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-guidance-expanded.png"), fullPage: true });
  for (const tabName of ["仪器结果文件", "粘贴孔板读数", "读数模板"]) {
    if (!await page.getByRole("tab", { name: tabName }).isVisible()) throw new Error(`Shared import tab is missing from protein workflow: ${tabName}`);
  }
  await page.getByRole("button", { name: /ATP 发光定量/ }).click();
  if (!(await page.locator("body").innerText()).includes("积分或选取时间窗")) throw new Error("ATP-specific workflow guidance is missing.");
  await page.getByRole("button", { name: /单 \/ 双荧光素酶/ }).click();
  if (!(await page.locator("body").innerText()).includes("Firefly 与 Renilla 步骤映射")) throw new Error("Luciferase-specific workflow guidance is missing.");
  await page.getByRole("button", { name: /细胞活性 \/ 细胞增殖/ }).click();
  if (await workflowDisclosure.getAttribute("open") !== null) await workflowDisclosure.locator("summary").click();
  if (!(await workflowDisclosure.innerText()).includes("支持吸光、荧光和发光型细胞活性读数")) throw new Error("Cell-viability guidance does not name all supported detection modes.");
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-start.png"), fullPage: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  const alignedFrameLocators = [".topbar-inner", ".assay-strip-inner", ".workspace"];
  const alignedFrameBounds = await Promise.all(alignedFrameLocators.map((selector) => page.locator(selector).boundingBox()));
  if (alignedFrameBounds.some((bounds) => !bounds)) throw new Error("A global alignment frame is missing.");
  const [headerFrame, assayFrame, workspaceFrame] = alignedFrameBounds;
  const frameLefts = alignedFrameBounds.map((bounds) => Math.round(bounds.x));
  const frameRights = alignedFrameBounds.map((bounds) => Math.round(bounds.x + bounds.width));
  if (new Set(frameLefts).size > 1 || new Set(frameRights).size > 1) {
    throw new Error(`Global content frames are not aligned: left ${frameLefts.join(", ")}; right ${frameRights.join(", ")}.`);
  }
  if (!headerFrame || !assayFrame || !workspaceFrame) throw new Error("Unable to verify global content frame alignment.");
  if (await page.getByText("实验记录信息", { exact: true }).count()) throw new Error("Removed experiment-record strip returned to the import workspace.");
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-global-frame-wide.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 800 });
  const mobileImportOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (mobileImportOverflow > 1) throw new Error(`Minimum-width import workspace has ${mobileImportOverflow}px of page-level horizontal overflow.`);
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-import-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 980, height: 1000 });
  const importOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (importOverflow > 1) throw new Error(`Compact import workspace has ${importOverflow}px of page-level horizontal overflow.`);
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-import-narrow.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
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
    await page.getByRole("heading", { name: "确认导入" }).waitFor();
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
  await page.getByRole("heading", { name: "确认导入" }).waitFor();
  const previewText = await page.locator("body").innerText();
  for (const signal of ["识别到 2 块独立孔板", "培养板 1", "培养板 2", "96 个已测孔"]) {
    if (!previewText.includes(signal)) throw new Error(`Manual-paste preview is missing expected signal: ${signal}`);
  }
  const compactPreviewBounds = await page.locator(".import-preview").boundingBox();
  if (!compactPreviewBounds || compactPreviewBounds.height > 330) throw new Error(`Import preview is still too tall: ${compactPreviewBounds?.height ?? "missing"}px.`);
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-manual-preview.png"), fullPage: true });
  await page.setViewportSize({ width: 980, height: 1000 });
  const previewOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (previewOverflow > 1) throw new Error(`Import preview has ${previewOverflow}px of page-level horizontal overflow.`);
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-manual-preview-narrow.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("button", { name: "确认载入 2 块板" }).click();
  await page.getByText("当前项目包含 2 块板", { exact: false }).waitFor();
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

  const layoutActionTops = await Promise.all((await page.locator(".layout-heading-actions select, .layout-heading-actions button").all()).map(async (control) => (await control.boundingBox())?.y ?? Number.NaN));
  if (new Set(layoutActionTops.map((value) => Math.round(value))).size > 1) throw new Error(`Wide layout actions are not aligned: ${layoutActionTops.join(", ")}.`);
  const platePanelHeight = (await page.locator(".plate-panel").boundingBox())?.height ?? Number.NaN;
  const annotationPanelHeight = (await page.locator(".annotation-panel").boundingBox())?.height ?? Number.NaN;
  if (Math.abs(platePanelHeight - annotationPanelHeight) > 1) throw new Error(`Plate and annotation editors do not share one viewport height: ${platePanelHeight}/${annotationPanelHeight}.`);
  await page.getByText("更多实验信息", { exact: false }).click();
  await page.getByRole("button", { name: "放大孔板" }).click();
  await page.getByRole("button", { name: "放大孔板" }).click();
  await page.getByRole("button", { name: "放大孔板" }).click();
  const plateScroll = page.locator(".plate-scroll");
  const annotationScroll = page.locator(".annotation-panel-body");
  const annotationStart = await annotationScroll.evaluate((element) => element.scrollTop);
  const plateScrollResult = await plateScroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.scrollLeft = element.scrollWidth;
    return { top: element.scrollTop, left: element.scrollLeft };
  });
  if (plateScrollResult.top <= 0 && plateScrollResult.left <= 0) throw new Error("Plate viewport is not independently scrollable at 130% zoom.");
  if (await annotationScroll.evaluate((element) => element.scrollTop) !== annotationStart) throw new Error("Scrolling the plate unexpectedly moved the annotation viewport.");
  const platePositionBeforeAnnotation = await plateScroll.evaluate((element) => ({ top: element.scrollTop, left: element.scrollLeft }));
  const annotationEnd = await annotationScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; return element.scrollTop; });
  if (annotationEnd <= 0) throw new Error("Batch annotation body is not independently scrollable.");
  const platePositionAfterAnnotation = await plateScroll.evaluate((element) => ({ top: element.scrollTop, left: element.scrollLeft }));
  if (JSON.stringify(platePositionAfterAnnotation) !== JSON.stringify(platePositionBeforeAnnotation)) throw new Error("Scrolling annotations unexpectedly moved the plate viewport.");
  const annotationPanelBounds = await page.locator(".annotation-panel").boundingBox();
  const annotationFooterBounds = await page.locator(".annotation-panel-footer").boundingBox();
  if (!annotationPanelBounds || !annotationFooterBounds || annotationFooterBounds.y + annotationFooterBounds.height > annotationPanelBounds.y + annotationPanelBounds.height + 1) throw new Error("Annotation footer is not fixed inside its independent viewport.");
  await page.getByRole("button", { name: "重置为百分之百" }).click();

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
  if (!manualAnalysisText.includes("正式结果统一导出为 Excel，内含生物学汇总、技术复孔汇总、孔级数据和板布局")) throw new Error("Analysis UI did not explain the consolidated result workbook.");
  for (const redundantExport of ["孔级 CSV", "技术复孔 CSV", "汇总 CSV"]) {
    if (await page.getByRole("button", { name: redundantExport, exact: true }).count()) throw new Error(`Redundant ${redundantExport} action is still visible.`);
  }
  if (await page.getByRole("button", { name: "导出结果 Excel", exact: true }).count() !== 1) throw new Error("The analysis UI does not expose exactly one formal result-workbook action.");
  await verifyAnalysisPreviousStep(page);
  const qcFindingRows = await page.locator(".qc-mini-list li").all();
  const qcFindingHeights = await Promise.all(qcFindingRows.map(async (row) => (await row.boundingBox())?.height ?? Number.NaN));
  if (qcFindingHeights.some((height) => height > 84)) throw new Error(`QC findings are no longer compact: ${qcFindingHeights.join(", ")}.`);
  const qcListBounds = await page.locator(".qc-mini-list").boundingBox();
  if (!qcListBounds || qcListBounds.height > 300) throw new Error(`QC review list exceeded its compact height: ${qcListBounds?.height ?? "missing"}px.`);
  const wideActionButtons = await page.locator(".summary-head-actions button").all();
  const wideActionTops = await Promise.all(wideActionButtons.map(async (button) => (await button.boundingBox())?.y ?? Number.NaN));
  if (new Set(wideActionTops.map((value) => Math.round(value))).size > 1) throw new Error(`Wide summary actions are not aligned: ${wideActionTops.join(", ")}.`);
  const selectionHeaderAlign = await page.locator(".summary-table-scroll th").first().evaluate((element) => getComputedStyle(element).textAlign);
  const numericHeaderAlign = await page.locator(".summary-table-scroll th").nth(5).evaluate((element) => getComputedStyle(element).textAlign);
  if (selectionHeaderAlign !== "center") throw new Error(`Summary selection column is not centered: ${selectionHeaderAlign}.`);
  if (numericHeaderAlign !== "right") throw new Error(`Summary numeric columns are not right-aligned: ${numericHeaderAlign}.`);
  const chartSurface = await page.locator(".compact-chart-panel").evaluate((element) => {
    const panel = getComputedStyle(element);
    const heading = getComputedStyle(element.querySelector("h3"));
    return { background: panel.backgroundColor, heading: heading.color, shadow: panel.boxShadow };
  });
  if (chartSurface.background !== "rgb(12, 43, 46)") throw new Error(`Summary chart did not receive the premium dark stage: ${chartSurface.background}.`);
  if (chartSurface.heading !== "rgb(242, 238, 231)") throw new Error(`Summary chart heading contrast drifted: ${chartSurface.heading}.`);
  if (chartSurface.shadow === "none") throw new Error("Summary chart lost its authored elevation.");
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-analysis-aligned-wide.png"), fullPage: true });
  await page.setViewportSize({ width: 1100, height: 1000 });
  const intermediateActionTops = await Promise.all((await page.locator(".summary-head-actions button").all()).map(async (button) => (await button.boundingBox())?.y ?? Number.NaN));
  if (new Set(intermediateActionTops.map((value) => Math.round(value))).size > 1) throw new Error(`Intermediate summary actions split into orphan rows: ${intermediateActionTops.join(", ")}.`);
  const intermediateOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (intermediateOverflow > 1) throw new Error(`Intermediate analysis has ${intermediateOverflow}px of page-level horizontal overflow.`);
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-analysis-aligned-intermediate.png"), fullPage: true });
  await page.setViewportSize({ width: 760, height: 1000 });
  const compactAnalysisBounds = await page.locator(".analysis-layout-compact").boundingBox();
  const compactSettingsBounds = await page.locator(".analysis-side-panel").boundingBox();
  const compactSummaryBounds = await page.locator(".summary-panel").boundingBox();
  const compactChartBounds = await page.locator(".compact-chart-panel").boundingBox();
  const compactSignificanceBounds = await page.locator(".significance-panel").boundingBox();
  if (!compactAnalysisBounds || !compactSettingsBounds || !compactSummaryBounds || !compactChartBounds || !compactSignificanceBounds) throw new Error("Compact analysis layout is missing a required panel.");
  if (compactSummaryBounds.y < compactSettingsBounds.y + compactSettingsBounds.height) throw new Error("Compact summary did not stack below analysis settings.");
  if (compactChartBounds.y < compactSummaryBounds.y + compactSummaryBounds.height) throw new Error("Compact chart did not move below the summary table.");
  const chartCenterOffset = Math.abs((compactChartBounds.x + compactChartBounds.width / 2) - (compactAnalysisBounds.x + compactAnalysisBounds.width / 2));
  if (chartCenterOffset > 2) throw new Error(`Compact chart is not centered: ${chartCenterOffset}px offset.`);
  if (compactSignificanceBounds.y < compactChartBounds.y + compactChartBounds.height) throw new Error("Compact significance panel did not follow the centered chart.");
  const compactAnalysisOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (compactAnalysisOverflow > 1) throw new Error(`Compact analysis has ${compactAnalysisOverflow}px of page-level horizontal overflow.`);
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-analysis-compact-centered.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator(".workspace-nav").getByRole("button", { name: /数据导入/ }).click();
  const projectDownloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存可复现项目" }).click();
  const projectDownload = await projectDownloadEvent;
  const projectPath = await projectDownload.path();
  if (!projectPath || !projectDownload.suggestedFilename().includes("reproducible-project.json")) throw new Error("Reproducible project export was not produced.");
  await page.locator('input[type="file"][accept=".json"]').setInputFiles(projectPath);
  await page.getByRole("heading", { name: "确认导入" }).waitFor();
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
  let multiFileAppendValidated = false;
  if (process.env.CCK8_XLS) {
    const copiedCck8Path = resolve(screenshotDir, "cck8-day-1-copy.xlsx");
    const copiedCck8Path2 = resolve(screenshotDir, "cck8-day-2-copy.xlsx");
    await writeFile(copiedCck8Path, await readFile(process.env.CCK8_XLS));
    await writeFile(copiedCck8Path2, await readFile(process.env.CCK8_XLS));
    await page.locator('input[type="file"][accept=".xml,.xlsx,.xls,.skax"]').setInputFiles([process.env.CCK8_XLS, copiedCck8Path]);
    await page.getByRole("heading", { name: "确认导入" }).waitFor();
    const fixturePreview = await page.locator(".import-preview").innerText();
    if (!fixturePreview.includes("系统识别") || !fixturePreview.includes("细胞活性 / 细胞增殖")) throw new Error("Instrument import did not pass through assay review preview.");
    if (!fixturePreview.includes("识别到 2 块独立孔板") || !fixturePreview.includes("将追加到当前项目")) throw new Error("Multiple instrument files were not combined into an appendable plate batch.");
    await page.getByText("替换当前项目", { exact: true }).click();
    await page.getByRole("button", { name: "确认载入 2 块板" }).click();
    const importedText = await page.locator("body").innerText();
    requiredImportSignals = ["当前项目包含 2 块板", "本次实验基本信息", "CCK-8 / WST-8", "吸光", "450 nm", "96 个已测孔"];
    assertSignals(importedText, requiredImportSignals, "Instrument import");
    const reviewButton = page.getByRole("button", { name: "核对实验方法" });
    if (!await reviewButton.isVisible()) throw new Error("Inferred assay method does not expose a review action.");
    await reviewButton.click();
    const methodReview = page.getByLabel("实验方法复核");
    await methodReview.getByLabel("确认方法").fill("CCK-8 / WST-8 · 人工确认");
    await methodReview.getByRole("button", { name: "确认方法" }).click();
    if (!await page.getByRole("button", { name: "已复核 · 修改" }).isVisible()) throw new Error("Assay method review did not reach a confirmed state.");
    const reviewedOverview = await page.locator(".experiment-overview").innerText();
    for (const signal of ["CCK-8 / WST-8 · 人工确认", "原始识别：CCK-8 / WST-8"]) {
      if (!reviewedOverview.includes(signal)) throw new Error(`Reviewed assay provenance is missing: ${signal}`);
    }
    await page.locator('input[type="file"][accept=".xml,.xlsx,.xls,.skax"]').setInputFiles([copiedCck8Path, copiedCck8Path2]);
    await page.getByRole("heading", { name: "确认导入" }).waitFor();
    const appendPreview = await page.locator(".import-preview").innerText();
    if (!appendPreview.includes("将追加到当前项目") || !appendPreview.includes("保留现有板、注释与分析设置")) throw new Error("Existing project did not default to append mode.");
    await page.getByRole("button", { name: "确认追加 2 块板" }).click();
    if (!(await page.locator("body").innerText()).includes("当前项目包含 4 块板")) throw new Error("Appended instrument plates were not added to the current project.");
    const importPlateTabFontSize = Number.parseFloat(await page.locator(".plate-switcher-buttons button").first().evaluate((element) => getComputedStyle(element).fontSize));
    if (importPlateTabFontSize > 11.5) throw new Error(`Import plate-tab label is still too large: ${importPlateTabFontSize}px.`);
    multiFileAppendValidated = true;
    await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-multifile-append.png"), fullPage: true });
    await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-imported.png"), fullPage: true });
    await page.getByRole("button", { name: "进入板图与注释" }).click();
    const layoutPlateTabs = page.locator(".layout-plate-context .plate-context-tabs button");
    if (await layoutPlateTabs.count() !== 4) throw new Error(`Layout page did not expose four plate tabs: ${await layoutPlateTabs.count()}.`);
    const layoutContextText = await page.locator(".layout-plate-context").innerText();
    for (const signal of ["当前板 3 / 4", "Plate 1", "cck8-day-1-copy"]) {
      if (!layoutContextText.includes(signal)) throw new Error(`Layout plate identity is missing: ${signal}`);
    }
    await page.locator('[data-well="A1"]').click();
    await page.getByLabel("分组 · Group").fill("Unapplied plate-switch draft");
    let switchPromptSeen = false;
    page.once("dialog", async (dialog) => { switchPromptSeen = dialog.message().includes("尚未应用"); await dialog.dismiss(); });
    await layoutPlateTabs.first().click();
    if (!switchPromptSeen || await layoutPlateTabs.nth(2).getAttribute("aria-current") !== "page") throw new Error("Plate switching did not protect the unapplied annotation draft.");
    await page.getByRole("button", { name: "清空填写" }).click();
    await layoutPlateTabs.first().click();
    if (await layoutPlateTabs.first().getAttribute("aria-current") !== "page") throw new Error("Layout plate tab did not switch the active plate.");
    if (!(await page.locator(".layout-plate-context .active-plate-identity").innerText()).includes("当前板 1 / 4")) throw new Error("Active plate identity did not update after tab switching.");
    await verifyLayoutPreviousStep(page);
    const layoutText = await page.locator("body").innerText();
    requiredLayoutSignals = ["96孔板 · 96个已测孔", "样本 72", "质控 12", "空白 12", "板图尚未完成"];
    assertSignals(layoutText, requiredLayoutSignals, "Instrument layout");
    await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-layout.png"), fullPage: true });
    await page.getByRole("button", { name: /分析与导出/ }).click();
    await page.getByRole("heading", { name: "分析与导出" }).waitFor();
    const analysisPlateTabs = page.locator(".analysis-plate-context .plate-context-tabs button");
    if (await analysisPlateTabs.count() !== 4) throw new Error(`Analysis page did not expose four plate tabs: ${await analysisPlateTabs.count()}.`);
    if (!(await page.locator(".analysis-plate-context .active-plate-identity").innerText()).includes("当前分析板 1 / 4")) throw new Error("Analysis page did not identify the active plate.");
    await analysisPlateTabs.last().click();
    if (await analysisPlateTabs.last().getAttribute("aria-current") !== "page") throw new Error("Analysis plate tab did not switch the active plate.");
    const switchedAnalysisIdentity = await page.locator(".analysis-plate-context .active-plate-identity").innerText();
    if (!switchedAnalysisIdentity.includes("当前分析板 4 / 4") || !switchedAnalysisIdentity.includes("cck8-day-2-copy")) throw new Error(`Analysis plate identity did not follow plate switching: ${switchedAnalysisIdentity}`);
    await analysisPlateTabs.first().click();
    const analysisText = await page.locator("body").innerText();
    incompleteLayoutGateVisible = analysisText.includes("LAYOUT_INCOMPLETE");
    if (!incompleteLayoutGateVisible) throw new Error("Analysis view did not preserve the incomplete-layout QC gate.");
    await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-analysis.png"), fullPage: true });
  }

  let genericLuxSignals = [];
  if (process.env.DUAL_LUC_XLS) {
    await page.locator(".workspace-nav").getByRole("button", { name: /数据导入/ }).click();
    await page.locator('input[type="file"][accept=".xml,.xlsx,.xls,.skax"]').setInputFiles(process.env.DUAL_LUC_XLS);
    await page.getByRole("heading", { name: "确认导入" }).waitFor();
    const dualPreview = await page.locator(".import-preview").innerText();
    if (!dualPreview.includes("单 / 双荧光素酶")) throw new Error("Dual-Luciferase was not routed through the Luciferase module preview.");
    await page.getByText("替换当前项目", { exact: true }).click();
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

  await page.locator(".workspace-nav").getByRole("button", { name: /数据导入/ }).click();
  await page.locator('input[type="file"][accept=".json"]').setInputFiles(normalizationProjectPath);
  await page.getByRole("heading", { name: "确认导入" }).waitFor();
  await page.getByRole("button", { name: "确认载入 2 块板" }).click();
  await page.getByRole("button", { name: "进入板图与注释" }).click();
  await page.getByRole("button", { name: "进入分析" }).click();
  const normalizationDisclosure = page.locator(".baseline-normalization-controls");
  await normalizationDisclosure.locator("summary").click();
  await page.getByLabel("Baseline timepoint").selectOption("Day 0");
  await page.getByLabel("启用派生标准化").check();
  await page.getByText("Calculated in Studio · baseline normalization", { exact: true }).waitFor();
  const normalizationStatusText = await normalizationDisclosure.innerText();
  if (!normalizationStatusText.toLowerCase().includes("ready")) throw new Error(`Baseline normalization did not reach ready state in the browser.\n${normalizationStatusText}`);
  const workbookDownloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出结果 Excel" }).click();
  const workbookDownload = await workbookDownloadEvent;
  const workbookPath = await workbookDownload.path();
  if (!workbookPath || !workbookDownload.suggestedFilename().endsWith("-results-all.xlsx")) throw new Error("Consolidated result workbook was not downloaded.");
  const workbook = XLSX.read(await readFile(workbookPath), { type: "buffer" });
  const expectedWorkbookSheets = ["导出说明", "生物学汇总", "技术复孔汇总", "孔级数据", "板布局"];
  if (JSON.stringify(workbook.SheetNames) !== JSON.stringify(expectedWorkbookSheets)) throw new Error(`Unexpected result workbook sheets: ${workbook.SheetNames.join(", ")}`);
  const workbookSummaryRows = XLSX.utils.sheet_to_json(workbook.Sheets["生物学汇总"]);
  const workbookTechnicalRows = XLSX.utils.sheet_to_json(workbook.Sheets["技术复孔汇总"]);
  const workbookWellRows = XLSX.utils.sheet_to_json(workbook.Sheets["孔级数据"]);
  if (!workbookSummaryRows.length || !workbookTechnicalRows.length || !workbookWellRows.length) throw new Error("Result workbook sheets are empty.");
  if (!("blank_corrected_biological_mean" in workbookSummaryRows[0])) throw new Error("Biological mean is not explicitly named in the result workbook.");
  if (!("blank_corrected_technical_mean" in workbookTechnicalRows[0])) throw new Error("Technical-replicate mean is missing from the result workbook.");
  const renderedBar = page.locator(".compact-chart-panel .chart-bar").first();
  if (!await renderedBar.count()) throw new Error("Summary chart did not render a data bar for visual verification.");
  const renderedBarFill = await renderedBar.getAttribute("fill");
  if (!renderedBarFill?.startsWith("url(#summary-bar-")) throw new Error(`Summary chart bar is missing its jade material treatment: ${renderedBarFill}.`);
  const normalizedDownloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "标准化结果" }).click();
  const normalizedDownload = await normalizedDownloadEvent;
  if (!normalizedDownload.suggestedFilename().includes("normalized-results.csv")) throw new Error("Normalized-results CSV was not exported.");
  await page.screenshot({ path: resolve(screenshotDir, "microplate-studio-baseline-normalization.png"), fullPage: true });

  const normalizationProjectDownloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存可复现项目" }).click();
  const normalizationProjectDownload = await normalizationProjectDownloadEvent;
  const normalizationRoundTripPath = await normalizationProjectDownload.path();
  if (!normalizationRoundTripPath) throw new Error("Normalized project round-trip download path is missing.");
  await page.locator(".workspace-nav").getByRole("button", { name: /数据导入/ }).click();
  await page.locator('input[type="file"][accept=".json"]').setInputFiles(normalizationRoundTripPath);
  await page.getByRole("heading", { name: "确认导入" }).waitFor();
  await page.getByRole("button", { name: "确认载入 2 块板" }).click();
  await page.getByRole("button", { name: "进入板图与注释" }).click();
  await page.getByRole("button", { name: "进入分析" }).click();
  await page.locator(".baseline-normalization-controls summary").click();
  if (!await page.getByLabel("启用派生标准化").isChecked()) throw new Error("Project round-trip did not restore enabled baseline normalization.");
  if (await page.getByLabel("Baseline timepoint").inputValue() !== "Day 0") throw new Error("Project round-trip did not restore the exact baseline timepoint.");

  const result = {
    title: await page.title(),
    importSignals: requiredImportSignals,
    layoutSignals: requiredLayoutSignals,
    incompleteLayoutGateVisible,
    manualUnassignedGateVisible: manualAnalysisText.includes("ROLE_UNASSIGNED"),
    baselineNormalizationRoundTrip: true,
    consolidatedWorkbookValidated: true,
    multiFileAppendValidated,
    genericLuxSignals,
    optionalVendorScenarios: { cck8: Boolean(process.env.CCK8_XLS), dualLuciferase: Boolean(process.env.DUAL_LUC_XLS), victor: Boolean(process.env.VICTOR_XLS) },
    consoleErrors,
  };
  console.log(JSON.stringify(result, null, 2));
  if (consoleErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
}

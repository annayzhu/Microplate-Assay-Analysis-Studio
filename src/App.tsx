import { useEffect, useMemo, useRef, useState } from "react";
import { downloadArtifact, downloadBlob, downloadTextFile } from "./adapters/browser-download";
import { createArtifact, toolIdentity } from "./core/artifacts";
import { assayModules, detectedAssayModule, getAssayWorkflow } from "./core/assay-workflows";
import { defaultBaselineNormalizationConfig } from "./core/baseline-normalization";
import { importInstrumentFiles, importPlateReadings } from "./core/import";
import { createReadingTemplateWorkbook, type ManualReadingMetadata } from "./core/instruments/manual-readings";
import { currentPlateLayoutCsv, layoutTemplateCsv, plateTemplateDefinitions, previewLayoutText, type LayoutPatch } from "./core/layout";
import { createResultWorkbook } from "./core/result-workbook";
import {
  defaultAnalysisConfig,
  appendPlateWorkspace,
  openPlateWorkspace,
  planWorkspaceImport,
  readPlateWorkspace,
  transitionPlateWorkspace,
  workspacePlates,
  type PlateWorkspace as PlateWorkspaceState,
} from "./core/plate-workspace";
import type { AssayModuleId, BaselineNormalizationConfig, BiologicalSummary, DetectionMode, ParsedPlate, PlateImportBatch, WellRole } from "./core/types";
import { PlateMap } from "./components/PlateMap";
import { SummaryChart } from "./components/SummaryChart";
import { AssayDataExplorer } from "./components/AssayDataExplorer";
import { AssayWorkflowPanel, assayStatusLabel } from "./components/AssayWorkflowPanel";

type View = "import" | "layout" | "analysis";
type ImportMode = "instrument" | "paste" | "template";
type ImportTarget = "append" | "replace";
type DraftStatus = "idle" | "dirty" | "applied";
type PlatePresentation = {
  zoom: number;
  zoomManuallyChanged: boolean;
};
type BatchDraft = {
  role: "" | WellRole;
  sampleId: string;
  group: string;
  treatment: string;
  concentration: string;
  timepoint: string;
  biologicalReplicate: string;
  technicalReplicate: string;
  excluded: "true" | "false";
  notes: string;
};

const wellRoles: WellRole[] = ["unassigned", "sample", "control", "qc", "blank", "standard"];
const defaultLayoutTemplateId = "96";

const layoutFieldLabels: Record<keyof LayoutPatch, string> = {
  role: "孔角色",
  sampleId: "样本 ID",
  group: "分组",
  treatment: "处理",
  concentration: "浓度",
  timepoint: "时间点",
  biologicalReplicate: "生物学重复",
  technicalReplicate: "技术重复",
  excluded: "排除状态",
  notes: "备注",
};

const emptyBatchDraft: BatchDraft = {
  role: "",
  sampleId: "",
  group: "",
  treatment: "",
  concentration: "",
  timepoint: "",
  biologicalReplicate: "",
  technicalReplicate: "",
  excluded: "false",
  notes: "",
};

function format(value: number | null, digits = 3): string {
  return value === null || !Number.isFinite(value) ? "未记录" : value.toFixed(digits);
}

function detectionModeLabel(mode: DetectionMode): string {
  return ({ absorbance: "吸光", fluorescence: "荧光", luminescence: "发光", trf: "时间分辨荧光", alpha: "Alpha" })[mode];
}

function methodEvidenceLabel(plate: ParsedPlate): string {
  if (plate.metadata.assayMethodReviewDecision === "user-confirmed") {
    return `人工复核确认 · 原始识别：${plate.metadata.assayMethodLabel || "未提供"}`;
  }
  return ({ reported: "仪器协议明确记录", "user-reported": "由用户在导入时填写", inferred: "根据通道与当前流程推断，请复核", unknown: "文件未提供" })[plate.metadata.assayMethodEvidence];
}

function displayedAssayMethodLabel(plate: ParsedPlate): string {
  return plate.metadata.confirmedAssayMethodLabel ?? plate.metadata.assayMethodLabel;
}

function measurementChannel(plate: ParsedPlate): string {
  const metadata = plate.metadata;
  if (metadata.detectionMode === "fluorescence") {
    const excitation = metadata.excitationWavelengthNm ? `Ex ${metadata.excitationWavelengthNm} nm` : "Ex 未记录";
    const emission = metadata.emissionWavelengthNm ? `Em ${metadata.emissionWavelengthNm} nm` : "Em 未记录";
    return `${excitation} / ${emission}`;
  }
  if (metadata.wavelengthNm) {
    return metadata.referenceWavelengthNm
      ? `${metadata.wavelengthNm} nm / ref ${metadata.referenceWavelengthNm} nm`
      : `${metadata.wavelengthNm} nm`;
  }
  return metadata.measurementName || "未记录";
}

function instrumentDisplay(plate: ParsedPlate): string {
  return [plate.metadata.instrumentManufacturer, plate.metadata.instrumentModel].filter(Boolean).join(" · ") || "未记录";
}

function readSettingDisplay(plate: ParsedPlate): string {
  const metadata = plate.metadata;
  const items = [
    metadata.readDirection ? (metadata.readDirection.toLowerCase() === "above" ? "顶部读板" : metadata.readDirection) : "",
    metadata.measurementTimeSeconds !== null ? `${metadata.measurementTimeSeconds} s/孔` : "",
    metadata.temperatureStartC !== null && metadata.temperatureEndC !== null
      ? `${metadata.temperatureStartC}→${metadata.temperatureEndC} °C`
      : "",
  ].filter(Boolean);
  return items.join(" · ") || "未记录";
}

function formatRawSignal(plate: ParsedPlate, value: number): string {
  return plate.metadata.signalUnit.toLowerCase() === "od"
    ? value.toFixed(4)
    : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function rawSignalLabel(plate: ParsedPlate): string {
  return plate.metadata.signalUnit ? `原始读数 (${plate.metadata.signalUnit})` : "原始读数";
}

const summaryTableColumns: Array<{ key: string; header: string; render: (row: BiologicalSummary) => string | number }> = [
  { key: "group", header: "Group", render: (row) => row.group },
  { key: "treatment", header: "Treatment", render: (row) => row.treatment || "未记录" },
  { key: "concentration", header: "Conc.", render: (row) => row.concentration || "未记录" },
  { key: "timepoint", header: "Time", render: (row) => row.timepoint || "未记录" },
  { key: "nBiological", header: "n bio", render: (row) => row.nBiological },
  { key: "correctedMean", header: "Mean", render: (row) => format(row.correctedMean) },
  { key: "correctedSd", header: "SD", render: (row) => format(row.correctedSd) },
  { key: "correctedSem", header: "SEM", render: (row) => format(row.correctedSem) },
  { key: "relativeActivityPercent", header: "Rel. %", render: (row) => format(row.relativeActivityPercent, 1) },
  { key: "relativeSdPercent", header: "Rel. SD", render: (row) => format(row.relativeSdPercent, 1) },
];

function roleLabel(role: WellRole): string {
  return ({ unassigned: "未指定", sample: "样本", control: "对照", qc: "质控", blank: "空白", standard: "标准品" })[role];
}

function significanceMethodLabel(note: string): string {
  if (note.startsWith("Paired")) return "配对 t-test";
  if (note.startsWith("Welch")) return "Welch t-test";
  return "n/a";
}

function AnnotationPanelToggleIcon({ collapsed }: { collapsed: boolean }) {
  return <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d={collapsed ? "M12.5 4.5 7 10l5.5 5.5" : "M7.5 4.5 13 10l-5.5 5.5"} />
  </svg>;
}

function PreviousStepButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="previous-step-button" onClick={onClick}>
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="m11.75 4.75-5.25 5.25 5.25 5.25" /></svg>
    <span>{label}</span>
  </button>;
}

function templateIdForPlate(plate: ParsedPlate): string {
  return plateTemplateDefinitions.find((template) => template.rows === plate.rows && template.columns === plate.columns)?.id ?? defaultLayoutTemplateId;
}

function plateSwitcherLabel(plate: ParsedPlate, index: number, projectPlates: ParsedPlate[]): string {
  const duplicateName = projectPlates.filter((candidate) => candidate.metadata.plateName === plate.metadata.plateName).length > 1;
  const sourceStem = plate.metadata.sourceFileName.replace(/\.[^.]+$/, "");
  return `${index + 1}. ${plate.metadata.plateName}${duplicateName && sourceStem !== plate.metadata.plateName ? ` · ${sourceStem}` : ""}`;
}

function sourceStem(plate: ParsedPlate): string {
  return plate.metadata.sourceFileName.replace(/\.[^.]+$/, "");
}

function PlateContextTabs({ plates, activePlateIndex, onSelect, context }: {
  plates: ParsedPlate[];
  activePlateIndex: number;
  onSelect: (index: number) => void;
  context: "layout" | "analysis";
}) {
  const active = plates[activePlateIndex];
  if (!active) return null;
  const contextLabel = context === "analysis" ? "当前分析板" : "当前板";
  return <section className={`plate-context-switcher ${context}-plate-context`} aria-label={`${contextLabel}与项目孔板`}>
    <div className="active-plate-identity">
      <span>{contextLabel} {activePlateIndex + 1} / {plates.length}</span>
      <strong>{active.metadata.plateName}</strong>
      <small title={active.metadata.sourceFileName}>{active.metadata.sourceFileName}</small>
    </div>
    {plates.length > 1 ? <nav className="plate-context-tabs" aria-label={context === "analysis" ? "切换分析孔板" : "切换项目孔板"}>
      {plates.map((item, index) => {
        const label = plateSwitcherLabel(item, index, plates);
        return <button
          type="button"
          key={item.plateId ?? `${item.metadata.plateName}-${index}`}
          className={index === activePlateIndex ? "active" : ""}
          aria-current={index === activePlateIndex ? "page" : undefined}
          aria-label={`切换到 ${label}`}
          title={`${label} · ${item.metadata.sourceFileName}`}
          onClick={() => onSelect(index)}
        >
          <strong>{index + 1}. {item.metadata.plateName}</strong>
          <small>{sourceStem(item)}</small>
        </button>;
      })}
    </nav> : null}
  </section>;
}

export default function App() {
  const instrumentInput = useRef<HTMLInputElement>(null);
  const readingTemplateInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const layoutInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>("import");
  const [importMode, setImportMode] = useState<ImportMode>("instrument");
  const [selectedModuleId, setSelectedModuleId] = useState<AssayModuleId>("cell-viability");
  const [moduleSelectionTouched, setModuleSelectionTouched] = useState(false);
  const [workspace, setWorkspace] = useState<PlateWorkspaceState | null>(null);
  const [platePresentations, setPlatePresentations] = useState<PlatePresentation[]>([]);
  const [pendingBatch, setPendingBatch] = useState<PlateImportBatch | null>(null);
  const [pendingModuleIds, setPendingModuleIds] = useState<AssayModuleId[]>([]);
  const [pendingIncludedPlates, setPendingIncludedPlates] = useState<Set<number>>(new Set());
  const [pendingConflictConfirmed, setPendingConflictConfirmed] = useState(false);
  const [pendingImportTarget, setPendingImportTarget] = useState<ImportTarget>("replace");
  const [manualText, setManualText] = useState("");
  const [manualDetectionMode, setManualDetectionMode] = useState<DetectionMode>("absorbance");
  const [manualSignalUnit, setManualSignalUnit] = useState("OD");
  const [manualWavelength, setManualWavelength] = useState("450");
  const [manualExcitation, setManualExcitation] = useState("");
  const [manualEmission, setManualEmission] = useState("");
  const [readingTemplateId, setReadingTemplateId] = useState(defaultLayoutTemplateId);
  const [readingTemplatePlateCount, setReadingTemplatePlateCount] = useState(1);
  const [layoutTemplateId, setLayoutTemplateId] = useState(defaultLayoutTemplateId);
  const [pendingLayoutFile, setPendingLayoutFile] = useState<{ name: string; text: string } | null>(null);
  const [layoutBiologicalMode, setLayoutBiologicalMode] = useState<"preserve" | "clear">("preserve");
  const [layoutMismatchConfirmed, setLayoutMismatchConfirmed] = useState(false);
  const [annotationPanelCollapsed, setAnnotationPanelCollapsed] = useState(false);
  const [batchDraft, setBatchDraft] = useState<BatchDraft>(emptyBatchDraft);
  const [draftStatus, setDraftStatus] = useState<DraftStatus>("idle");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [autoNumberTechnical, setAutoNumberTechnical] = useState(true);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [methodReviewOpen, setMethodReviewOpen] = useState(false);
  const [methodReviewDraft, setMethodReviewDraft] = useState("");
  const selectedModule = assayModules.find((module) => module.id === selectedModuleId) ?? assayModules[0];
  const workspaceView = useMemo(() => workspace ? readPlateWorkspace(workspace) : null, [workspace]);
  const plates = useMemo(() => workspace ? workspacePlates(workspace) : [], [workspace]);
  const activePlateIndex = workspace?.activePlateIndex ?? 0;
  const plate = workspaceView?.activePlate ?? null;
  const wells = workspaceView?.wells ?? [];
  const selected = workspace?.selectedWellIds ?? new Set<string>();
  const selectionAnchor = workspace?.selectionAnchor ?? null;
  const selectedSummaryKeys = workspace?.selectedSummaryKeys ?? new Set<string>();
  const config = workspace?.analysisConfig ?? defaultAnalysisConfig;
  const controlGroupTouched = workspace?.controlGroupTouched ?? false;
  const experiment = workspace?.experiment ?? { name: "", operator: "", date: "", notes: "" };
  const platePresentation = platePresentations[activePlateIndex] ?? { zoom: 1, zoomManuallyChanged: false };
  const plateZoom = platePresentation.zoom;
  const activeModuleId = workspaceView?.activeModuleId ?? selectedModuleId;
  const activeModule = workspaceView?.activeModule ?? getAssayWorkflow(activeModuleId);
  const assayMethodNeedsReview = Boolean(plate
    && plate.metadata.assayMethodReviewDecision !== "user-confirmed"
    && (plate.metadata.assayMethodEvidence === "inferred" || plate.metadata.assayMethodEvidence === "unknown"));
  const groups = workspaceView?.groups ?? [];
  const inferredControlGroup = workspaceView?.inferredControlGroup ?? "";
  const analysis = workspaceView?.analysis ?? { ready: false, blankMean: null, blankSd: null, blankCvPercent: null, annotatedWells: [], technicalSummaries: [], biologicalSummaries: [], significanceComparisons: [], findings: [] };
  const baselineNormalization = workspaceView?.baselineNormalization ?? { status: "disabled" as const, config: defaultBaselineNormalizationConfig, normalizationReadyRows: [], normalizedRows: [], findings: [] };
  const normalizationConfig = config.baselineNormalization ?? defaultBaselineNormalizationConfig;
  const normalizationTimepoints = [...new Set(baselineNormalization.normalizationReadyRows.map((row) => row.timepoint).filter(Boolean))];
  const normalizationGroups = [...new Set(baselineNormalization.normalizationReadyRows.map((row) => row.group).filter(Boolean))];
  const displayedBaselineNormalization = selectedSummaryKeys.size ? {
    ...baselineNormalization,
    normalizationReadyRows: baselineNormalization.normalizationReadyRows.filter((row) => selectedSummaryKeys.has([row.group, row.treatment, row.concentration, row.timepoint].join("¦"))),
    normalizedRows: baselineNormalization.normalizedRows.filter((row) => selectedSummaryKeys.has(row.key)),
  } : baselineNormalization;
  const normalizedChartRows = displayedBaselineNormalization.status === "ready" ? displayedBaselineNormalization.normalizedRows.map((row) => ({
    key: row.key,
    group: row.group,
    treatment: row.treatment,
    concentration: row.concentration,
    timepoint: row.timepoint,
    nBiological: row.n,
    correctedMean: row.normalizedMean,
    correctedSd: row.normalizedSd,
    correctedSem: normalizationConfig.uncertaintyDisplay === "ci95" && row.ci95Low !== null && row.ci95High !== null
      ? (row.ci95High - row.ci95Low) / 2
      : row.normalizedSem ?? row.propagatedSe,
    relativeActivityPercent: null,
    relativeSdPercent: null,
    relativeSemPercent: null,
  })) : [];
  const useGenericWorkflow = workspaceView?.useGenericWorkflow ?? false;
  const workflowReady = workspaceView?.workflowReady ?? false;
  const roleCounts = useMemo(() => Object.fromEntries(wellRoles.map((role) => [role, wells.filter((well) => well.role === role).length])) as Record<WellRole, number>, [wells]);
  const selectedWells = workspaceView?.selectedWells ?? [];
  const selectedExcludedCount = useMemo(() => selectedWells.filter((well) => well.excluded).length, [selectedWells]);
  const selectedExclusionState = selectedWells.length && selectedExcludedCount === selectedWells.length ? "excluded" : selectedExcludedCount === 0 ? "included" : "mixed";
  const selectedRoleCounts = useMemo(() => Object.fromEntries(wellRoles.map((role) => [role, selectedWells.filter((well) => well.role === role).length])) as Record<WellRole, number>, [selectedWells]);
  const selectedSingleWell = selectedWells.length === 1 ? selectedWells[0] : null;
  const blankAnnotationMode = selectedWells.length > 0 && selectedWells.every((well) => well.role === "blank");
  const advancedFilledCount = [batchDraft.treatment, batchDraft.concentration, batchDraft.timepoint, batchDraft.technicalReplicate, batchDraft.notes].filter(Boolean).length;
  const selectedTemplate = plateTemplateDefinitions.find((template) => template.id === layoutTemplateId)
    ?? plateTemplateDefinitions.find((template) => template.id === defaultLayoutTemplateId)
    ?? plateTemplateDefinitions[0];
  const selectedReadingTemplate = plateTemplateDefinitions.find((template) => template.id === readingTemplateId)
    ?? plateTemplateDefinitions.find((template) => template.id === defaultLayoutTemplateId)
    ?? plateTemplateDefinitions[0];
  const manualMetadata: ManualReadingMetadata = {
    assayModuleId: selectedModuleId,
    assayMethodLabel: selectedModule.name,
    detectionMode: manualDetectionMode,
    signalUnit: manualSignalUnit.trim() || (manualDetectionMode === "absorbance" ? "OD" : "Signal"),
    wavelengthNm: manualWavelength.trim() && Number.isFinite(Number(manualWavelength)) ? Number(manualWavelength) : null,
    excitationWavelengthNm: manualExcitation.trim() && Number.isFinite(Number(manualExcitation)) ? Number(manualExcitation) : null,
    emissionWavelengthNm: manualEmission.trim() && Number.isFinite(Number(manualEmission)) ? Number(manualEmission) : null,
  };
  const pendingHasConflict = useMemo(() => pendingBatch?.plates.some((item, index) => {
    if (!pendingIncludedPlates.has(index) || pendingBatch.sourceKind !== "instrument-file") return false;
    const detected = detectedAssayModule(item);
    return detected !== "unknown" && pendingModuleIds[index] !== detected;
  }) ?? false, [pendingBatch, pendingIncludedPlates, pendingModuleIds]);
  const pendingCanAppend = Boolean(workspace && pendingBatch && pendingBatch.sourceKind !== "project-file");
  const displayedAnalysis = workspaceView?.displayedAnalysis ?? analysis;
  const displayedBiologicalSummaries = workspaceView?.displayedBiologicalSummaries ?? [];
  const displayedSignificanceComparisons = workspaceView?.displayedSignificanceComparisons ?? [];
  const displayedAnnotatedWells = displayedAnalysis.annotatedWells;
  const exportScope = workspaceView?.exportScope ?? "all";
  const layoutImportPreview = useMemo(() => plate && pendingLayoutFile
    ? previewLayoutText(wells, pendingLayoutFile.text, {
      biologicalReplicateMode: layoutBiologicalMode,
      targetRows: plate.rows,
      targetColumns: plate.columns,
    })
    : null, [layoutBiologicalMode, pendingLayoutFile, plate, wells]);

  useEffect(() => {
    if (draftStatus !== "dirty") return;
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [draftStatus]);

  function resetPlatePresentation(nextPlate: ParsedPlate) {
    setLayoutTemplateId(templateIdForPlate(nextPlate));
    setPendingLayoutFile(null);
    setLayoutMismatchConfirmed(false);
  }

  function clearBatchDraft() {
    setBatchDraft({ ...emptyBatchDraft });
    setAutoNumberTechnical(true);
    setDraftStatus("idle");
  }

  function confirmDiscardDraft(): boolean {
    return draftStatus !== "dirty" || window.confirm("右侧还有尚未应用的注释。继续操作将丢弃这些填写，是否继续？");
  }

  function navigateTo(nextView: View) {
    if (nextView === view) return;
    if (view === "layout" && !confirmDiscardDraft()) return;
    if (view === "layout") clearBatchDraft();
    setView(nextView);
  }

  function selectAssayModule(moduleId: AssayModuleId, moduleName: string) {
    if (view === "layout" && !confirmDiscardDraft()) return;
    if (view === "layout") clearBatchDraft();
    if (plate && activeModuleId !== moduleId) {
      const nextModule = getAssayWorkflow(moduleId);
      const confirmed = window.confirm(`将当前板从“${activeModule.name}”切换为“${nextModule.name}”。\n\n原始读数和通用孔位注释会保留；旧模块的派生结果将不再作为当前结果展示。是否继续？`);
      if (!confirmed) return;
      setWorkspace((current) => current ? transitionPlateWorkspace(current, { type: "assign-active-assay", moduleId }) : current);
      setMethodReviewOpen(false);
    }
    setSelectedModuleId(moduleId);
    setModuleSelectionTouched(true);
    setView("import");
    setNotice(plate ? `当前板已切换为“${moduleName}”；原始读数和通用注释保持不变。` : `已选择“${moduleName}”。三种读数入口保持一致，请按提示补充实验信息。`);
    setError("");
  }

  function changeBatchDraft(patch: Partial<BatchDraft>) {
    setBatchDraft((current) => ({ ...current, ...patch }));
    setDraftStatus("dirty");
  }

  function previewBatch(batch: PlateImportBatch) {
    const plan = planWorkspaceImport(batch, selectedModuleId, moduleSelectionTouched);
    setPendingBatch(batch);
    setPendingModuleIds([...plan.moduleIds]);
    setPendingIncludedPlates(new Set(plan.includedPlateIndexes));
    setPendingConflictConfirmed(false);
    setPendingImportTarget(workspace && batch.sourceKind !== "project-file" ? "append" : "replace");
    setNotice(`解析完成：识别到 ${batch.plates.length} 块板。请确认载入范围、实验类型和数据来源。`);
  }

  function loadBatch(batch: PlateImportBatch) {
    if (!pendingIncludedPlates.size) return;
    if (!confirmDiscardDraft()) return;
    clearBatchDraft();
    const plan = planWorkspaceImport(batch, selectedModuleId, moduleSelectionTouched);
    const options = {
      includedPlateIndexes: pendingIncludedPlates,
      moduleIds: pendingModuleIds,
      moduleSelectionTouched,
    };
    const append = pendingImportTarget === "append" && workspace && batch.sourceKind !== "project-file";
    const previousPlateCount = workspace?.plates.length ?? 0;
    const nextWorkspace = append ? appendPlateWorkspace(workspace, plan, options) : openPlateWorkspace(plan, options);
    const nextPlates = workspacePlates(nextWorkspace);
    setWorkspace(nextWorkspace);
    setMethodReviewOpen(false);
    setPlatePresentations((current) => append
      ? [...current, ...nextPlates.slice(previousPlateCount).map(() => ({ zoom: 1, zoomManuallyChanged: false }))]
      : nextPlates.map(() => ({ zoom: 1, zoomManuallyChanged: false })));
    setPendingBatch(null);
    setPendingIncludedPlates(new Set());
    setPendingModuleIds([]);
    setPendingConflictConfirmed(false);
    resetPlatePresentation(nextPlates[nextWorkspace.activePlateIndex]);
    setSelectedModuleId(nextWorkspace.selectedModuleId);
    setModuleSelectionTouched(false);
    setNotice(append
      ? `已追加 ${pendingIncludedPlates.size} 块板；当前项目共 ${nextPlates.length} 块板。各板原始读数与 blank 独立保留。`
      : `已载入 ${nextPlates.length} 块板，共 ${nextPlates.reduce((sum, item) => sum + item.wells.length, 0)} 个已测孔。原始读数保持只读。`);
    setView("import");
  }

  function updatePlateSelection(next: Set<string>, anchor: string | null) {
    setWorkspace((current) => current ? transitionPlateWorkspace(current, { type: "select-wells", wellIds: next, anchor }) : current);
  }

  function setPlateZoom(zoom: number, manual: boolean) {
    const nextZoom = Math.max(0.5, Math.min(1.3, Math.round(zoom * 10) / 10));
    setPlatePresentations((current) => current.map((presentation, index) => index === activePlateIndex
      ? { zoom: nextZoom, zoomManuallyChanged: manual || presentation.zoomManuallyChanged }
      : presentation));
  }

  function selectActivePlate(index: number) {
    const next = plates[index];
    if (!workspace || !next || index === activePlateIndex || !confirmDiscardDraft()) return;
    clearBatchDraft();
    const nextWorkspace = transitionPlateWorkspace(workspace, { type: "select-plate", index });
    setWorkspace(nextWorkspace);
    setMethodReviewOpen(false);
    resetPlatePresentation(next);
    setSelectedModuleId(nextWorkspace.selectedModuleId);
    setModuleSelectionTouched(false);
    setNotice(`已切换到 ${next.metadata.plateName}；该板的注释和分析状态独立保存。`);
  }

  function renameActivePlate(name: string) {
    setWorkspace((current) => current ? transitionPlateWorkspace(current, { type: "rename-active-plate", name }) : current);
  }

  function openMethodReview() {
    if (!plate) return;
    setMethodReviewDraft(displayedAssayMethodLabel(plate));
    setMethodReviewOpen(true);
  }

  function confirmMethodReview() {
    const label = methodReviewDraft.trim();
    if (!label) {
      setError("请先填写或选择实验方法，再完成复核。");
      return;
    }
    setWorkspace((current) => current ? transitionPlateWorkspace(current, { type: "review-active-assay-method", label }) : current);
    setMethodReviewOpen(false);
    setError("");
    setNotice(`实验方法已人工复核为“${label}”；仪器记录和系统原始识别保持不变。`);
  }

  async function importInstrumentFileSelection(files: File[]) {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      previewBatch(await importInstrumentFiles(files));
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "文件导入失败。");
    } finally {
      setLoading(false);
    }
  }

  async function previewManualPaste() {
    setError("");
    setNotice("");
    try {
      const result = await importPlateReadings({ kind: "manual-paste", text: manualText, metadata: manualMetadata });
      previewBatch(result);
    } catch (importError) {
      setPendingBatch(null);
      setError(importError instanceof Error ? importError.message : "粘贴内容解析失败。");
    }
  }

  async function previewReadingTemplate(file: File) {
    setLoading(true);
    setError("");
    try {
      const result = await importPlateReadings({ kind: "reading-template", file, metadata: manualMetadata });
      previewBatch(result);
    } catch (importError) {
      setPendingBatch(null);
      setError(importError instanceof Error ? importError.message : "读数模板解析失败。");
    } finally {
      setLoading(false);
    }
  }

  async function previewProjectFile(file: File) {
    setLoading(true);
    setError("");
    try {
      previewBatch(await importPlateReadings({ kind: "project-file", file }));
    } catch (importError) {
      setPendingBatch(null);
      setError(importError instanceof Error ? importError.message : "项目文件读取失败。");
    } finally {
      setLoading(false);
    }
  }

  function downloadReadingTemplate() {
    const bytes = createReadingTemplateWorkbook(selectedReadingTemplate, readingTemplatePlateCount, manualMetadata);
    downloadBlob(
      `microplate-reading-template-${selectedReadingTemplate.id}well-${readingTemplatePlateCount}plate.xlsx`,
      new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    );
  }

  function downloadProjectFile() {
    if (!workspace) return;
    downloadArtifact(createArtifact({
      kind: "project",
      plates: workspacePlates(workspace),
      experiment,
      activeModuleId,
      analysisConfig: config,
      sourceName: plate?.metadata.sourceFileName,
    }));
  }

  function applyBatch() {
    if (!selected.size) return;
    const patch: LayoutPatch = {};
    if (batchDraft.role) patch.role = batchDraft.role;
    if (!blankAnnotationMode) {
      if (batchDraft.sampleId) patch.sampleId = batchDraft.sampleId;
      if (batchDraft.group) patch.group = batchDraft.group;
      if (batchDraft.treatment) patch.treatment = batchDraft.treatment;
      if (batchDraft.concentration) patch.concentration = batchDraft.concentration;
      if (batchDraft.timepoint) patch.timepoint = batchDraft.timepoint;
      if (batchDraft.biologicalReplicate) patch.biologicalReplicate = batchDraft.biologicalReplicate;
      if (batchDraft.technicalReplicate) patch.technicalReplicate = batchDraft.technicalReplicate;
    }
    patch.excluded = batchDraft.excluded === "true";
    if (batchDraft.notes) patch.notes = batchDraft.notes;
    const ordered = [...selectedWells].sort((a, b) => a.row.localeCompare(b.row) || a.column - b.column);
    const technicalByWell = new Map(ordered.map((well, index) => [well.well, `T${index + 1}`]));
    setWorkspace((current) => current ? transitionPlateWorkspace(current, {
      type: "update-selected-annotations",
      update: (annotation, well) => ({
        ...annotation,
        ...patch,
        technicalReplicate: autoNumberTechnical && !batchDraft.technicalReplicate
          ? technicalByWell.get(well.well) ?? annotation.technicalReplicate
          : (patch.technicalReplicate ?? annotation.technicalReplicate),
      }),
    }) : current);
    setDraftStatus("applied");
    setNotice(`已更新 ${selected.size} 个孔；原始读数未改变。`);
  }

  function setSelectedExclusion(excluded: boolean) {
    if (!selected.size) return;
    setWorkspace((current) => current ? transitionPlateWorkspace(current, { type: "update-selected-annotations", update: (annotation) => ({ ...annotation, excluded }) }) : current);
    setBatchDraft((current) => ({ ...current, excluded: excluded ? "true" : "false" }));
    setDraftStatus("applied");
    setNotice(excluded ? `已将 ${selected.size} 个孔标记为排除；原始读数未改变。` : `已将 ${selected.size} 个孔恢复为纳入分析；原始读数未改变。`);
  }

  function selectWellsByPreset(value: string) {
    const matches = value === "unassigned" ? wells.filter((well) => well.role === "unassigned")
      : value === "ungrouped" ? wells.filter((well) => well.role === "sample" && !well.group)
        : value === "blank" ? wells.filter((well) => well.role === "blank")
          : value === "excluded" ? wells.filter((well) => well.excluded)
            : [];
    const next = new Set(matches.map((well) => well.well));
    updatePlateSelection(next, matches.at(-1)?.well ?? null);
  }

  function toggleSummarySelection(key: string) {
    setWorkspace((current) => current ? transitionPlateWorkspace(current, { type: "toggle-summary", key }) : current);
  }

  async function previewLayoutFile(file: File) {
    if (!confirmDiscardDraft()) return;
    clearBatchDraft();
    setLayoutBiologicalMode("preserve");
    setLayoutMismatchConfirmed(false);
    setPendingLayoutFile({ name: file.name, text: await file.text() });
    setNotice("板布局文件已读取，请核对匹配范围和重复编号处理方式后再应用。");
    setError("");
  }

  function applyPendingLayout() {
    if (!layoutImportPreview?.matched || (layoutImportPreview.plateShapeMismatch && !layoutMismatchConfirmed)) return;
    setWorkspace((current) => current ? transitionPlateWorkspace(current, { type: "replace-active-wells", wells: layoutImportPreview.wells }) : current);
    setNotice(`已将布局应用到 ${layoutImportPreview.matched} 个孔；当前板原始读数未改变。`);
    setError(layoutImportPreview.warnings.join(" "));
    setPendingLayoutFile(null);
    setLayoutMismatchConfirmed(false);
  }

  function downloadCurrentLayout() {
    if (!plate) return;
    if (draftStatus === "dirty") {
      setError("右侧仍有尚未应用的注释。请先应用或清空填写，再导出当前板布局。");
      return;
    }
    const safePlateName = plate.metadata.plateName.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "-").replace(/^-+|-+$/g, "") || "plate";
    downloadTextFile(
      `${safePlateName}-reusable-layout.csv`,
      currentPlateLayoutCsv({ rows: plate.rows, columns: plate.columns, plateName: plate.metadata.plateName, wells }),
      "text/csv",
    );
    setNotice("当前板布局已导出；文件仅包含孔位注释，不包含原始读数和分析结果。");
  }

  function exportFiles(kind: "workbook" | "package" | "normalization-ready" | "normalized") {
    if (!plate) return;
    if (kind === "package") {
      downloadArtifact(createArtifact({ kind: "analysis-package", plate, plates, wells, analysisConfig: config, result: analysis, normalizationResult: baselineNormalization }));
      return;
    }
    if (kind === "normalization-ready" || kind === "normalized") {
      downloadArtifact(createArtifact({
        kind: kind === "normalized" ? "normalized-results" : "normalization-ready",
        plates,
        result: kind === "normalization-ready" ? baselineNormalization : displayedBaselineNormalization,
        sourceName: experiment.name || plate.metadata.sourceFileName,
      }));
      return;
    }
    if (kind === "workbook") {
      const workbook = createResultWorkbook({ plate, result: displayedAnalysis, analysisConfig: config, scope: exportScope });
      downloadBlob(workbook.filename, new Blob([workbook.bytes], { type: workbook.mimeType }));
      setNotice("结果 Excel 已导出：包含导出说明、生物学汇总、孔级数据和板布局。");
      return;
    }
  }

  function updateAnalysisConfig(patch: Partial<typeof config>, touched = controlGroupTouched) {
    if (!workspace) return;
    setWorkspace(transitionPlateWorkspace(workspace, { type: "set-analysis-config", config: { ...config, ...patch }, touched }));
  }

  function updateBaselineNormalization(patch: Partial<BaselineNormalizationConfig>) {
    updateAnalysisConfig({ baselineNormalization: { ...normalizationConfig, ...patch } });
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="page-frame topbar-inner">
        <button className="brand" type="button" onClick={() => navigateTo("import")}>
          <span className="brand-mark"><i /><i /><i /><i /></span>
          <span><strong>Microplate Assay Studio</strong><small>酶标实验分析工作台 · v{toolIdentity.version}</small></span>
        </button>
        <div className="topbar-actions">
          <span className="privacy-pill"><i />Browser-local</span>
          {plate ? <span className={`status-pill ${workflowReady ? "ready" : "review"}`}>{workflowReady ? (activeModule.status === "complete" ? "分析就绪" : "数据预览就绪") : "需要补充信息"}</span> : null}
        </div>
      </div>
    </header>

    <main>
      <section className="assay-strip">
        <div className="page-frame assay-strip-inner">
          <div>
            <h1>酶标数据入口，选择实验类型进行分析</h1>
          </div>
          <div className="assay-cards">
            {assayModules.map((module) => <button key={module.id} type="button" disabled={module.status === "planned"} aria-pressed={selectedModuleId === module.id} onClick={() => selectAssayModule(module.id, module.name)} className={`assay-card ${module.status} ${selectedModuleId === module.id ? "active" : ""}`}>
              <span>{module.shortName}</span>
              <strong>{module.name}</strong>
              <small>{module.measurementTarget}</small>
              <em>{assayStatusLabel(module.status)}</em>
            </button>)}
          </div>
        </div>
      </section>

      {plate ? <nav className="workspace-nav" aria-label="工作区视图">
        {(["import", "layout", "analysis"] as View[]).map((item, index) => <button type="button" key={item} className={view === item ? "active" : ""} onClick={() => navigateTo(item)}><span>{index + 1}</span>{item === "import" ? "数据导入" : item === "layout" ? "板图与注释" : "分析与导出"}</button>)}
      </nav> : null}

      {notice ? <div className="notice success" role="status">{notice}</div> : null}
      {error ? <div className="notice warning" role="alert">{error}<button type="button" onClick={() => setError("")}>×</button></div> : null}

      {view === "import" ? <section className="workspace import-workspace">
        <div className="section-heading split">
          <div><h2>导入孔板读数</h2><p>当前模块：{selectedModule.name} · {selectedModule.measurementTarget}。可以导入仪器结果，也可以粘贴 Excel 矩阵或填写标准读数模板；全部数据只在浏览器本地处理。</p></div>
          <div className="import-heading-actions">{plate ? <><span className="adapter-badge">{plate.metadata.adapterId}</span><button type="button" className="secondary-button mini" onClick={downloadProjectFile}>保存可复现项目</button></> : null}<input ref={projectInput} hidden type="file" accept=".json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void previewProjectFile(file); event.target.value = ""; }} /><button type="button" className="secondary-button mini" onClick={() => projectInput.current?.click()}>重新打开项目文件</button></div>
        </div>
        <div className="import-source-tabs" role="tablist" aria-label="孔板读数来源">
          <button type="button" role="tab" aria-selected={importMode === "instrument"} className={importMode === "instrument" ? "active" : ""} onClick={() => { setImportMode("instrument"); setPendingBatch(null); }}>仪器结果文件</button>
          <button type="button" role="tab" aria-selected={importMode === "paste"} className={importMode === "paste" ? "active" : ""} onClick={() => { setImportMode("paste"); setPendingBatch(null); }}>粘贴孔板读数</button>
          <button type="button" role="tab" aria-selected={importMode === "template"} className={importMode === "template" ? "active" : ""} onClick={() => { setImportMode("template"); setPendingBatch(null); }}>读数模板</button>
        </div>

        {importMode === "instrument" ? <>
          <input ref={instrumentInput} hidden multiple type="file" accept=".xml,.xlsx,.xls,.skax" onChange={(event) => { const files = [...(event.target.files ?? [])]; if (files.length) void importInstrumentFileSelection(files); event.target.value = ""; }} />
          <button type="button" className="dropzone" disabled={loading} onClick={() => instrumentInput.current?.click()}>
            <span className="dropzone-icon">DATA</span>
            <span><strong>{loading ? "正在解析…" : plate ? "添加一个或多个仪器文件" : "选择一个或多个酶标仪导出文件"}</strong><small>可同时选择 Day 0、Day 1、Day 2 等独立文件；支持 SkanIt XML / XLSX 和旧版 XLS。</small></span>
            <b>Browse</b>
          </button>
        </> : <div className="manual-import-panel">
          <div className="manual-metadata-grid">
            <Field label="检测模式 *"><select value={manualDetectionMode} onChange={(event) => { const mode = event.target.value as DetectionMode; setManualDetectionMode(mode); setManualSignalUnit(mode === "absorbance" ? "OD" : mode === "fluorescence" ? "RFU" : "RLU"); }}><option value="absorbance">吸光</option><option value="fluorescence">荧光</option><option value="luminescence">发光</option><option value="trf">时间分辨荧光</option><option value="alpha">Alpha</option></select></Field>
            <Field label="信号单位 *"><input value={manualSignalUnit} onChange={(event) => setManualSignalUnit(event.target.value)} placeholder="OD / RFU / RLU" /></Field>
            <Field label="检测波长 (nm)"><input type="number" min="0" value={manualWavelength} disabled={manualDetectionMode !== "absorbance"} onChange={(event) => setManualWavelength(event.target.value)} placeholder="例如 450" /><small className="field-help">由用户填写；系统不会根据数值猜测。</small></Field>
            {manualDetectionMode === "fluorescence" ? <><Field label="激发波长 Ex (nm)"><input type="number" min="0" value={manualExcitation} onChange={(event) => setManualExcitation(event.target.value)} placeholder="例如 560" /></Field><Field label="发射波长 Em (nm)"><input type="number" min="0" value={manualEmission} onChange={(event) => setManualEmission(event.target.value)} placeholder="例如 590" /></Field></> : null}
          </div>
          {importMode === "paste" ? <>
            <label className="manual-paste-field"><span>从 Excel 复制固定孔板矩阵</span><textarea aria-label="粘贴孔板读数" value={manualText} onChange={(event) => setManualText(event.target.value)} placeholder={"吸光值\t1\t2\t3\t…\t12\nA\t0.4586\t0.4725\t0.4509\t…\nB\t0.4542\t0.4696\t0.4512\t…\n…\nH\t0.4546\t0.4572\t0.4582\t…"} /></label>
            <div className="manual-import-actions"><p>允许在同一粘贴内容中连续出现多块板。空格表示未测，数字 0 会作为真实读数保留。</p><button type="button" className="primary-button" disabled={!manualText.trim()} onClick={() => void previewManualPaste()}>解析并预览</button></div>
          </> : <>
            <div className="template-builder">
              <Field label="读数模板板型"><select value={readingTemplateId} onChange={(event) => setReadingTemplateId(event.target.value)}>{plateTemplateDefinitions.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}</select></Field>
              <Field label="板数量"><input type="number" min="1" max="12" value={readingTemplatePlateCount} onChange={(event) => setReadingTemplatePlateCount(Math.max(1, Math.min(12, Number(event.target.value) || 1)))} /></Field>
              <button type="button" className="secondary-button" onClick={downloadReadingTemplate}>下载读数模板</button>
            </div>
            <input ref={readingTemplateInput} hidden type="file" accept=".xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) void previewReadingTemplate(file); event.target.value = ""; }} />
            <button type="button" className="dropzone compact-dropzone" disabled={loading} onClick={() => readingTemplateInput.current?.click()}><span className="dropzone-icon">XLSX</span><span><strong>{loading ? "正在解析…" : "导入已填写的读数模板"}</strong><small>每块板使用一个工作表；也支持一个工作表内连续排列多个固定矩阵。</small></span><b>Browse</b></button>
          </>}
        </div>}

        {pendingBatch ? <div className="import-preview" aria-label="导入预览">
          <div className="import-preview-head"><div><h3>确认导入</h3><span>{pendingBatch.sourceKind === "manual-paste" ? "人工粘贴" : pendingBatch.sourceKind === "reading-template" ? "读数模板" : pendingBatch.sourceKind === "project-file" ? "可复现项目" : "仪器文件"}</span></div><p>识别到 {pendingBatch.plates.length} 块独立孔板 · {pendingImportTarget === "append" && pendingCanAppend ? "将追加到当前项目" : "将替换当前项目"}</p></div>
          {pendingCanAppend ? <div className="import-target-choice" role="radiogroup" aria-label="导入到项目">
            <label className={pendingImportTarget === "append" ? "active" : ""}><input type="radio" name="import-target" value="append" checked={pendingImportTarget === "append"} onChange={() => setPendingImportTarget("append")} /><span><strong>追加到当前项目</strong><small>推荐用于不同日期或不同批次的板；保留现有板、注释与分析设置。</small></span></label>
            <label className={pendingImportTarget === "replace" ? "active" : ""}><input type="radio" name="import-target" value="replace" checked={pendingImportTarget === "replace"} onChange={() => setPendingImportTarget("replace")} /><span><strong>替换当前项目</strong><small>清空当前工作区后载入所选板。</small></span></label>
          </div> : null}
          <div className="preview-plate-list">{pendingBatch.plates.map((item, index) => {
            const detected = detectedAssayModule(item);
            const chosen = pendingModuleIds[index] ?? "unknown";
            const mismatch = pendingBatch.sourceKind === "instrument-file" && detected !== "unknown" && chosen !== detected;
            return <div key={`${item.metadata.plateName}-${index}`} className={`${pendingIncludedPlates.has(index) ? "included" : "excluded"} ${mismatch ? "module-mismatch" : ""}`}>
              <label className="preview-include"><input type="checkbox" aria-label={`载入 ${item.metadata.plateName}`} checked={pendingIncludedPlates.has(index)} onChange={(event) => setPendingIncludedPlates((current) => { const next = new Set(current); if (event.target.checked) next.add(index); else next.delete(index); return next; })} /></label>
              <div className="preview-plate-summary"><strong>{item.metadata.plateName}</strong><span title={item.metadata.sourceFileName}>{item.metadata.sourceFileName} · {item.rows} × {item.columns} · {item.wells.length} 个已测孔</span><small>{item.warnings[0] || "结构检查通过"}</small></div>
              <div className="module-review"><small>系统识别</small><strong>{detected === "unknown" ? "未可靠识别" : getAssayWorkflow(detected).name}</strong></div>
              <label className="module-confirm"><span>载入到</span><select value={chosen} onChange={(event) => { const next = [...pendingModuleIds]; next[index] = event.target.value as AssayModuleId; setPendingModuleIds(next); setPendingConflictConfirmed(false); }}>{assayModules.filter((module) => module.status !== "planned").map((module) => <option key={module.id} value={module.id}>{module.name} · {assayStatusLabel(module.status)}</option>)}<option value="unknown">通用酶标数据预览</option></select></label>
              {mismatch ? <b className="mismatch-badge">选择与识别不一致</b> : null}
            </div>;
          })}</div>
          {pendingBatch.warnings.length ? <ul className="preview-warnings">{pendingBatch.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul> : null}
          {pendingHasConflict ? <label className="conflict-confirm"><input type="checkbox" checked={pendingConflictConfirmed} onChange={(event) => setPendingConflictConfirmed(event.target.checked)} />我已核对实验记录，确认按“载入到”所选模块继续；系统识别结果会保留在溯源信息中。</label> : null}
          <div className="manual-import-actions"><button type="button" className="secondary-button" onClick={() => setPendingBatch(null)}>取消</button><button type="button" className="primary-button" disabled={!pendingIncludedPlates.size || (pendingHasConflict && !pendingConflictConfirmed)} onClick={() => loadBatch(pendingBatch)}>{pendingImportTarget === "append" && pendingCanAppend ? "确认追加" : "确认载入"} {pendingIncludedPlates.size} 块板</button></div>
        </div> : null}

        <AssayWorkflowPanel variant="disclosure" module={selectedModule} plate={plate && activeModuleId === selectedModuleId ? plate : null} />
        {plates.length > 1 ? <div className="plate-switcher"><div><strong>当前项目包含 {plates.length} 块板</strong><small>各板分别扣除自己的 blank；不同日期通过时间点和 baseline 设置关联，不会自动冒充生物学重复。</small></div><div className="plate-switcher-buttons">{plates.map((item, index) => { const label = plateSwitcherLabel(item, index, plates); return <button type="button" title={label} key={item.plateId ?? `${item.metadata.plateName}-${index}`} className={index === activePlateIndex ? "active" : ""} onClick={() => selectActivePlate(index)}>{label}</button>; })}</div><label>当前板名称<input value={plate?.metadata.plateName ?? ""} onChange={(event) => renameActivePlate(event.target.value)} /></label></div> : null}
        {plate ? <div className="experiment-overview">
          <div className="experiment-overview-head"><div><h3>本次实验基本信息</h3><p>仪器报告值、用户填写值和推断项分别保留；人工确认不会覆盖原始记录。</p></div>{plate.metadata.assayMethodReviewDecision === "user-confirmed" ? <button type="button" className="evidence-badge user-reviewed" onClick={openMethodReview}>已复核 · 修改</button> : plate.metadata.assayMethodEvidence === "reported" ? <span className="evidence-badge reported">协议已记录</span> : plate.metadata.assayMethodEvidence === "user-reported" ? <span className="evidence-badge user-reported">用户已填写</span> : assayMethodNeedsReview ? <button type="button" className={`evidence-badge review-action ${plate.metadata.assayMethodEvidence}`} onClick={openMethodReview}>核对实验方法</button> : null}</div>
          {methodReviewOpen ? <div className="method-review-panel" aria-label="实验方法复核">
            <div><strong>核对实验方法</strong><p>确认值用于后续展示与导出；仪器记录和系统原始识别不会被改写。</p></div>
            <label>确认方法<input list="assay-method-options" value={methodReviewDraft} onChange={(event) => setMethodReviewDraft(event.target.value)} autoFocus /><datalist id="assay-method-options">{activeModule.supportedMethods.map((method) => <option key={method} value={method} />)}</datalist></label>
            <div className="method-review-actions"><button type="button" className="secondary-button mini" onClick={() => setMethodReviewOpen(false)}>取消</button><button type="button" className="primary-button mini" onClick={confirmMethodReview}>确认方法</button></div>
          </div> : null}
          <div className="metadata-grid experiment-metadata-grid">
            <Metric label="确认实验类型" value={activeModule.name} detail={`决策：${plate.metadata.assayAssignmentDecision ?? "未记录"}`} />
            <Metric label="系统识别类型" value={detectedAssayModule(plate) === "unknown" ? "未可靠识别" : getAssayWorkflow(detectedAssayModule(plate)).name} detail="与用户确认结果分别保留" />
            <Metric label="实验方法" value={displayedAssayMethodLabel(plate)} detail={methodEvidenceLabel(plate)} />
            <Metric label="检测模式" value={detectionModeLabel(plate.metadata.detectionMode)} detail={`${plate.metadata.measurementName || "未命名通道"} · ${plate.metadata.signalUnit || "无单位"}`} />
            <Metric label="读数通道" value={measurementChannel(plate)} detail={plate.metadata.detectionMode === "fluorescence" ? "激发 / 发射" : "主波长 / 参比波长"} />
            <Metric label="仪器" value={instrumentDisplay(plate)} detail={plate.metadata.instrumentSerialNumber ? `S/N ${plate.metadata.instrumentSerialNumber}` : "序列号未记录"} />
            <Metric label="运行" value={plate.metadata.runTimestamp || "未记录"} detail={plate.metadata.assayId ? `Assay ID ${plate.metadata.assayId}` : "Assay ID 未记录"} />
            <Metric label="板型" value={`${plate.rows} × ${plate.columns} · ${plate.rows * plate.columns} 孔`} detail={`${plate.wells.length} 个已测孔 · ${plate.metadata.plateType || "板型未命名"}`} />
            <Metric label="读板设置" value={readSettingDisplay(plate)} detail={plate.metadata.readDirection ? `原文：${plate.metadata.readDirection}` : "文件未记录读板方向"} />
            <Metric label="来源" value={plate.metadata.sourceFileName} detail={plate.metadata.protocolName || plate.metadata.sourceExperiment || "协议名未记录"} />
          </div>
        </div> : null}
        {plate?.warnings.length ? <ul className="compact-findings">{plate.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
        {plate ? <div className="next-step import-next-step"><div><strong>基本信息已解析</strong><p>{useGenericWorkflow ? `已保留 ${plate.assayData?.measurements.length ?? 0} 个测量/计算步骤；下一步可检查板图身份与孔位注释。` : assayMethodNeedsReview ? "请先核对实验方法；下一步补充样本、对照、空白与重复信息。" : "实验方法已有明确来源或已完成复核；下一步补充样本、对照、空白与重复信息。"}</p></div><button type="button" className="primary-button" onClick={() => navigateTo("layout")}>进入板图与注释</button></div> : null}
      </section> : null}

      {view === "layout" && plate ? <section className="workspace">
        <div className="section-heading split layout-section-heading">
          <div><h2>板图与实验注释</h2><p>{activeModule.annotationGuidance} 仪器标签不是实验分组，系统不会根据原始读数高低猜测角色或重复。</p></div>
          <div className="layout-heading-actions" role="toolbar" aria-label="板图操作">
            <input ref={layoutInput} hidden type="file" accept=".csv,.tsv,.txt" onChange={(event) => { const file = event.target.files?.[0]; if (file) void previewLayoutFile(file); event.target.value = ""; }} />
            <div className="layout-action-group layout-navigation-actions"><PreviousStepButton label="返回数据导入" onClick={() => navigateTo("import")} /></div>
            <div className="layout-action-group layout-template-actions">
              <select className="template-select" value={layoutTemplateId} onChange={(event) => setLayoutTemplateId(event.target.value)} aria-label="板图模板类型">
                {plateTemplateDefinitions.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
              </select>
              <button className="secondary-button" type="button" onClick={() => downloadTextFile(`microplate-layout-template-${selectedTemplate.id}well.csv`, layoutTemplateCsv(selectedTemplate), "text/csv")}>下载板图模板</button>
              <button className="secondary-button" type="button" onClick={() => layoutInput.current?.click()}>导入板布局</button>
            </div>
            <div className="layout-action-group layout-export-actions"><button className="secondary-button" type="button" onClick={downloadCurrentLayout}>导出当前板布局</button></div>
          </div>
        </div>
        <PlateContextTabs plates={plates} activePlateIndex={activePlateIndex} onSelect={selectActivePlate} context="layout" />
        {layoutImportPreview && pendingLayoutFile ? <section className="layout-import-preview" aria-label="板布局导入预览">
          <div className="layout-import-preview-head">
            <div><h3>板布局导入预览</h3><p title={pendingLayoutFile.name}>{pendingLayoutFile.name}{layoutImportPreview.metadata.plateName ? ` · 来源板：${layoutImportPreview.metadata.plateName}` : ""}</p></div>
            <dl className="layout-preview-metrics">
              <div className="primary"><dt>成功匹配孔</dt><dd>{layoutImportPreview.matched}</dd></div>
              <div><dt>文件孔位</dt><dd>{layoutImportPreview.sourceWellCount}</dd></div>
              <div><dt>超出当前板</dt><dd>{layoutImportPreview.outOfPlateWells.length}</dd></div>
              <div><dt>来源板型</dt><dd>{layoutImportPreview.metadata.plateRows && layoutImportPreview.metadata.plateColumns ? `${layoutImportPreview.metadata.plateRows} × ${layoutImportPreview.metadata.plateColumns}` : "未声明"}</dd></div>
            </dl>
            <button type="button" className="secondary-button mini" onClick={() => setPendingLayoutFile(null)}>取消</button>
          </div>
          <div className="layout-preview-details">
            <div className="layout-preview-fields"><strong>将更新的注释字段</strong><p>{layoutImportPreview.affectedFields.map((field) => layoutFieldLabels[field]).join("、") || "未识别到可更新字段"}</p></div>
            <fieldset>
              <legend>生物学重复</legend>
              <div><label><input type="radio" name="layout-biological-mode" checked={layoutBiologicalMode === "preserve"} onChange={() => setLayoutBiologicalMode("preserve")} />沿用布局编号</label>
                <label><input type="radio" name="layout-biological-mode" checked={layoutBiologicalMode === "clear"} onChange={() => setLayoutBiologicalMode("clear")} />清空并重新填写</label></div>
              <p>技术重复关系继续沿用；新检测的原始读数保持不变。</p>
            </fieldset>
            <button type="button" className="primary-button layout-preview-apply" disabled={!layoutImportPreview.matched || (layoutImportPreview.plateShapeMismatch && !layoutMismatchConfirmed)} onClick={applyPendingLayout}>应用到当前板的 {layoutImportPreview.matched} 个孔</button>
          </div>
          {layoutImportPreview.warnings.length ? <details className="layout-preview-warnings"><summary>查看 {layoutImportPreview.warnings.length} 条导入提示</summary><ul>{layoutImportPreview.warnings.slice(0, 8).map((warning) => <li key={warning}>{warning}</li>)}</ul></details> : null}
          {layoutImportPreview.plateShapeMismatch ? <label className="check-row layout-mismatch-confirm"><input type="checkbox" checked={layoutMismatchConfirmed} onChange={(event) => setLayoutMismatchConfirmed(event.target.checked)} />我已核对不同板型，只将地址一致的孔位注释应用到当前板</label> : null}
        </section> : null}
        <div className={`layout-grid${annotationPanelCollapsed ? " annotation-collapsed" : ""}`}>
          <div className="panel plate-panel">
            <div className="panel-head plate-panel-head">
              <div><h3>{plate.rows * plate.columns}孔板 · {plate.wells.length}个已测孔</h3><p>拖动框选；Ctrl / Command 追加框选或逐孔增减；Shift 点选头尾矩形区域。</p></div>
              <div className="plate-head-actions"><span>{selected.size} 个已选</span><div className="zoom-controls" aria-label="孔板缩放"><button type="button" disabled={plateZoom <= 0.5} onClick={() => setPlateZoom(plateZoom - 0.1, true)} aria-label="缩小孔板">−</button><button type="button" onClick={() => setPlateZoom(1, true)} aria-label="重置为百分之百">{Math.round(plateZoom * 100)}%</button><button type="button" disabled={plateZoom >= 1.3} onClick={() => setPlateZoom(plateZoom + 0.1, true)} aria-label="放大孔板">＋</button></div></div>
            </div>
            <PlateMap wells={wells} selected={selected} selectionAnchor={selectionAnchor} onSelectionChange={updatePlateSelection} plateRows={plate.rows} plateColumns={plate.columns} signalLabel={rawSignalLabel(plate)} zoom={plateZoom} autoFitEnabled={!platePresentation.zoomManuallyChanged} onAutoFit={(nextZoom) => setPlateZoom(nextZoom, false)} />
            <div className="plate-legend"><span className="unassigned">未指定 {roleCounts.unassigned}</span><span className="sample">样本 {roleCounts.sample}</span><span className="control">对照 {roleCounts.control}</span><span className="standard">标准品 {roleCounts.standard}</span><span className="qc">质控 {roleCounts.qc}</span><span className="blank">空白 {roleCounts.blank}</span><span>颜色深浅表示原始读数，不表示分组。</span></div>
          </div>
          <aside className={`panel annotation-panel${annotationPanelCollapsed ? " collapsed" : ""}`}>
            <div className="panel-head annotation-panel-head">
              <div className="annotation-panel-title"><h3>批量注释</h3><p>{selected.size ? `填写内容将应用到 ${selected.size} 个孔；留空字段保持原值。` : "先在板图中选择一个或多个孔。"}</p></div>
              <div className="annotation-panel-head-actions">
                {annotationPanelCollapsed && selected.size ? <span className="annotation-collapsed-count" title={`${selected.size} 个孔已选`}>{selected.size}</span> : null}
                {draftStatus !== "idle" ? <span className={`draft-badge ${draftStatus}`}>{draftStatus === "dirty" ? "尚未应用" : "已应用"}</span> : null}
                <button type="button" className="annotation-panel-toggle" aria-expanded={!annotationPanelCollapsed} aria-controls="annotation-panel-content" aria-label={annotationPanelCollapsed ? "展开批量注释" : "收起批量注释"} onClick={() => setAnnotationPanelCollapsed((current) => !current)}><AnnotationPanelToggleIcon collapsed={annotationPanelCollapsed} /></button>
              </div>
            </div>
            {!annotationPanelCollapsed ? <div className="annotation-panel-body" id="annotation-panel-content">
              <div className="well-detail">
                {selectedSingleWell ? <>
                  <div className="well-detail-title"><strong>{selectedSingleWell.well}</strong><span>{selectedSingleWell.excluded ? "排除分析" : "纳入分析"}</span></div>
                  <dl>
                    <div><dt>角色</dt><dd>{roleLabel(selectedSingleWell.role)}</dd></div><div><dt>{rawSignalLabel(plate)}</dt><dd>{formatRawSignal(plate, selectedSingleWell.rawValue)}</dd></div>
                    {selectedSingleWell.role === "blank" ? <><div><dt>用途</dt><dd>背景扣除</dd></div><div><dt>Blank mean</dt><dd>{analysis.blankMean === null ? "未计算" : analysis.blankMean.toFixed(4)}</dd></div></> : null}
                    {selectedSingleWell.group ? <div><dt>分组</dt><dd>{selectedSingleWell.group}</dd></div> : null}{selectedSingleWell.sampleId ? <div><dt>样本ID</dt><dd>{selectedSingleWell.sampleId}</dd></div> : null}{selectedSingleWell.biologicalReplicate ? <div><dt>生物学重复</dt><dd>{selectedSingleWell.biologicalReplicate}</dd></div> : null}{selectedSingleWell.treatment ? <div><dt>处理</dt><dd>{selectedSingleWell.treatment}</dd></div> : null}{selectedSingleWell.concentration ? <div><dt>浓度</dt><dd>{selectedSingleWell.concentration}</dd></div> : null}{selectedSingleWell.timepoint ? <div><dt>时间点</dt><dd>{selectedSingleWell.timepoint}</dd></div> : null}{selectedSingleWell.technicalReplicate ? <div><dt>技术重复</dt><dd>{selectedSingleWell.technicalReplicate}</dd></div> : null}{selectedSingleWell.instrumentLabel ? <div><dt>仪器标签</dt><dd>{selectedSingleWell.instrumentLabel}</dd></div> : null}{selectedSingleWell.notes ? <div className="wide"><dt>备注</dt><dd>{selectedSingleWell.notes}</dd></div> : null}
                  </dl>
                </> : selectedWells.length ? <>
                  <div className="well-detail-title"><strong>{selectedWells.length} 个孔</strong><span>{selectedExcludedCount ? `${selectedExcludedCount} 个已排除` : "全部纳入"}</span></div>
                  <p className="selected-well-summary">{selectedWells.slice(0, 6).map((well) => well.well).join("、")}{selectedWells.length > 6 ? "…" : ""}</p>
                  <div className="role-summary">{wellRoles.filter((role) => selectedRoleCounts[role]).map((role) => <span key={role}>{roleLabel(role)} {selectedRoleCounts[role]}</span>)}</div>
                </> : <p>点击或框选孔位后，这里会显示读数和已有注释。</p>}
              </div>
              <div className="quick-selects"><select aria-label="快速选择孔" defaultValue="" onChange={(event) => { if (event.target.value) selectWellsByPreset(event.target.value); event.target.value = ""; }}><option value="" disabled>快速选择…</option><option value="unassigned">所有未指定孔</option><option value="ungrouped">所有未分组样本</option><option value="blank">所有空白孔</option><option value="excluded">所有已排除孔</option></select>{selectedExcludedCount ? <button type="button" onClick={() => setSelectedExclusion(false)}>恢复纳入</button> : null}<button type="button" disabled={!selected.size} onClick={() => updatePlateSelection(new Set(), null)}>清除选择</button></div>
              <div className="form-grid annotation-core-form">
                <Field label="孔角色"><select value={batchDraft.role} onChange={(event) => changeBatchDraft({ role: event.target.value as BatchDraft["role"] })}><option value="">保持原值</option><option value="unassigned">未指定</option><option value="sample">样本</option><option value="control">对照</option><option value="standard">标准品</option><option value="qc">质控</option><option value="blank">空白</option></select></Field>
                {!blankAnnotationMode ? <><Field label="分组 · Group"><input value={batchDraft.group} onChange={(event) => changeBatchDraft({ group: event.target.value })} placeholder="NC / siGENE" /></Field><Field label="样本ID"><input value={batchDraft.sampleId} onChange={(event) => changeBatchDraft({ sampleId: event.target.value })} placeholder="A549_NC_B1" /></Field><Field label="生物学重复"><input value={batchDraft.biologicalReplicate} onChange={(event) => changeBatchDraft({ biologicalReplicate: event.target.value })} placeholder="Bio1" /><small className="field-help">填写独立培养、处理或制备单元。Bio1、Bio2 可位于同一板；同一 Bio 内的多个孔才是技术复孔。</small></Field></> : null}
                <Field label="排除状态"><select value={batchDraft.excluded} onChange={(event) => changeBatchDraft({ excluded: event.target.value as BatchDraft["excluded"] })}><option value="false">纳入分析</option><option value="true">排除分析</option></select>{selectedExclusionState === "mixed" ? <small className="field-help">所选孔状态不一致；应用后会统一为当前选择。</small> : null}</Field>
              </div>
              {!blankAnnotationMode ? <details className="advanced-fields" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}><summary>更多实验信息{advancedFilledCount ? <span>{advancedFilledCount} 项已填写</span> : null}</summary><div className="form-grid"><Field label="处理"><input value={batchDraft.treatment} onChange={(event) => changeBatchDraft({ treatment: event.target.value })} placeholder="siRNA / Drug" /></Field><Field label="浓度"><input value={batchDraft.concentration} onChange={(event) => changeBatchDraft({ concentration: event.target.value })} placeholder="10 nM" /></Field><Field label="时间点"><input value={batchDraft.timepoint} onChange={(event) => changeBatchDraft({ timepoint: event.target.value })} placeholder="Day0 / 24 h" /></Field><Field label="技术重复"><input value={batchDraft.technicalReplicate} onChange={(event) => changeBatchDraft({ technicalReplicate: event.target.value })} placeholder="通常留空" /><small className="field-help">通常由下方选项按当前顺序自动编号。</small></Field><Field label="备注"><input value={batchDraft.notes} onChange={(event) => changeBatchDraft({ notes: event.target.value })} /></Field></div><label className="check-row"><input type="checkbox" checked={autoNumberTechnical} onChange={(event) => { setAutoNumberTechnical(event.target.checked); setDraftStatus("dirty"); }} />按当前选择顺序自动编号技术重复 T1…Tn</label></details> : <p className="blank-form-note">空白孔只参与背景扣除；通常只需确认角色与纳入/排除状态。</p>}
            </div> : null}
            {!annotationPanelCollapsed ? <div className="annotation-panel-footer"><button type="button" className="secondary-button" disabled={draftStatus === "idle"} onClick={clearBatchDraft}>清空填写</button><button type="button" className="primary-button" disabled={!selected.size} onClick={applyBatch}>应用到所选 {selected.size} 个孔</button></div> : null}
          </aside>
        </div>
        <div className="next-step"><div><strong>{activeModuleId === "cell-viability" ? (analysis.findings.some((finding) => finding.code === "LAYOUT_INCOMPLETE" || finding.code === "ROLE_UNASSIGNED") ? "板图尚未完成" : "板图具备基础分析条件") : "孔位身份可继续补充"}</strong><p>{activeModuleId === "cell-viability" ? "只有孔角色、分组和生物学重复齐全后，结果才会进入正式汇总。" : `${activeModule.name} 当前提供数据与仪器结果预览；未补齐的字段会保留为待确认，不会触发未经验证的计算。`}</p></div><button type="button" className="primary-button" onClick={() => navigateTo("analysis")}>进入分析</button></div>
      </section> : null}

      {view === "analysis" && plate && useGenericWorkflow && plate.assayData ? <section className="workspace analysis-workspace">
        <div className="section-heading split compact-heading">
          <div><h2>分析与导出</h2><p>按 SkanIt 测量和计算步骤浏览终点、动力学、光谱、标准曲线与多通道归一化结果。</p></div>
          <div className="analysis-heading-actions"><PreviousStepButton label="返回板图与注释" onClick={() => navigateTo("layout")} /><span className="readiness ready">{assayStatusLabel(activeModule.status)}</span></div>
        </div>
        <PlateContextTabs plates={plates} activePlateIndex={activePlateIndex} onSelect={selectActivePlate} context="analysis" />
        <AssayWorkflowPanel module={activeModule} plate={plate} />
        <AssayDataExplorer dataset={plate.assayData} onExport={() => downloadArtifact(createArtifact({ kind: "measurements", plate, wells, scope: "all" }))} onExportProject={downloadProjectFile} />
      </section> : null}

      {view === "analysis" && plate && !useGenericWorkflow ? <section className="workspace analysis-workspace">
        <div className="section-heading split compact-heading">
          <div><h2>分析与导出</h2><p>先合并技术复孔，再以生物学重复为统计单位；点选汇总表行后，下方图表、显著性和结果导出都只保留当前展示范围。</p></div>
          <div className="analysis-heading-actions"><PreviousStepButton label="返回板图与注释" onClick={() => navigateTo("layout")} /><span className={`readiness ${analysis.ready ? "ready" : "review"}`}>{analysis.ready ? "Ready for export" : "Review required"}</span><button type="button" className="secondary-button mini" onClick={downloadProjectFile}>保存可复现项目</button></div>
        </div>
        <PlateContextTabs plates={plates} activePlateIndex={activePlateIndex} onSelect={selectActivePlate} context="analysis" />
        <div className="analysis-layout-compact">
          <aside className="panel analysis-side-panel">
            <div className="panel-head compact-panel-head"><div><h3>分析设置</h3><p>显著性参考、显示变换与 QC 阈值彼此独立。</p></div></div>
            <div className="side-control-grid">
              <Field label="显著性参考组"><select value={config.controlGroup} onChange={(event) => updateAnalysisConfig({ controlGroup: event.target.value, relativeToControlEnabled: event.target.value ? config.relativeToControlEnabled : false }, true)}><option value="">不做组间显著性比较</option>{groups.map((group) => <option key={group} value={group}>{group}</option>)}</select><small className="field-help">{config.controlGroup ? `显著性将各 group 与 ${config.controlGroup} 比较。${!controlGroupTouched && inferredControlGroup === config.controlGroup ? "系统已根据 role=control 识别，可手动更改。" : ""}` : inferredControlGroup ? `检测到可能的对照组 ${inferredControlGroup}；选择后才启用比较。` : "该选择不会自动改变图表尺度。"}</small></Field>
              <label className="check-row compact-check"><input type="checkbox" checked={Boolean(config.relativeToControlEnabled)} disabled={!config.controlGroup} onChange={(event) => updateAnalysisConfig({ relativeToControlEnabled: event.target.checked })} />各时间点对照设为 100%（仅显示/导出）</label>
              {config.relativeToControlEnabled ? <p className="field-help">用于同一时间点的处理组 vs 对照展示，不是 Day 0 基线比较。对照均值视为固定常数，SD/SEM 仅同比例缩放。</p> : null}
              <Field label="技术复孔 CV 阈值 (%)"><input type="number" min="0" step="1" value={config.technicalCvThresholdPercent} onChange={(event) => updateAnalysisConfig({ technicalCvThresholdPercent: Number(event.target.value) })} /></Field>
              <Field label="空白孔 CV 阈值 (%)"><input type="number" min="0" step="1" value={config.blankCvThresholdPercent} onChange={(event) => updateAnalysisConfig({ blankCvThresholdPercent: Number(event.target.value) })} /></Field>
            </div>
            <details className="baseline-normalization-controls">
              <summary><span>跨板时间序列 · Baseline normalization</span><em>{normalizationConfig.enabled ? baselineNormalization.status : "默认关闭"}</em></summary>
              <div className="baseline-normalization-body">
                <p className="field-help baseline-intro">用于 Day 0、Day 1、Day 2 分布在不同孔板/文件的增殖实验。先把各文件追加到同一项目，再在板图中为样本和对照填写准确时间点。</p>
                <label className="check-row compact-check"><input type="checkbox" checked={normalizationConfig.enabled} onChange={(event) => updateBaselineNormalization({ enabled: event.target.checked })} />启用派生标准化</label>
                <Field label="Baseline timepoint"><select value={normalizationConfig.baselineTimepoint} onChange={(event) => updateBaselineNormalization({ baselineTimepoint: event.target.value })}><option value="">请选择精确时间点</option>{normalizationTimepoints.map((timepoint) => <option key={timepoint} value={timepoint}>{timepoint}</option>)}</select></Field>
                <Field label="标准化范围"><select value={normalizationConfig.scope} onChange={(event) => updateBaselineNormalization({ scope: event.target.value as BaselineNormalizationConfig["scope"] })}><option value="within-group">每组归一到自身 baseline</option><option value="reference-group">全部归一到参考组 baseline</option></select></Field>
                {normalizationConfig.scope === "reference-group" ? <Field label="Baseline reference group"><select value={normalizationConfig.referenceGroup} onChange={(event) => updateBaselineNormalization({ referenceGroup: event.target.value })}><option value="">请选择参考组</option>{normalizationGroups.map((group) => <option key={group} value={group}>{group}</option>)}</select></Field> : null}
                <Field label="计算方法"><select value={normalizationConfig.method} onChange={(event) => updateBaselineNormalization({ method: event.target.value as BaselineNormalizationConfig["method"] })}><option value="auto">Auto · 优先匹配 Bio ID</option><option value="matched-replicate-ratio">Matched replicate ratios</option><option value="ratio-of-means">Ratio of means + propagated SE</option><option value="fixed-baseline-scaling">Fixed baseline scaling · advanced</option></select></Field>
                <Field label="输出尺度"><select value={normalizationConfig.scale} onChange={(event) => updateBaselineNormalization({ scale: event.target.value as BaselineNormalizationConfig["scale"] })}><option value="fold">Fold · baseline = 1</option><option value="percent">Percent · baseline = 100</option></select></Field>
                <Field label="图中不确定性"><select value={normalizationConfig.uncertaintyDisplay} onChange={(event) => updateBaselineNormalization({ uncertaintyDisplay: event.target.value as BaselineNormalizationConfig["uncertaintyDisplay"] })}><option value="ci95">95% CI</option><option value="sem">SEM</option></select></Field>
                <div className="normalization-plate-scope"><strong>参与板</strong>{plates.map((candidate) => {
                  const plateId = candidate.plateId;
                  const explicit = normalizationConfig.plateSelectionMode === "selected";
                  const checked = Boolean(plateId) && (explicit ? normalizationConfig.participatingPlateIds.includes(plateId as string) : true);
                  return <label key={plateId ?? `${candidate.metadata.sourceFileName}-${candidate.metadata.plateName}`}><input type="checkbox" disabled={!plateId} checked={checked} onChange={(event) => {
                    if (!plateId) return;
                    const current = explicit ? normalizationConfig.participatingPlateIds : plates.flatMap((item) => item.plateId ? [item.plateId] : []);
                    const next = event.target.checked ? [...new Set([...current, plateId])] : current.filter((id) => id !== plateId);
                    updateBaselineNormalization({ plateSelectionMode: "selected", participatingPlateIds: next });
                  }} />{candidate.metadata.plateName}</label>;
                })}</div>
                <p className="field-help">先逐板扣 blank、再合并同一 Bio 内技术孔。显著性仍使用 blank-corrected biological-replicate values。Matched ratio 只适用于项目中保留了明确 Bio ID 的孔级数据；仅有 mean/SD/SEM 的汇总表不能重建 replicate-level ratio。</p>
                {baselineNormalization.findings.length ? <ul className="normalization-findings">{baselineNormalization.findings.map((finding, index) => <li key={`${finding.code}-${index}`} className={finding.severity}><strong>{finding.code}</strong>{finding.message}</li>)}</ul> : null}
              </div>
            </details>
            <div className={`qc-compact-block ${analysis.findings.length ? "has-findings" : "clear"}`}>
              <div className="side-section-title"><strong>质量控制</strong><span>{analysis.findings.length ? `${analysis.findings.length} 条` : "无需复核"}</span></div>
              {analysis.findings.length ? <ul className="qc-mini-list">{analysis.findings.map((finding, index) => <li key={`${finding.code}-${index}`} className={finding.severity} onClick={() => finding.wells.length && updatePlateSelection(new Set(finding.wells), finding.wells.at(-1) ?? null)}><span>{finding.severity}</span><div><strong>{finding.code}</strong><p title={finding.message}>{finding.message}</p>{finding.wells.length ? <small title={finding.wells.join(", ")}>{finding.wells.slice(0, 8).join(", ")}{finding.wells.length > 8 ? "…" : ""}</small> : null}</div></li>)}</ul> : null}
            </div>
          </aside>

          <section className="panel table-panel summary-panel">
            <div className="panel-head summary-panel-head">
              <div><h3>生物学汇总表</h3><p>{selectedSummaryKeys.size ? `当前展示 ${displayedBiologicalSummaries.length} 行；显著性按当前点选范围重新计算。` : "点击行后，下方图表、显著性和导出内容只显示所选行。"} 正式结果统一导出为 Excel，内含生物学汇总、孔级数据和板布局；relative_to_control_* 仅表示相对 Control 的派生结果。</p></div>
              <div className="summary-head-actions">
                {selectedSummaryKeys.size ? <button type="button" className="secondary-button mini" onClick={() => setWorkspace((current) => current ? transitionPlateWorkspace(current, { type: "clear-summary-selection" }) : current)}>显示全部</button> : null}
                <button type="button" className="primary-button mini" disabled={!displayedBiologicalSummaries.length} onClick={() => exportFiles("workbook")}>导出结果 Excel</button>
                <button type="button" className="secondary-button mini" title="始终导出完整项目范围及 QC 状态，确保后续时间点包含其 baseline 依赖。" disabled={!baselineNormalization.normalizationReadyRows.length} onClick={() => exportFiles("normalization-ready")}>标准化准备表</button>
                <button type="button" className="secondary-button mini" disabled={displayedBaselineNormalization.status !== "ready" || !displayedBaselineNormalization.normalizedRows.length} onClick={() => exportFiles("normalized")}>标准化结果</button>
              </div>
            </div>
            <div className="table-scroll summary-table-scroll"><table className="clickable-table"><thead><tr><th>显示</th>{summaryTableColumns.map((column) => <th key={column.key}>{column.header}</th>)}</tr></thead><tbody>{analysis.biologicalSummaries.length ? analysis.biologicalSummaries.map((row) => {
              const rowSelected = selectedSummaryKeys.has(row.key);
              const muted = selectedSummaryKeys.size > 0 && !rowSelected;
              return <tr key={row.key} className={`${rowSelected ? "selected-row" : ""}${muted ? " muted-row" : ""}`} onClick={() => toggleSummarySelection(row.key)}>
                <td><span className={`row-check ${rowSelected ? "active" : ""}`}>{rowSelected ? "✓" : ""}</span></td>
                {summaryTableColumns.map((column) => <td key={column.key}>{column.render(row)}</td>)}
              </tr>;
            }) : <tr><td colSpan={summaryTableColumns.length + 1} className="empty-cell">尚无可汇总数据。</td></tr>}</tbody></table></div>
            {normalizationConfig.enabled ? <div className="normalization-preview">
              <div><strong>Calculated in Studio · baseline normalization</strong><span className={`readiness ${baselineNormalization.status === "ready" ? "ready" : "review"}`}>{baselineNormalization.status}</span></div>
              {baselineNormalization.status === "ready" ? <div className="table-scroll compact"><table><thead><tr><th>Group</th><th>Time</th><th>Baseline</th><th>Method</th><th>Uncertainty</th><th>n</th><th>Normalized mean</th><th>SD</th><th>SEM / propagated SE</th><th>95% CI</th><th>Method warning</th></tr></thead><tbody>{displayedBaselineNormalization.normalizedRows.map((row) => <tr key={row.key}><td>{row.group}</td><td>{row.timepoint}</td><td>{row.baselineGroup} · {row.baselineTimepoint}</td><td>{row.method}</td><td>{row.uncertaintyMethod}</td><td>{row.n}</td><td>{format(row.normalizedMean)}</td><td>{format(row.normalizedSd)}</td><td>{format(row.normalizedSem ?? row.propagatedSe)}</td><td>{row.ci95Low === null || row.ci95High === null ? "未计算" : `${format(row.ci95Low)}–${format(row.ci95High)}`}</td><td>{row.warnings.length ? row.warnings.join(" ") : "—"}</td></tr>)}</tbody></table></div> : <p>标准化结果暂不可用；请按左侧提示复核 baseline、板兼容性和 Bio ID。</p>}
            </div> : null}
          </section>

          <aside className="analysis-result-side">
            <div className="panel chart-panel compact-chart-panel"><div className="panel-head compact-panel-head"><div><h3>图表预览</h3><p>{baselineNormalization.status === "ready" ? `派生标准化 · ${baselineNormalization.config.method} · ${baselineNormalization.config.uncertaintyDisplay === "ci95" ? "95% CI" : "SEM"} · baseline ${baselineNormalization.config.scale === "percent" ? "100" : "1"}` : config.relativeToControlEnabled ? "相对同时间点对照的显示变换。" : "Blank-corrected primary result。"}</p></div></div><SummaryChart rows={baselineNormalization.status === "ready" ? normalizedChartRows : displayedBiologicalSummaries} normalized={baselineNormalization.status === "ready" ? false : Boolean(config.relativeToControlEnabled && config.controlGroup)} compact yAxisLabel={baselineNormalization.status === "ready" ? `Normalized ${baselineNormalization.config.scale}` : `Blank-corrected signal${plate.metadata.signalUnit ? ` (${plate.metadata.signalUnit})` : ""}`} /></div>
            <div className="panel table-panel significance-panel"><div className="panel-head compact-panel-head"><div><h3>显著性</h3><p>{selectedSummaryKeys.size ? "按当前点选行重新计算；自动加入同时间点 control 与 blank。" : "全表范围计算；单位是生物学重复，不把技术复孔当作独立 n。"}</p></div></div><div className="method-note"><strong>计算方法</strong><p>先扣除 blank，再合并同一 biological replicate 内的技术复孔。若处理组和对照组共享相同 B 编号，使用配对 t-test；无法配对时使用 Welch t-test。P 值用当前范围内的 Benjamini-Hochberg FDR 校正，星号按 FDR 标注。</p><p>推荐原则：单时间点两组比较用配对/独立 t-test；多处理组优先用 ANOVA + Dunnett 或 FDR；连续多时间点应考虑 two-way ANOVA 或混合效应模型。</p></div><div className="table-scroll compact"><table><thead><tr><th>Contrast</th><th>Method</th><th>n</th><th>Diff</th><th>P</th><th>FDR</th><th>Sig.</th></tr></thead><tbody>{displayedSignificanceComparisons.length ? displayedSignificanceComparisons.map((row) => <tr key={row.key}><td>{row.contrast}</td><td>{significanceMethodLabel(row.note)}</td><td>{row.nGroup}/{row.nControl}</td><td>{Number.isFinite(row.meanDifference) ? format(row.meanDifference) : "未计算"}</td><td>{row.pValue === null ? "n/a" : row.pValue.toPrecision(3)}</td><td>{row.adjustedPValue === null ? "n/a" : row.adjustedPValue.toPrecision(3)}</td><td>{row.label}</td></tr>) : <tr><td colSpan={7} className="empty-cell">{config.controlGroup ? "当前展示范围没有可比较的非对照组。" : "选择对照组后计算显著性。"}</td></tr>}</tbody></table></div></div>
          </aside>
        </div>
      </section> : null}
    </main>
  </div>;
}

function Metric({ label, value, detail = "" }: { label: string; value: string; detail?: string }) {
  return <div className="metric"><span>{label}</span><strong title={value}>{value}</strong>{detail ? <small title={detail}>{detail}</small> : null}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

import { useEffect, useMemo, useRef, useState } from "react";
import { assayModules } from "./core/assay-registry";
import { analyzeCellViability } from "./core/assays/cell-viability";
import {
  analysisPackageJson,
  annotatedWellsCsv,
  assayMeasurementsCsv,
  biologicalSummaryCsv,
  downloadBlob,
  downloadText,
  technicalSummaryCsv,
} from "./core/export";
import { importPlateReadings } from "./core/instruments";
import { createReadingTemplateWorkbook, type ManualReadingMetadata } from "./core/instruments/manual-readings";
import { applyLayoutText, layoutTemplateCsv, plateTemplateDefinitions, type LayoutPatch } from "./core/layout";
import type { AnalysisConfig, AssayModuleId, BiologicalSummary, DetectionMode, ParsedPlate, PlateImportBatch, SignificanceComparison, WellRecord, WellRole } from "./core/types";
import { PlateMap } from "./components/PlateMap";
import { SummaryChart } from "./components/SummaryChart";
import { AssayDataExplorer } from "./components/AssayDataExplorer";

type View = "import" | "layout" | "analysis";
type ImportMode = "instrument" | "paste" | "template";
type SelectionMode = "single" | "toggle" | "range";
type PlateWorkspace = { plate: ParsedPlate; wells: WellRecord[] };
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
const analyzableGroupRoles: WellRole[] = ["sample", "control"];

const defaultAnalysisConfig: AnalysisConfig = {
  controlGroup: "",
  technicalCvThresholdPercent: 15,
  blankCvThresholdPercent: 10,
};

const defaultLayoutTemplateId = "96";

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
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function detectionModeLabel(mode: DetectionMode): string {
  return ({ absorbance: "吸光", fluorescence: "荧光", luminescence: "发光", trf: "时间分辨荧光", alpha: "Alpha" })[mode];
}

function methodEvidenceLabel(plate: ParsedPlate): string {
  return ({ reported: "仪器协议明确记录", "user-reported": "由用户在导入时填写", inferred: "根据通道与当前流程推断，请复核", unknown: "文件未提供" })[plate.metadata.assayMethodEvidence];
}

function measurementChannel(plate: ParsedPlate): string {
  const metadata = plate.metadata;
  if (metadata.detectionMode === "fluorescence") {
    const excitation = metadata.excitationWavelengthNm ? `Ex ${metadata.excitationWavelengthNm} nm` : "Ex —";
    const emission = metadata.emissionWavelengthNm ? `Em ${metadata.emissionWavelengthNm} nm` : "Em —";
    return `${excitation} / ${emission}`;
  }
  if (metadata.wavelengthNm) {
    return metadata.referenceWavelengthNm
      ? `${metadata.wavelengthNm} nm / ref ${metadata.referenceWavelengthNm} nm`
      : `${metadata.wavelengthNm} nm`;
  }
  return metadata.measurementName || "—";
}

function instrumentDisplay(plate: ParsedPlate): string {
  return [plate.metadata.instrumentManufacturer, plate.metadata.instrumentModel].filter(Boolean).join(" · ") || "—";
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
  return items.join(" · ") || "—";
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
  { key: "treatment", header: "Treatment", render: (row) => row.treatment || "—" },
  { key: "concentration", header: "Conc.", render: (row) => row.concentration || "—" },
  { key: "timepoint", header: "Time", render: (row) => row.timepoint || "—" },
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

function downloadName(source: string, suffix: string): string {
  const stem = source.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${stem || "microplate"}-${suffix}`;
}

function summaryIdentity(row: Pick<BiologicalSummary, "group" | "treatment" | "concentration" | "timepoint">): string {
  return [row.group, row.treatment, row.concentration, row.timepoint].join("¦");
}

function comparisonIdentity(row: Pick<SignificanceComparison, "group" | "treatment" | "concentration" | "timepoint">): string {
  return [row.group, row.treatment, row.concentration, row.timepoint].join("¦");
}

function significanceMethodLabel(note: string): string {
  if (note.startsWith("Paired")) return "配对 t-test";
  if (note.startsWith("Welch")) return "Welch t-test";
  return "n/a";
}

function looksLikeControlGroup(group: string): boolean {
  return /(control|vehicle|mock|dmso|nc|negative|untreated|ctrl|对照|陰性|阴性)/i.test(group);
}

function templateIdForPlate(plate: ParsedPlate): string {
  return plateTemplateDefinitions.find((template) => template.rows === plate.rows && template.columns === plate.columns)?.id ?? defaultLayoutTemplateId;
}

export default function App() {
  const instrumentInput = useRef<HTMLInputElement>(null);
  const readingTemplateInput = useRef<HTMLInputElement>(null);
  const layoutInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>("import");
  const [importMode, setImportMode] = useState<ImportMode>("instrument");
  const [selectedModuleId, setSelectedModuleId] = useState<AssayModuleId>("cell-viability");
  const [moduleSelectionTouched, setModuleSelectionTouched] = useState(false);
  const [plateWorkspaces, setPlateWorkspaces] = useState<PlateWorkspace[]>([]);
  const [activePlateIndex, setActivePlateIndex] = useState(0);
  const [pendingBatch, setPendingBatch] = useState<PlateImportBatch | null>(null);
  const [manualText, setManualText] = useState("");
  const [manualDetectionMode, setManualDetectionMode] = useState<DetectionMode>("absorbance");
  const [manualSignalUnit, setManualSignalUnit] = useState("OD");
  const [manualWavelength, setManualWavelength] = useState("450");
  const [readingTemplateId, setReadingTemplateId] = useState(defaultLayoutTemplateId);
  const [readingTemplatePlateCount, setReadingTemplatePlateCount] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [layoutTemplateId, setLayoutTemplateId] = useState(defaultLayoutTemplateId);
  const [batchDraft, setBatchDraft] = useState<BatchDraft>(emptyBatchDraft);
  const [autoNumberTechnical, setAutoNumberTechnical] = useState(true);
  const [selectedSummaryKeys, setSelectedSummaryKeys] = useState<Set<string>>(new Set());
  const [controlGroupTouched, setControlGroupTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [config, setConfig] = useState<AnalysisConfig>(defaultAnalysisConfig);
  const selectedModule = assayModules.find((module) => module.id === selectedModuleId) ?? assayModules[0];
  const activeWorkspace = plateWorkspaces[activePlateIndex];
  const plate = activeWorkspace?.plate ?? null;
  const wells = activeWorkspace?.wells ?? [];

  const groups = useMemo(() => [...new Set(wells.filter((well) => analyzableGroupRoles.includes(well.role)).map((well) => well.group).filter(Boolean))].sort(), [wells]);
  const inferredControlGroup = useMemo(() => {
    const roleControlGroups = [...new Set(wells.filter((well) => well.role === "control").map((well) => well.group).filter(Boolean))].sort();
    if (roleControlGroups.length === 1) return roleControlGroups[0];
    return roleControlGroups.find(looksLikeControlGroup) ?? groups.find(looksLikeControlGroup) ?? "";
  }, [groups, wells]);
  const analysis = useMemo(() => analyzeCellViability(wells, config), [wells, config]);
  const useGenericWorkflow = Boolean(plate?.assayData && (
    plate.assayData.moduleId !== "cell-viability"
    || plate.assayData.standardCurves.length
    || plate.assayData.measurements.some((item) => item.kind === "kinetic" || item.kind === "spectrum")
  ));
  const workflowReady = useGenericWorkflow ? Boolean(plate?.assayData?.measurements.length) : analysis.ready;
  const roleCounts = useMemo(() => Object.fromEntries(wellRoles.map((role) => [role, wells.filter((well) => well.role === role).length])) as Record<WellRole, number>, [wells]);
  const selectedWells = useMemo(() => wells.filter((well) => selected.has(well.well)), [selected, wells]);
  const selectedExcludedCount = useMemo(() => selectedWells.filter((well) => well.excluded).length, [selectedWells]);
  const selectedExclusionState = selectedWells.length && selectedExcludedCount === selectedWells.length ? "excluded" : selectedExcludedCount === 0 ? "included" : "mixed";
  const selectedRoleCounts = useMemo(() => Object.fromEntries(wellRoles.map((role) => [role, selectedWells.filter((well) => well.role === role).length])) as Record<WellRole, number>, [selectedWells]);
  const selectedSingleWell = selectedWells.length === 1 ? selectedWells[0] : null;
  const blankAnnotationMode = selectedWells.length > 0 && selectedWells.every((well) => well.role === "blank");
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
  };
  const summaryKeySignature = useMemo(() => analysis.biologicalSummaries.map((row) => row.key).join("\n"), [analysis.biologicalSummaries]);
  const displayedBiologicalSummaries = useMemo(() => selectedSummaryKeys.size
    ? analysis.biologicalSummaries.filter((row) => selectedSummaryKeys.has(row.key))
    : analysis.biologicalSummaries, [analysis.biologicalSummaries, selectedSummaryKeys]);
  const displayedSummaryIdentities = useMemo(() => new Set(displayedBiologicalSummaries.map(summaryIdentity)), [displayedBiologicalSummaries]);
  const displayedTechnicalSummaries = useMemo(() => selectedSummaryKeys.size
    ? analysis.technicalSummaries.filter((row) => displayedSummaryIdentities.has(summaryIdentity(row)))
    : analysis.technicalSummaries, [analysis.technicalSummaries, displayedSummaryIdentities, selectedSummaryKeys.size]);
  const displayedWellIds = useMemo(() => new Set(displayedTechnicalSummaries.flatMap((row) => row.wells)), [displayedTechnicalSummaries]);
  const displayedAnnotatedWells = useMemo(() => selectedSummaryKeys.size
    ? analysis.annotatedWells.filter((well) => displayedWellIds.has(well.well))
    : analysis.annotatedWells, [analysis.annotatedWells, displayedWellIds, selectedSummaryKeys.size]);
  const significanceScopeWells = useMemo(() => {
    if (!selectedSummaryKeys.size || !config.controlGroup) return wells;
    const selectedIdentities = new Set(displayedBiologicalSummaries.map(summaryIdentity));
    const selectedTimepoints = new Set(displayedBiologicalSummaries.map((row) => row.timepoint));
    return wells.filter((well) => {
      if (well.role === "blank") return true;
      if (!analyzableGroupRoles.includes(well.role)) return false;
      if (selectedIdentities.has(summaryIdentity(well))) return true;
      return well.group === config.controlGroup && selectedTimepoints.has(well.timepoint);
    });
  }, [config.controlGroup, displayedBiologicalSummaries, selectedSummaryKeys.size, wells]);
  const scopedAnalysis = useMemo(() => selectedSummaryKeys.size
    ? analyzeCellViability(significanceScopeWells, config)
    : analysis, [analysis, config, selectedSummaryKeys.size, significanceScopeWells]);
  const displayedSignificanceComparisons = useMemo(() => {
    if (!selectedSummaryKeys.size) return scopedAnalysis.significanceComparisons;
    return scopedAnalysis.significanceComparisons.filter((comparison) => displayedSummaryIdentities.has(comparisonIdentity(comparison)));
  }, [displayedSummaryIdentities, scopedAnalysis.significanceComparisons, selectedSummaryKeys.size]);
  const displayedAnalysis = useMemo(() => ({
    ...analysis,
    annotatedWells: displayedAnnotatedWells,
    technicalSummaries: displayedTechnicalSummaries,
    biologicalSummaries: displayedBiologicalSummaries,
    significanceComparisons: displayedSignificanceComparisons,
  }), [analysis, displayedAnnotatedWells, displayedBiologicalSummaries, displayedSignificanceComparisons, displayedTechnicalSummaries]);
  const exportScope = selectedSummaryKeys.size ? `selected-${displayedBiologicalSummaries.length}rows` : "all";

  useEffect(() => {
    if (!selectedWells.length) return;
    if (selectedExclusionState === "excluded") setBatchDraft((current) => ({ ...current, excluded: "true" }));
    if (selectedExclusionState === "included") setBatchDraft((current) => ({ ...current, excluded: "false" }));
  }, [selectedExclusionState, selectedWells.length]);

  useEffect(() => {
    if (controlGroupTouched || config.controlGroup || !inferredControlGroup) return;
    setConfig((current) => ({ ...current, controlGroup: inferredControlGroup }));
  }, [config.controlGroup, controlGroupTouched, inferredControlGroup]);

  useEffect(() => {
    const validKeys = new Set(summaryKeySignature ? summaryKeySignature.split("\n") : []);
    setSelectedSummaryKeys((current) => {
      const next = new Set([...current].filter((key) => validKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [summaryKeySignature]);

  function resetPlateInteraction(nextPlate: ParsedPlate) {
    setSelected(new Set());
    setSelectedSummaryKeys(new Set());
    setSelectionAnchor(null);
    setLayoutTemplateId(templateIdForPlate(nextPlate));
    setControlGroupTouched(false);
    setConfig((current) => ({ ...current, controlGroup: "" }));
  }

  function loadBatch(batch: PlateImportBatch) {
    const first = batch.plates[0];
    if (!first) return;
    setPlateWorkspaces(batch.plates.map((item) => ({ plate: item, wells: item.wells })));
    setActivePlateIndex(0);
    setPendingBatch(null);
    resetPlateInteraction(first);
    const detectedModuleId = first.metadata.assayModuleId ?? first.assayData?.moduleId ?? "unknown";
    const detectedModule = assayModules.find((module) => module.id === detectedModuleId);
    if (batch.sourceKind === "instrument-file" && !moduleSelectionTouched && detectedModule) {
      setSelectedModuleId(detectedModule.id as AssayModuleId);
    }
    if (batch.sourceKind === "instrument-file" && moduleSelectionTouched && detectedModuleId !== "unknown" && detectedModuleId !== selectedModuleId) {
      setError(`所选模块为“${selectedModule.name}”，但文件识别为“${detectedModule?.name ?? first.metadata.assayMethodLabel}”。结果仍已载入，请复核实验类型或切换模块。`);
    }
    setNotice(`已载入 ${batch.plates.length} 块板，共 ${batch.plates.reduce((sum, item) => sum + item.wells.length, 0)} 个已测孔。请先复核基本信息与数据来源。`);
    setView("import");
  }

  function updateActiveWells(updater: WellRecord[] | ((current: WellRecord[]) => WellRecord[])) {
    setPlateWorkspaces((current) => current.map((workspace, index) => index === activePlateIndex
      ? { ...workspace, wells: typeof updater === "function" ? updater(workspace.wells) : updater }
      : workspace));
  }

  function selectActivePlate(index: number) {
    const next = plateWorkspaces[index];
    if (!next) return;
    setActivePlateIndex(index);
    resetPlateInteraction(next.plate);
    setNotice(`已切换到 ${next.plate.metadata.plateName}；该板的注释和分析状态独立保存。`);
  }

  function renameActivePlate(name: string) {
    setPlateWorkspaces((current) => current.map((workspace, index) => index === activePlateIndex
      ? { ...workspace, plate: { ...workspace.plate, metadata: { ...workspace.plate.metadata, plateName: name, sourceExperiment: name } } }
      : workspace));
  }

  async function importInstrumentFile(file: File) {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      loadBatch(await importPlateReadings({ kind: "instrument-file", file }));
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
      setPendingBatch(result);
      setNotice(`解析完成：识别到 ${result.plates.length} 块板。确认预览无误后再载入工作区。`);
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
      setPendingBatch(result);
      setNotice(`模板解析完成：识别到 ${result.plates.length} 块板。确认预览无误后再载入工作区。`);
    } catch (importError) {
      setPendingBatch(null);
      setError(importError instanceof Error ? importError.message : "读数模板解析失败。");
    } finally {
      setLoading(false);
    }
  }

  function downloadReadingTemplate() {
    const bytes = createReadingTemplateWorkbook(selectedReadingTemplate, readingTemplatePlateCount);
    downloadBlob(
      `microplate-reading-template-${selectedReadingTemplate.id}well-${readingTemplatePlateCount}plate.xlsx`,
      new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    );
  }

  function toggleWell(well: string, mode: SelectionMode) {
    if (mode === "range") {
      const anchor = selectionAnchor && wells.some((record) => record.well === selectionAnchor) ? selectionAnchor : well;
      const rowOrder = [...new Set(wells.map((record) => record.row))];
      const rowIndex = new Map(rowOrder.map((row, index) => [row, index]));
      const anchorWell = wells.find((record) => record.well === anchor);
      const targetWell = wells.find((record) => record.well === well);
      if (!anchorWell || !targetWell) return;
      const startRow = Math.min(rowIndex.get(anchorWell.row) ?? 0, rowIndex.get(targetWell.row) ?? 0);
      const endRow = Math.max(rowIndex.get(anchorWell.row) ?? 0, rowIndex.get(targetWell.row) ?? 0);
      const startColumn = Math.min(anchorWell.column, targetWell.column);
      const endColumn = Math.max(anchorWell.column, targetWell.column);
      setSelected(new Set(wells
        .filter((record) => {
          const currentRow = rowIndex.get(record.row) ?? -1;
          return currentRow >= startRow && currentRow <= endRow && record.column >= startColumn && record.column <= endColumn;
        })
        .map((record) => record.well)));
      if (!selectionAnchor) setSelectionAnchor(well);
      return;
    }
    setSelected((current) => {
      if (mode === "single") {
        const shouldClear = current.size === 1 && current.has(well);
        setSelectionAnchor(shouldClear ? null : well);
        return shouldClear ? new Set() : new Set([well]);
      }
      const next = new Set(current);
      if (next.has(well)) next.delete(well);
      else next.add(well);
      setSelectionAnchor(next.size ? well : null);
      return next;
    });
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
    updateActiveWells((current) => current.map((well) => selected.has(well.well)
      ? { ...well, ...patch, technicalReplicate: autoNumberTechnical && !batchDraft.technicalReplicate ? technicalByWell.get(well.well) ?? well.technicalReplicate : (patch.technicalReplicate ?? well.technicalReplicate) }
      : well));
    setNotice(`已更新 ${selected.size} 个孔；原始读数未改变。`);
  }

  function setSelectedExclusion(excluded: boolean) {
    if (!selected.size) return;
    updateActiveWells((current) => current.map((well) => selected.has(well.well) ? { ...well, excluded } : well));
    setBatchDraft((current) => ({ ...current, excluded: excluded ? "true" : "false" }));
    setNotice(excluded ? `已将 ${selected.size} 个孔标记为排除；原始读数未改变。` : `已将 ${selected.size} 个孔恢复为纳入分析；原始读数未改变。`);
  }

  function toggleSummarySelection(key: string) {
    setSelectedSummaryKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function importLayoutFile(file: File) {
    const result = applyLayoutText(wells, await file.text());
    updateActiveWells(result.wells);
    setControlGroupTouched(false);
    setConfig((current) => ({ ...current, controlGroup: "" }));
    setNotice(`板图已匹配 ${result.applied} 个孔。${result.warnings.length ? `另有 ${result.warnings.length} 条提醒。` : ""}`);
    setError(result.warnings.join(" "));
  }

  function exportFiles(kind: "wells" | "technical" | "biological" | "package") {
    if (!plate) return;
    const name = plate.metadata.sourceFileName;
    if (kind === "wells") downloadText(downloadName(name, `annotated-wells-${exportScope}.csv`), annotatedWellsCsv(displayedAnalysis, plate), "text/csv");
    if (kind === "technical") downloadText(downloadName(name, `technical-summary-${exportScope}.csv`), technicalSummaryCsv(displayedAnalysis, plate), "text/csv");
    if (kind === "biological") downloadText(downloadName(name, `biological-summary-${exportScope}.csv`), biologicalSummaryCsv(displayedAnalysis, plate), "text/csv");
    if (kind === "package") downloadText(downloadName(name, "analysis-package.json"), analysisPackageJson(plate, wells, config, analysis), "application/json");
  }

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" type="button" onClick={() => setView("import")}>
        <span className="brand-mark"><i /><i /><i /><i /></span>
        <span><strong>Microplate Assay Studio</strong><small>酶标实验分析工作台 · v0.2</small></span>
      </button>
      <div className="topbar-actions">
        <span className="privacy-pill"><i />Browser-local</span>
        {plate ? <span className={`status-pill ${workflowReady ? "ready" : "review"}`}>{workflowReady ? "分析就绪" : "需要补充信息"}</span> : null}
      </div>
    </header>

    <main>
      <section className="assay-strip">
        <div>
          <h1>酶标数据入口，选择实验类型进行分析</h1>
        </div>
        <div className="assay-cards">
          {assayModules.map((module) => <button key={module.id} type="button" disabled={module.status !== "ready"} aria-pressed={selectedModuleId === module.id} onClick={() => { setSelectedModuleId(module.id as AssayModuleId); setModuleSelectionTouched(true); setView("import"); setNotice(`已选择“${module.name}”。请导入对应的仪器结果文件。`); setError(""); }} className={`assay-card ${module.status === "ready" ? "ready" : "planned"} ${selectedModuleId === module.id ? "active" : ""}`}>
            <span>{module.shortName}</span>
            <strong>{module.name}</strong>
            <small>{module.measurementTarget}</small>
          </button>)}
        </div>
      </section>

      {plate ? <nav className="workspace-nav" aria-label="工作区视图">
        {(useGenericWorkflow ? (["import", "analysis"] as View[]) : (["import", "layout", "analysis"] as View[])).map((item, index) => <button type="button" key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}><span>{index + 1}</span>{item === "import" ? "数据导入" : item === "layout" ? "板图与注释" : "分析与导出"}</button>)}
      </nav> : null}

      {notice ? <div className="notice success" role="status">{notice}</div> : null}
      {error ? <div className="notice warning" role="alert">{error}<button type="button" onClick={() => setError("")}>×</button></div> : null}

      {view === "import" ? <section className="workspace import-workspace">
        <div className="section-heading">
          <div><p className="eyebrow">01 · PLATE READINGS</p><h2>导入孔板读数</h2><p>当前模块：{selectedModule.name} · {selectedModule.measurementTarget}。可以导入仪器结果，也可以粘贴 Excel 矩阵或填写标准读数模板；全部数据只在浏览器本地处理。</p></div>
          {plate ? <span className="adapter-badge">{plate.metadata.adapterId}</span> : null}
        </div>
        <div className="import-source-tabs" role="tablist" aria-label="孔板读数来源">
          <button type="button" role="tab" aria-selected={importMode === "instrument"} className={importMode === "instrument" ? "active" : ""} onClick={() => { setImportMode("instrument"); setPendingBatch(null); }}>仪器结果文件</button>
          <button type="button" role="tab" aria-selected={importMode === "paste"} className={importMode === "paste" ? "active" : ""} onClick={() => { setImportMode("paste"); setPendingBatch(null); }}>粘贴孔板读数</button>
          <button type="button" role="tab" aria-selected={importMode === "template"} className={importMode === "template" ? "active" : ""} onClick={() => { setImportMode("template"); setPendingBatch(null); }}>读数模板</button>
        </div>

        {importMode === "instrument" ? <>
          <input ref={instrumentInput} hidden type="file" accept=".xml,.xlsx,.xls,.skax" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importInstrumentFile(file); event.target.value = ""; }} />
          <button type="button" className="dropzone" disabled={loading} onClick={() => instrumentInput.current?.click()}>
            <span className="dropzone-icon">DATA</span>
            <span><strong>{loading ? "正在解析…" : plate ? "更换仪器文件" : "选择酶标仪导出文件"}</strong><small>支持 SkanIt XML / XLSX、旧版 XLS；SKAX 会话包请在 SkanIt 中导出 XML 或 XLSX 后分析。</small></span>
            <b>Browse</b>
          </button>
        </> : <div className="manual-import-panel">
          <div className="manual-metadata-grid">
            <Field label="检测模式 *"><select value={manualDetectionMode} onChange={(event) => { const mode = event.target.value as DetectionMode; setManualDetectionMode(mode); setManualSignalUnit(mode === "absorbance" ? "OD" : mode === "fluorescence" ? "RFU" : "RLU"); }}><option value="absorbance">吸光</option><option value="fluorescence">荧光</option><option value="luminescence">发光</option><option value="trf">时间分辨荧光</option><option value="alpha">Alpha</option></select></Field>
            <Field label="信号单位 *"><input value={manualSignalUnit} onChange={(event) => setManualSignalUnit(event.target.value)} placeholder="OD / RFU / RLU" /></Field>
            <Field label="检测波长 (nm)"><input type="number" min="0" value={manualWavelength} disabled={manualDetectionMode !== "absorbance"} onChange={(event) => setManualWavelength(event.target.value)} placeholder="例如 450" /><small className="field-help">由用户填写；系统不会根据数值猜测。</small></Field>
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
          <div className="import-preview-head"><div><h3>导入预览</h3><p>识别到 {pendingBatch.plates.length} 块独立孔板；确认后才会替换当前工作区。</p></div><span>{pendingBatch.sourceKind === "manual-paste" ? "人工粘贴" : "读数模板"}</span></div>
          <div className="preview-plate-list">{pendingBatch.plates.map((item, index) => <div key={`${item.metadata.plateName}-${index}`}><strong>{item.metadata.plateName}</strong><span>{item.rows} × {item.columns}</span><b>{item.wells.length} 个已测孔</b><small>{item.warnings[0] || "矩阵完整"}</small></div>)}</div>
          <div className="manual-import-actions"><button type="button" className="secondary-button" onClick={() => setPendingBatch(null)}>取消</button><button type="button" className="primary-button" onClick={() => loadBatch(pendingBatch)}>确认载入 {pendingBatch.plates.length} 块板</button></div>
        </div> : null}

        {plateWorkspaces.length > 1 ? <div className="plate-switcher"><div><strong>本次导入包含 {plateWorkspaces.length} 块板</strong><small>各板注释与分析相互独立，不会自动合并为生物学重复。</small></div><div className="plate-switcher-buttons">{plateWorkspaces.map((workspace, index) => <button type="button" key={`${workspace.plate.metadata.plateName}-${index}`} className={index === activePlateIndex ? "active" : ""} onClick={() => selectActivePlate(index)}>{index + 1}. {workspace.plate.metadata.plateName}</button>)}</div><label>当前板名称<input value={plate?.metadata.plateName ?? ""} onChange={(event) => renameActivePlate(event.target.value)} /></label></div> : null}
        {plate ? <div className="experiment-overview">
          <div className="experiment-overview-head"><div><h3>本次实验基本信息</h3><p>仪器报告值、用户填写值和推断项会分别标明；人工读数不会伪装成仪器元数据。</p></div><span className={`evidence-badge ${plate.metadata.assayMethodEvidence}`}>{plate.metadata.assayMethodEvidence === "reported" ? "协议已记录" : plate.metadata.assayMethodEvidence === "user-reported" ? "用户已填写" : "需复核"}</span></div>
          <div className="metadata-grid experiment-metadata-grid">
            <Metric label="实验方法" value={plate.metadata.assayMethodLabel} detail={methodEvidenceLabel(plate)} />
            <Metric label="检测模式" value={detectionModeLabel(plate.metadata.detectionMode)} detail={`${plate.metadata.measurementName || "未命名通道"} · ${plate.metadata.signalUnit || "无单位"}`} />
            <Metric label="读数通道" value={measurementChannel(plate)} detail={plate.metadata.detectionMode === "fluorescence" ? "激发 / 发射" : "主波长 / 参比波长"} />
            <Metric label="仪器" value={instrumentDisplay(plate)} detail={plate.metadata.instrumentSerialNumber ? `S/N ${plate.metadata.instrumentSerialNumber}` : "序列号未记录"} />
            <Metric label="运行" value={plate.metadata.runTimestamp || "—"} detail={plate.metadata.assayId ? `Assay ID ${plate.metadata.assayId}` : "Assay ID 未记录"} />
            <Metric label="板型" value={`${plate.rows} × ${plate.columns} · ${plate.rows * plate.columns} 孔`} detail={`${plate.wells.length} 个已测孔 · ${plate.metadata.plateType || "板型未命名"}`} />
            <Metric label="读板设置" value={readSettingDisplay(plate)} detail={plate.metadata.readDirection ? `原文：${plate.metadata.readDirection}` : "文件未记录读板方向"} />
            <Metric label="来源" value={plate.metadata.sourceFileName} detail={plate.metadata.protocolName || plate.metadata.sourceExperiment || "协议名未记录"} />
          </div>
        </div> : null}
        {plate?.warnings.length ? <ul className="compact-findings">{plate.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
        {plate ? <div className="next-step import-next-step"><div><strong>基本信息已解析</strong><p>{useGenericWorkflow ? `已识别 ${plate.assayData?.measurements.length ?? 0} 个测量/计算步骤；可直接核查曲线、公式和结果。` : "请复核实验方法和检测通道；下一步再补充样本、对照、空白与重复信息。"}</p></div><button type="button" className="primary-button" onClick={() => setView(useGenericWorkflow ? "analysis" : "layout")}>{useGenericWorkflow ? "进入分析与导出" : "进入板图与注释"}</button></div> : null}
      </section> : null}

      {view === "layout" && plate ? <section className="workspace">
        <div className="section-heading split">
          <div><p className="eyebrow">02 · PLATE IDENTITY</p><h2>板图与实验注释</h2><p>仪器标签不是实验分组。请通过批量选择或板图文件补充 group 与 biological replicate；系统不会根据原始读数高低猜测分组。</p></div>
          <div className="inline-actions">
            <input ref={layoutInput} hidden type="file" accept=".csv,.tsv,.txt" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importLayoutFile(file); event.target.value = ""; }} />
            <select className="template-select" value={layoutTemplateId} onChange={(event) => setLayoutTemplateId(event.target.value)} aria-label="板图模板类型">
              {plateTemplateDefinitions.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
            </select>
            <button className="secondary-button" type="button" onClick={() => downloadText(`microplate-layout-template-${selectedTemplate.id}well.csv`, layoutTemplateCsv(selectedTemplate), "text/csv")}>下载板图模板</button>
            <button className="secondary-button" type="button" onClick={() => layoutInput.current?.click()}>导入板图</button>
          </div>
        </div>
        <div className="layout-grid">
          <div className="panel plate-panel">
            <div className="panel-head"><div><h3>{plate.rows * plate.columns}孔板 · {plate.wells.length}个已测孔</h3><p>普通点击单选；Shift 点头尾选择矩形区域；Ctrl / Command 逐个增减。</p></div><span>{selected.size} selected</span></div>
            <PlateMap wells={wells} selected={selected} onToggle={toggleWell} plateRows={plate.rows} plateColumns={plate.columns} signalLabel={rawSignalLabel(plate)} />
            <div className="plate-legend"><span className="unassigned">未指定 {roleCounts.unassigned}</span><span className="sample">样本 {roleCounts.sample}</span><span className="control">对照 {roleCounts.control}</span><span className="standard">标准品 {roleCounts.standard}</span><span className="qc">质控 {roleCounts.qc}</span><span className="blank">空白 {roleCounts.blank}</span><span>颜色深浅表示原始读数，不表示分组。</span></div>
          </div>
          <aside className="panel annotation-panel">
            <div className="panel-head"><div><h3>批量注释</h3><p>{selected.size ? `将更新 ${selected.size} 个孔；留空字段保持原值。` : "先在板图中选择一个或多个孔。"}</p></div></div>
            <div className="well-detail">
              {selectedSingleWell ? <>
                <div className="well-detail-title"><strong>{selectedSingleWell.well}</strong><span>{selectedSingleWell.excluded ? "排除分析" : "纳入分析"}</span></div>
                {selectedSingleWell.role === "blank" ? <dl>
                  <div><dt>角色</dt><dd>空白孔</dd></div>
                  <div><dt>{rawSignalLabel(plate)}</dt><dd>{formatRawSignal(plate, selectedSingleWell.rawValue)}</dd></div>
                  <div><dt>用途</dt><dd>背景扣除</dd></div>
                  <div><dt>Blank mean</dt><dd>{analysis.blankMean === null ? "未计算" : analysis.blankMean.toFixed(4)}</dd></div>
                  <div><dt>纳入背景</dt><dd>{selectedSingleWell.excluded ? "否" : "是"}</dd></div>
                  <div><dt>仪器标签</dt><dd>{selectedSingleWell.instrumentLabel || "无"}</dd></div>
                  {selectedSingleWell.notes ? <div className="wide"><dt>备注</dt><dd>{selectedSingleWell.notes}</dd></div> : null}
                </dl> : <dl>
                  <div><dt>角色</dt><dd>{roleLabel(selectedSingleWell.role)}</dd></div>
                  <div><dt>{rawSignalLabel(plate)}</dt><dd>{formatRawSignal(plate, selectedSingleWell.rawValue)}</dd></div>
                  <div><dt>分组</dt><dd>{selectedSingleWell.group || "未填写"}</dd></div>
                  <div><dt>样本ID</dt><dd>{selectedSingleWell.sampleId || "未填写"}</dd></div>
                  <div><dt>处理</dt><dd>{selectedSingleWell.treatment || "未填写"}</dd></div>
                  <div><dt>浓度</dt><dd>{selectedSingleWell.concentration || "未填写"}</dd></div>
                  <div><dt>时间点</dt><dd>{selectedSingleWell.timepoint || "未填写"}</dd></div>
                  <div><dt>生物学重复</dt><dd>{selectedSingleWell.biologicalReplicate || "未填写"}</dd></div>
                  <div><dt>技术重复</dt><dd>{selectedSingleWell.technicalReplicate || "未填写"}</dd></div>
                  <div><dt>仪器标签</dt><dd>{selectedSingleWell.instrumentLabel || "无"}</dd></div>
                  {selectedSingleWell.notes ? <div className="wide"><dt>备注</dt><dd>{selectedSingleWell.notes}</dd></div> : null}
                </dl>}
              </> : selectedWells.length ? <>
                <div className="well-detail-title"><strong>{selectedWells.length} 个孔</strong><span>{selectedExcludedCount ? `${selectedExcludedCount} 个已排除` : "全部纳入"}</span></div>
                <dl>
                  <div><dt>未指定</dt><dd>{selectedRoleCounts.unassigned}</dd></div>
                  <div><dt>样本</dt><dd>{selectedRoleCounts.sample}</dd></div>
                  <div><dt>对照</dt><dd>{selectedRoleCounts.control}</dd></div>
                  <div><dt>质控</dt><dd>{selectedRoleCounts.qc}</dd></div>
                  <div><dt>标准品</dt><dd>{selectedRoleCounts.standard}</dd></div>
                  <div><dt>空白</dt><dd>{selectedRoleCounts.blank}</dd></div>
                </dl>
              </> : <p>点击孔位后，这里会显示当前孔的注释和读数。</p>}
            </div>
            <div className="quick-selects">
              <button type="button" onClick={() => setSelected(new Set(wells.filter((well) => well.role === "unassigned").map((well) => well.well)))}>选择未指定孔</button>
              <button type="button" onClick={() => setSelected(new Set(wells.filter((well) => well.role === "sample" && !well.group).map((well) => well.well)))}>选择未分组样本</button>
              <button type="button" onClick={() => setSelected(new Set(wells.filter((well) => well.role === "blank").map((well) => well.well)))}>选择空白孔</button>
              <button type="button" onClick={() => setSelected(new Set(wells.filter((well) => well.excluded).map((well) => well.well)))}>选择已排除孔</button>
              <button type="button" disabled={!selectedExcludedCount} onClick={() => setSelectedExclusion(false)}>取消所选排除</button>
              <button type="button" onClick={() => { setSelected(new Set()); setSelectionAnchor(null); }}>清除选择</button>
            </div>
            <div className={blankAnnotationMode ? "form-grid blank-form-grid" : "form-grid"}>
              <Field label="孔角色"><select value={batchDraft.role} onChange={(event) => setBatchDraft({ ...batchDraft, role: event.target.value as BatchDraft["role"] })}><option value="">保持原值</option><option value="unassigned">未指定</option><option value="sample">样本</option><option value="control">对照</option><option value="standard">标准品</option><option value="qc">质控</option><option value="blank">空白</option></select></Field>
              {!blankAnnotationMode ? <>
                <Field label="分组 · Group *"><input value={batchDraft.group} onChange={(event) => setBatchDraft({ ...batchDraft, group: event.target.value })} placeholder="NC / siGENE" /></Field>
                <Field label="样本ID"><input value={batchDraft.sampleId} onChange={(event) => setBatchDraft({ ...batchDraft, sampleId: event.target.value })} placeholder="A549_NC_B1" /></Field>
                <Field label="处理"><input value={batchDraft.treatment} onChange={(event) => setBatchDraft({ ...batchDraft, treatment: event.target.value })} placeholder="siRNA / Drug" /></Field>
                <Field label="浓度"><input value={batchDraft.concentration} onChange={(event) => setBatchDraft({ ...batchDraft, concentration: event.target.value })} placeholder="10 nM" /></Field>
                <Field label="时间点"><input value={batchDraft.timepoint} onChange={(event) => setBatchDraft({ ...batchDraft, timepoint: event.target.value })} placeholder="Day0 / 24 h" /></Field>
                <Field label="生物学重复 *"><input value={batchDraft.biologicalReplicate} onChange={(event) => setBatchDraft({ ...batchDraft, biologicalReplicate: event.target.value })} placeholder="Bio1" /><small className="field-help">填独立实验/独立铺板编号，如 Bio1、Bio2；同一生物学重复内的多个孔属于技术复孔。</small></Field>
                <Field label="技术重复"><input value={batchDraft.technicalReplicate} onChange={(event) => setBatchDraft({ ...batchDraft, technicalReplicate: event.target.value })} placeholder="通常留空" /><small className="field-help">通常留空；勾选自动编号后，所选孔会按顺序填为 T1、T2、T3...</small></Field>
              </> : null}
              <Field label="排除状态"><select value={batchDraft.excluded} onChange={(event) => setBatchDraft({ ...batchDraft, excluded: event.target.value as BatchDraft["excluded"] })}><option value="false">纳入分析</option><option value="true">排除分析</option></select>{selectedExclusionState === "mixed" ? <small className="field-help">所选孔状态不一致；应用后会统一为当前选择。</small> : null}</Field>
              <Field label="备注"><input value={batchDraft.notes} onChange={(event) => setBatchDraft({ ...batchDraft, notes: event.target.value })} /></Field>
            </div>
            {blankAnnotationMode ? <p className="blank-form-note">空白孔只参与背景扣除；通常只需要确认孔角色、纳入/排除状态和备注。</p> : <label className="check-row"><input type="checkbox" checked={autoNumberTechnical} onChange={(event) => setAutoNumberTechnical(event.target.checked)} />按当前选择顺序自动编号技术重复 T1…Tn</label>}
            <button type="button" className="primary-button full" disabled={!selected.size} onClick={applyBatch}>应用到所选孔</button>
            {selectedWells.length ? <div className="selected-preview"><strong>所选孔{selectedExcludedCount ? ` · ${selectedExcludedCount} 个已排除` : ""}</strong><p>{selectedWells.map((well) => well.well).join(", ")}</p></div> : null}
          </aside>
        </div>
        <div className="next-step"><div><strong>{analysis.findings.some((finding) => finding.code === "LAYOUT_INCOMPLETE" || finding.code === "ROLE_UNASSIGNED") ? "板图尚未完成" : "板图具备基础分析条件"}</strong><p>只有孔角色、分组和生物学重复齐全后，结果才会进入正式汇总。</p></div><button type="button" className="primary-button" onClick={() => setView("analysis")}>进入分析</button></div>
      </section> : null}

      {view === "analysis" && plate && useGenericWorkflow && plate.assayData ? <section className="workspace analysis-workspace">
        <div className="section-heading split compact-heading">
          <div><p className="eyebrow">02 · RESULT EXPLORER</p><h2>分析与导出</h2><p>按 SkanIt 测量和计算步骤浏览终点、动力学、光谱、标准曲线与多通道归一化结果。</p></div>
          <span className="readiness ready">Parsed from SkanIt</span>
        </div>
        <AssayDataExplorer dataset={plate.assayData} onExport={() => downloadText(downloadName(plate.metadata.sourceFileName, "all-measurements.csv"), assayMeasurementsCsv(plate), "text/csv")} />
      </section> : null}

      {view === "analysis" && plate && !useGenericWorkflow ? <section className="workspace analysis-workspace">
        <div className="section-heading split compact-heading">
          <div><p className="eyebrow">03 · QC & ANALYSIS</p><h2>分析与导出</h2><p>先合并技术复孔，再以生物学重复为统计单位；点选汇总表行后，下方图表、显著性和导出 CSV 都只保留当前展示范围。</p></div>
          <span className={`readiness ${analysis.ready ? "ready" : "review"}`}>{analysis.ready ? "Ready for export" : "Review required"}</span>
        </div>
        <div className="analysis-layout-compact">
          <aside className="panel analysis-side-panel">
            <div className="panel-head compact-panel-head"><div><h3>分析设置</h3><p>对照组和 QC 阈值只影响归一化、显著性和复核提示。</p></div></div>
            <div className="side-control-grid">
              <Field label="对照组"><select value={config.controlGroup} onChange={(event) => { setControlGroupTouched(true); setConfig({ ...config, controlGroup: event.target.value }); }}><option value="">不做相对对照归一化</option>{groups.map((group) => <option key={group} value={group}>{group}</option>)}</select><small className="field-help">{config.controlGroup ? `当前将各 group 与 ${config.controlGroup} 比较。${!controlGroupTouched && inferredControlGroup === config.controlGroup ? "系统已根据 role=control 自动识别。" : ""}` : inferredControlGroup ? `检测到可能的对照组 ${inferredControlGroup}；可手动选择启用比较。` : "选择对照组后，自动生成 group vs control 的显著性比较。"}</small></Field>
              <Field label="技术复孔 CV 阈值 (%)"><input type="number" min="0" step="1" value={config.technicalCvThresholdPercent} onChange={(event) => setConfig({ ...config, technicalCvThresholdPercent: Number(event.target.value) })} /></Field>
              <Field label="空白孔 CV 阈值 (%)"><input type="number" min="0" step="1" value={config.blankCvThresholdPercent} onChange={(event) => setConfig({ ...config, blankCvThresholdPercent: Number(event.target.value) })} /></Field>
            </div>
            <div className="qc-compact-block">
              <div className="side-section-title"><strong>质量控制</strong><span>{analysis.findings.length} 条</span></div>
              {analysis.findings.length ? <ul className="qc-mini-list">{analysis.findings.map((finding, index) => <li key={`${finding.code}-${index}`} className={finding.severity} onClick={() => finding.wells.length && setSelected(new Set(finding.wells))}><span>{finding.severity}</span><div><strong>{finding.code}</strong><p>{finding.message}</p>{finding.wells.length ? <small>{finding.wells.slice(0, 8).join(", ")}{finding.wells.length > 8 ? "…" : ""}</small> : null}</div></li>)}</ul> : <div className="empty-state compact">没有发现需要复核的问题。</div>}
            </div>
          </aside>

          <section className="panel table-panel summary-panel">
            <div className="panel-head summary-panel-head">
              <div><h3>生物学汇总表</h3><p>{selectedSummaryKeys.size ? `当前展示 ${displayedBiologicalSummaries.length} 行；显著性按当前点选范围重新计算。` : "点击行后，下方图表、显著性和导出内容只显示所选行。"}</p></div>
              <div className="summary-head-actions">
                {selectedSummaryKeys.size ? <button type="button" className="secondary-button mini" onClick={() => setSelectedSummaryKeys(new Set())}>显示全部</button> : null}
                <button type="button" className="secondary-button mini" disabled={!displayedAnnotatedWells.length} onClick={() => exportFiles("wells")}>孔级 CSV</button>
                <button type="button" className="secondary-button mini" disabled={!displayedTechnicalSummaries.length} onClick={() => exportFiles("technical")}>技术复孔 CSV</button>
                <button type="button" className="secondary-button mini" disabled={!displayedBiologicalSummaries.length} onClick={() => exportFiles("biological")}>汇总 CSV</button>
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
          </section>

          <aside className="analysis-result-side">
            <div className="panel chart-panel compact-chart-panel"><div className="panel-head compact-panel-head"><div><h3>图表预览</h3><p>辅助查看趋势；正式结果以左侧汇总表和统计表为准。</p></div></div><SummaryChart rows={displayedBiologicalSummaries} normalized={Boolean(config.controlGroup)} compact yAxisLabel={`Blank-corrected signal${plate.metadata.signalUnit ? ` (${plate.metadata.signalUnit})` : ""}`} /></div>
            <div className="panel table-panel significance-panel"><div className="panel-head compact-panel-head"><div><h3>显著性</h3><p>{selectedSummaryKeys.size ? "按当前点选行重新计算；自动加入同时间点 control 与 blank。" : "全表范围计算；单位是生物学重复，不把技术复孔当作独立 n。"}</p></div></div><div className="method-note"><strong>计算方法</strong><p>先扣除 blank，再合并同一 biological replicate 内的技术复孔。若处理组和对照组共享相同 B 编号，使用配对 t-test；无法配对时使用 Welch t-test。P 值用当前范围内的 Benjamini-Hochberg FDR 校正，星号按 FDR 标注。</p><p>推荐原则：单时间点两组比较用配对/独立 t-test；多处理组优先用 ANOVA + Dunnett 或 FDR；连续多时间点应考虑 two-way ANOVA 或混合效应模型。</p></div><div className="table-scroll compact"><table><thead><tr><th>Contrast</th><th>Method</th><th>n</th><th>Diff</th><th>P</th><th>FDR</th><th>Sig.</th></tr></thead><tbody>{displayedSignificanceComparisons.length ? displayedSignificanceComparisons.map((row) => <tr key={row.key}><td>{row.contrast}</td><td>{significanceMethodLabel(row.note)}</td><td>{row.nGroup}/{row.nControl}</td><td>{Number.isFinite(row.meanDifference) ? format(row.meanDifference) : "—"}</td><td>{row.pValue === null ? "n/a" : row.pValue.toPrecision(3)}</td><td>{row.adjustedPValue === null ? "n/a" : row.adjustedPValue.toPrecision(3)}</td><td>{row.label}</td></tr>) : <tr><td colSpan={7} className="empty-cell">{config.controlGroup ? "当前展示范围没有可比较的非对照组。" : "选择对照组后计算显著性。"}</td></tr>}</tbody></table></div></div>
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

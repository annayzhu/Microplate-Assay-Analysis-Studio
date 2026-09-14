import { analyzeCellViability } from "./assays/cell-viability";
import { executableAssayModule, type AssayExecution } from "./assays/registry";
import { analyzeBaselineNormalization, defaultBaselineNormalizationConfig } from "./baseline-normalization";
import { assignmentDecision, detectedAssayModule, getAssayWorkflow } from "./assay-workflows";
import {
  assignDocumentAssay,
  createPlateDocument,
  documentWells,
  projectPlate,
  renamePlateDocument,
  replaceDocumentAnnotations,
  reviewDocumentAssayMethod,
  updateDocumentAnnotations,
  type PlateDocument,
  type WellAnnotation,
} from "./plate-aggregate";
import type {
  AnalysisConfig,
  AssayModuleId,
  BaselineNormalizationResult,
  BiologicalSummary,
  CellViabilityAnalysisResult,
  ExperimentRecord,
  ParsedPlate,
  PlateImportBatch,
  SignificanceComparison,
  WellRecord,
  WellRole,
} from "./types";

export const defaultAnalysisConfig: AnalysisConfig = {
  controlGroup: "",
  relativeToControlEnabled: false,
  technicalCvThresholdPercent: 15,
  blankCvThresholdPercent: 10,
  baselineNormalization: defaultBaselineNormalizationConfig,
};

export type WorkspaceImportPlan = {
  readonly batch: PlateImportBatch;
  readonly moduleIds: readonly AssayModuleId[];
  readonly includedPlateIndexes: ReadonlySet<number>;
};

export type WorkspaceImportOptions = {
  includedPlateIndexes?: ReadonlySet<number>;
  moduleIds?: readonly AssayModuleId[];
  moduleSelectionTouched?: boolean;
};

/** Persistent scientific state. This is the only state saved to a project file. */
export type PlateProjectDocument = {
  readonly plates: readonly PlateDocument[];
  readonly analysisConfig: AnalysisConfig;
  readonly controlGroupTouched: boolean;
  readonly experiment: ExperimentRecord;
  readonly revision: number;
};

/** Transient interaction state. It can be discarded without changing scientific results. */
export type PlateWorkspaceSession = {
  readonly activePlateIndex: number;
  readonly selectedWellIds: ReadonlySet<string>;
  readonly selectionAnchor: string | null;
  readonly selectedSummaryKeys: ReadonlySet<string>;
};

export type PlateWorkspace = {
  readonly project: PlateProjectDocument;
  readonly session: PlateWorkspaceSession;
};

export type PlateWorkspaceAction =
  | { type: "select-plate"; index: number }
  | { type: "rename-active-plate"; name: string }
  | { type: "assign-active-assay"; moduleId: AssayModuleId }
  | { type: "review-active-assay-method"; label: string }
  | { type: "select-wells"; wellIds: ReadonlySet<string>; anchor: string | null }
  | { type: "replace-active-wells"; wells: WellRecord[] }
  | { type: "update-selected-annotations"; update: (annotation: WellAnnotation, well: WellRecord, index: number) => WellAnnotation }
  | { type: "set-analysis-config"; config: AnalysisConfig; touched?: boolean }
  | { type: "set-experiment"; experiment: ExperimentRecord }
  | { type: "toggle-summary"; key: string }
  | { type: "clear-summary-selection" };

export type PlateWorkspaceView = {
  activePlate: ParsedPlate;
  wells: WellRecord[];
  activeModuleId: AssayModuleId;
  activeModule: ReturnType<typeof getAssayWorkflow>;
  assayExecution: AssayExecution;
  analysisConfig: AnalysisConfig;
  groups: string[];
  inferredControlGroup: string;
  analysis: CellViabilityAnalysisResult;
  baselineNormalization: BaselineNormalizationResult;
  useGenericWorkflow: boolean;
  workflowReady: boolean;
  selectedWells: WellRecord[];
  displayedAnalysis: CellViabilityAnalysisResult;
  displayedBiologicalSummaries: BiologicalSummary[];
  displayedSignificanceComparisons: SignificanceComparison[];
  exportScope: string;
};

type ProjectAnalysisCache = {
  plates: ParsedPlate[];
  executions: Map<string, AssayExecution>;
  baseline: Map<string, BaselineNormalizationResult>;
  scopedAnalyses: Map<string, CellViabilityAnalysisResult>;
};

const analysisCache = new WeakMap<PlateProjectDocument, ProjectAnalysisCache>();
const analyzableGroupRoles: WellRole[] = ["sample", "control"];

function projectCache(project: PlateProjectDocument): ProjectAnalysisCache {
  const existing = analysisCache.get(project);
  if (existing) return existing;
  const created = { plates: project.plates.map(projectPlate), executions: new Map(), baseline: new Map(), scopedAnalyses: new Map() };
  analysisCache.set(project, created);
  return created;
}

function configKey(config: AnalysisConfig): string {
  return JSON.stringify(config);
}

function stablePlateId(plate: ParsedPlate, importIndex: number): string {
  if (plate.plateId) return plate.plateId;
  const source = [plate.metadata.sourceFileName, plate.metadata.sheetName, plate.metadata.adapterId, importIndex].join("¦");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `plate-${importIndex + 1}-${(hash >>> 0).toString(36)}`;
}

function collisionSafePlateId(plate: ParsedPlate, importIndex: number, usedIds: Set<string>): string {
  const baseId = stablePlateId(plate, importIndex);
  let candidate = baseId;
  let suffix = 2;
  while (usedIds.has(candidate)) candidate = `${baseId}-${suffix++}`;
  usedIds.add(candidate);
  return candidate;
}

function looksLikeControlGroup(group: string): boolean {
  return /(control|vehicle|mock|dmso|nc|negative|untreated|ctrl|对照|陰性|阴性)/i.test(group);
}

function summaryIdentity(row: Pick<BiologicalSummary, "group" | "treatment" | "concentration" | "timepoint">): string {
  return [row.group, row.treatment, row.concentration, row.timepoint].join("¦");
}

function comparisonIdentity(row: Pick<SignificanceComparison, "group" | "treatment" | "concentration" | "timepoint">): string {
  return [row.group, row.treatment, row.concentration, row.timepoint].join("¦");
}

function inferControlGroup(wells: readonly WellRecord[], groups: readonly string[]): string {
  const roleControlGroups = [...new Set(wells.filter((well) => well.role === "control").map((well) => well.group).filter(Boolean))].sort();
  if (roleControlGroups.length === 1) return roleControlGroups[0];
  return roleControlGroups.find(looksLikeControlGroup) ?? groups.find(looksLikeControlGroup) ?? "";
}

function effectiveConfig(project: PlateProjectDocument, inferredControlGroup: string): AnalysisConfig {
  if (project.controlGroupTouched) return project.analysisConfig;
  return { ...project.analysisConfig, controlGroup: inferredControlGroup };
}

function emptySession(activePlateIndex = 0): PlateWorkspaceSession {
  return { activePlateIndex, selectedWellIds: new Set(), selectionAnchor: null, selectedSummaryKeys: new Set() };
}

function updateProject(workspace: PlateWorkspace, patch: Omit<Partial<PlateProjectDocument>, "revision">): PlateWorkspace {
  return { ...workspace, project: { ...workspace.project, ...patch, revision: workspace.project.revision + 1 } };
}

export function planWorkspaceImport(batch: PlateImportBatch, selectedModuleId: AssayModuleId, moduleSelectionTouched: boolean): WorkspaceImportPlan {
  const moduleIds = batch.plates.map((plate) => {
    const detected = detectedAssayModule(plate);
    if (batch.sourceKind === "project-file") return plate.metadata.confirmedAssayModuleId ?? batch.restoredActiveModuleId ?? detected;
    if (batch.sourceKind !== "instrument-file") return selectedModuleId;
    return moduleSelectionTouched ? selectedModuleId : detected !== "unknown" ? detected : selectedModuleId;
  });
  return { batch, moduleIds, includedPlateIndexes: new Set(batch.plates.map((_, index) => index)) };
}

function materializeImportedPlates(plan: WorkspaceImportPlan, options: WorkspaceImportOptions | undefined, usedIds: Set<string>): PlateDocument[] {
  const includedIndexes = options?.includedPlateIndexes ?? plan.includedPlateIndexes;
  const moduleIds = options?.moduleIds ?? plan.moduleIds;
  const included = plan.batch.plates.map((plate, index) => ({ plate, index })).filter(({ index }) => includedIndexes.has(index));
  if (!included.length) throw new Error("至少选择一块板后才能载入。");
  return included.map(({ plate, index }) => {
    const detected = detectedAssayModule(plate);
    const confirmed = moduleIds[index] ?? "unknown";
    return createPlateDocument({
      ...plate,
      plateId: collisionSafePlateId(plate, index, usedIds),
      metadata: {
        ...plate.metadata,
        detectedAssayModuleId: detected,
        selectedAssayModuleId: confirmed,
        confirmedAssayModuleId: confirmed,
        assayAssignmentDecision: plan.batch.sourceKind === "project-file"
          ? "project-restored"
          : assignmentDecision(plan.batch.sourceKind, confirmed, detected, options?.moduleSelectionTouched ?? false),
      },
    });
  });
}

export function openPlateWorkspace(plan: WorkspaceImportPlan, options?: WorkspaceImportOptions): PlateWorkspace {
  const plates = materializeImportedPlates(plan, options, new Set());
  return {
    project: {
      plates,
      analysisConfig: plan.batch.restoredAnalysisConfig ? {
        ...defaultAnalysisConfig,
        ...plan.batch.restoredAnalysisConfig,
        baselineNormalization: { ...defaultBaselineNormalizationConfig, ...plan.batch.restoredAnalysisConfig.baselineNormalization },
      } : { ...defaultAnalysisConfig, baselineNormalization: { ...defaultBaselineNormalizationConfig } },
      controlGroupTouched: Boolean(plan.batch.restoredAnalysisConfig?.controlGroup),
      experiment: plan.batch.experiment ?? { name: "", operator: "", date: "", notes: "" },
      revision: 1,
    },
    session: emptySession(),
  };
}

export function appendPlateWorkspace(workspace: PlateWorkspace, plan: WorkspaceImportPlan, options?: WorkspaceImportOptions): PlateWorkspace {
  const usedIds = new Set(workspace.project.plates.map((plate) => plate.plateId).filter((id): id is string => Boolean(id)));
  const appended = materializeImportedPlates(plan, options, usedIds);
  const updated = updateProject(workspace, { plates: [...workspace.project.plates, ...appended] });
  return { ...updated, session: emptySession(workspace.project.plates.length) };
}

export function transitionPlateWorkspace(workspace: PlateWorkspace, action: PlateWorkspaceAction): PlateWorkspace {
  const activeIndex = workspace.session.activePlateIndex;
  if (action.type === "select-plate") {
    return workspace.project.plates[action.index] ? { ...workspace, session: emptySession(action.index) } : workspace;
  }
  if (action.type === "select-wells") {
    const validIds = new Set(workspace.project.plates[activeIndex]?.rawWells.map((well) => well.well) ?? []);
    return {
      ...workspace,
      session: {
        ...workspace.session,
        selectedWellIds: new Set([...action.wellIds].filter((id) => validIds.has(id))),
        selectionAnchor: action.anchor && validIds.has(action.anchor) ? action.anchor : null,
      },
    };
  }
  if (action.type === "toggle-summary") {
    const selected = new Set(workspace.session.selectedSummaryKeys);
    if (selected.has(action.key)) selected.delete(action.key); else selected.add(action.key);
    return { ...workspace, session: { ...workspace.session, selectedSummaryKeys: selected } };
  }
  if (action.type === "clear-summary-selection") {
    return { ...workspace, session: { ...workspace.session, selectedSummaryKeys: new Set() } };
  }
  if (action.type === "rename-active-plate") {
    return updateProject(workspace, { plates: workspace.project.plates.map((plate, index) => index === activeIndex ? renamePlateDocument(plate, action.name) : plate) });
  }
  if (action.type === "assign-active-assay") {
    const updated = updateProject(workspace, { plates: workspace.project.plates.map((plate, index) => index === activeIndex ? assignDocumentAssay(plate, action.moduleId) : plate) });
    return { ...updated, session: { ...updated.session, selectedSummaryKeys: new Set() } };
  }
  if (action.type === "review-active-assay-method") {
    return updateProject(workspace, { plates: workspace.project.plates.map((plate, index) => index === activeIndex ? reviewDocumentAssayMethod(plate, action.label) : plate) });
  }
  if (action.type === "replace-active-wells") {
    const updated = updateProject(workspace, {
      plates: workspace.project.plates.map((plate, index) => index === activeIndex ? replaceDocumentAnnotations(plate, action.wells) : plate),
      controlGroupTouched: false,
      analysisConfig: { ...workspace.project.analysisConfig, controlGroup: "", relativeToControlEnabled: false },
    });
    return { ...updated, session: { ...updated.session, selectedSummaryKeys: new Set() } };
  }
  if (action.type === "update-selected-annotations") {
    return updateProject(workspace, {
      plates: workspace.project.plates.map((plate, index) => index === activeIndex
        ? updateDocumentAnnotations(plate, workspace.session.selectedWellIds, action.update)
        : plate),
    });
  }
  if (action.type === "set-analysis-config") {
    return updateProject(workspace, { analysisConfig: { ...action.config }, controlGroupTouched: action.touched ?? workspace.project.controlGroupTouched });
  }
  if (action.type === "set-experiment") return updateProject(workspace, { experiment: { ...action.experiment } });
  return workspace;
}

function cachedExecution(project: PlateProjectDocument, plateIndex: number, plate: ParsedPlate, wells: WellRecord[], config: AnalysisConfig): AssayExecution {
  const cache = projectCache(project);
  const moduleId = plate.metadata.confirmedAssayModuleId ?? detectedAssayModule(plate);
  const key = `${plateIndex}:${moduleId}:${configKey(config)}`;
  const existing = cache.executions.get(key);
  if (existing) return existing;
  const result = executableAssayModule(moduleId).execute(plate, wells, config);
  cache.executions.set(key, result);
  return result;
}

function emptyAnalysis(): CellViabilityAnalysisResult {
  return { ready: false, blankMean: null, blankSd: null, blankCvPercent: null, annotatedWells: [], technicalSummaries: [], biologicalSummaries: [], significanceComparisons: [], findings: [] };
}

function cachedBaseline(project: PlateProjectDocument, config: AnalysisConfig): BaselineNormalizationResult {
  const cache = projectCache(project);
  const key = configKey(config);
  const existing = cache.baseline.get(key);
  if (existing) return existing;
  const result = analyzeBaselineNormalization(cache.plates, config);
  cache.baseline.set(key, result);
  return result;
}

export function readPlateWorkspace(workspace: PlateWorkspace): PlateWorkspaceView {
  const { project, session } = workspace;
  const document = project.plates[session.activePlateIndex];
  if (!document) throw new Error("Plate workspace 中没有可读取的活动板。");
  const cache = projectCache(project);
  const activePlate = cache.plates[session.activePlateIndex];
  const wells = documentWells(document);
  const activeModuleId = activePlate.metadata.confirmedAssayModuleId ?? detectedAssayModule(activePlate);
  const activeModule = executableAssayModule(activeModuleId).definition;
  const groups = [...new Set(wells.filter((well) => analyzableGroupRoles.includes(well.role)).map((well) => well.group).filter(Boolean))].sort();
  const inferredControlGroup = inferControlGroup(wells, groups);
  const analysisConfig = effectiveConfig(project, inferredControlGroup);
  const assayExecution = cachedExecution(project, session.activePlateIndex, activePlate, wells, analysisConfig);
  const analysis = assayExecution.kind === "cell-viability" ? assayExecution.result : emptyAnalysis();
  const baselineNormalization = assayExecution.kind === "cell-viability"
    ? cachedBaseline(project, analysisConfig)
    : { status: "disabled" as const, config: analysisConfig.baselineNormalization ?? defaultBaselineNormalizationConfig, normalizationReadyRows: [], normalizedRows: [], findings: [] };
  const useGenericWorkflow = assayExecution.kind === "measurement-preview";
  const workflowReady = assayExecution.ready;
  const selectedWells = wells.filter((well) => session.selectedWellIds.has(well.well));
  const displayedBiologicalSummaries = session.selectedSummaryKeys.size
    ? analysis.biologicalSummaries.filter((row) => session.selectedSummaryKeys.has(row.key))
    : analysis.biologicalSummaries;
  const identities = new Set(displayedBiologicalSummaries.map(summaryIdentity));
  const displayedTechnicalSummaries = session.selectedSummaryKeys.size
    ? analysis.technicalSummaries.filter((row) => identities.has(summaryIdentity(row)))
    : analysis.technicalSummaries;
  const displayedWellIds = new Set(displayedTechnicalSummaries.flatMap((row) => row.wells));
  const displayedAnnotatedWells = session.selectedSummaryKeys.size
    ? analysis.annotatedWells.filter((well) => displayedWellIds.has(well.well))
    : analysis.annotatedWells;
  const significanceScopeWells = !session.selectedSummaryKeys.size || !analysisConfig.controlGroup
    ? wells
    : wells.filter((well) => {
      if (well.role === "blank") return true;
      if (!analyzableGroupRoles.includes(well.role)) return false;
      if (identities.has(summaryIdentity(well))) return true;
      const timepoints = new Set(displayedBiologicalSummaries.map((row) => row.timepoint));
      return well.group === analysisConfig.controlGroup && timepoints.has(well.timepoint);
    });
  const scopeKey = `${session.activePlateIndex}:${configKey(analysisConfig)}:${[...session.selectedSummaryKeys].sort().join("|")}`;
  let scopedAnalysis = analysis;
  if (session.selectedSummaryKeys.size) {
    scopedAnalysis = cache.scopedAnalyses.get(scopeKey) ?? analyzeCellViability(significanceScopeWells, analysisConfig);
    cache.scopedAnalyses.set(scopeKey, scopedAnalysis);
  }
  const displayedSignificanceComparisons = session.selectedSummaryKeys.size
    ? scopedAnalysis.significanceComparisons.filter((row) => identities.has(comparisonIdentity(row)))
    : scopedAnalysis.significanceComparisons;
  const displayedAnalysis = {
    ...analysis,
    annotatedWells: displayedAnnotatedWells,
    technicalSummaries: displayedTechnicalSummaries,
    biologicalSummaries: displayedBiologicalSummaries,
    significanceComparisons: displayedSignificanceComparisons,
  };
  return {
    activePlate, wells, activeModuleId, activeModule, assayExecution, analysisConfig, groups, inferredControlGroup, analysis,
    baselineNormalization, useGenericWorkflow, workflowReady, selectedWells, displayedAnalysis,
    displayedBiologicalSummaries, displayedSignificanceComparisons,
    exportScope: session.selectedSummaryKeys.size ? `selected-${displayedBiologicalSummaries.length}rows` : "all",
  };
}

export function workspacePlates(workspace: PlateWorkspace): ParsedPlate[] {
  return projectCache(workspace.project).plates;
}

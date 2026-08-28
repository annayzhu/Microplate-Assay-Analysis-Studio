import { analyzeCellViability } from "./assays/cell-viability";
import { analyzeBaselineNormalization, defaultBaselineNormalizationConfig } from "./baseline-normalization";
import { assignmentDecision, detectedAssayModule, getAssayWorkflow } from "./assay-workflows";
import {
  aggregatePlate,
  annotatedWells,
  assignPlateAssay,
  createPlateAggregate,
  renamePlate,
  replaceWellAnnotations,
  reviewPlateAssayMethod,
  updateWellAnnotations,
  type PlateAggregate,
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

export type PlateWorkspace = {
  readonly plates: readonly PlateAggregate[];
  readonly activePlateIndex: number;
  readonly selectedModuleId: AssayModuleId;
  readonly selectedWellIds: ReadonlySet<string>;
  readonly selectionAnchor: string | null;
  readonly selectedSummaryKeys: ReadonlySet<string>;
  readonly analysisConfig: AnalysisConfig;
  readonly controlGroupTouched: boolean;
  readonly experiment: ExperimentRecord;
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

const analyzableGroupRoles: WellRole[] = ["sample", "control"];

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
  while (usedIds.has(candidate)) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }
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

function inferControlGroup(wells: WellRecord[], groups: string[]): string {
  const roleControlGroups = [...new Set(wells.filter((well) => well.role === "control").map((well) => well.group).filter(Boolean))].sort();
  if (roleControlGroups.length === 1) return roleControlGroups[0];
  return roleControlGroups.find(looksLikeControlGroup) ?? groups.find(looksLikeControlGroup) ?? "";
}

function normalizeWorkspace(workspace: PlateWorkspace): PlateWorkspace {
  const active = workspace.plates[workspace.activePlateIndex];
  if (!active) return workspace;
  const wells = annotatedWells(active);
  const groups = [...new Set(wells.filter((well) => analyzableGroupRoles.includes(well.role)).map((well) => well.group).filter(Boolean))].sort();
  const inferredControlGroup = inferControlGroup(wells, groups);
  const analysisConfig = !workspace.controlGroupTouched && !workspace.analysisConfig.controlGroup && inferredControlGroup
    ? { ...workspace.analysisConfig, controlGroup: inferredControlGroup }
    : workspace.analysisConfig;
  const validSummaryKeys = new Set(analyzeCellViability(wells, analysisConfig).biologicalSummaries.map((row) => row.key));
  const selectedSummaryKeys = new Set([...workspace.selectedSummaryKeys].filter((key) => validSummaryKeys.has(key)));
  const selectedWellIds = new Set([...workspace.selectedWellIds].filter((wellId) => wells.some((well) => well.well === wellId)));
  return { ...workspace, analysisConfig, selectedSummaryKeys, selectedWellIds };
}

export function planWorkspaceImport(
  batch: PlateImportBatch,
  selectedModuleId: AssayModuleId,
  moduleSelectionTouched: boolean,
): WorkspaceImportPlan {
  const moduleIds = batch.plates.map((plate) => {
    const detected = detectedAssayModule(plate);
    if (batch.sourceKind === "project-file") return plate.metadata.confirmedAssayModuleId ?? batch.restoredActiveModuleId ?? detected;
    if (batch.sourceKind !== "instrument-file") return selectedModuleId;
    return moduleSelectionTouched ? selectedModuleId : detected !== "unknown" ? detected : selectedModuleId;
  });
  return {
    batch,
    moduleIds,
    includedPlateIndexes: new Set(batch.plates.map((_, index) => index)),
  };
}

function materializeImportedPlates(
  plan: WorkspaceImportPlan,
  options: WorkspaceImportOptions | undefined,
  usedPlateIds: Set<string>,
): PlateAggregate[] {
  const includedPlateIndexes = options?.includedPlateIndexes ?? plan.includedPlateIndexes;
  const moduleIds = options?.moduleIds ?? plan.moduleIds;
  const included = plan.batch.plates.map((plate, index) => ({ plate, index })).filter(({ index }) => includedPlateIndexes.has(index));
  if (!included.length) throw new Error("至少选择一块板后才能载入。 ");
  return included.map(({ plate, index }) => {
    const detected = detectedAssayModule(plate);
    const confirmedModuleId = moduleIds[index] ?? "unknown";
    return createPlateAggregate({
      ...plate,
      plateId: collisionSafePlateId(plate, index, usedPlateIds),
      metadata: {
        ...plate.metadata,
        detectedAssayModuleId: detected,
        selectedAssayModuleId: confirmedModuleId,
        confirmedAssayModuleId: confirmedModuleId,
        assayAssignmentDecision: plan.batch.sourceKind === "project-file"
          ? "project-restored"
          : assignmentDecision(plan.batch.sourceKind, confirmedModuleId, detected, options?.moduleSelectionTouched ?? false),
      },
    });
  });
}

export function openPlateWorkspace(
  plan: WorkspaceImportPlan,
  options?: WorkspaceImportOptions,
): PlateWorkspace {
  const plates = materializeImportedPlates(plan, options, new Set());
  const firstPlate = aggregatePlate(plates[0]);
  const firstModuleId = firstPlate.metadata.confirmedAssayModuleId ?? detectedAssayModule(firstPlate);
  return normalizeWorkspace({
    plates,
    activePlateIndex: 0,
    selectedModuleId: firstModuleId,
    selectedWellIds: new Set(),
    selectionAnchor: null,
    selectedSummaryKeys: new Set(),
    analysisConfig: plan.batch.restoredAnalysisConfig ? {
      ...defaultAnalysisConfig,
      ...plan.batch.restoredAnalysisConfig,
      baselineNormalization: {
        ...defaultBaselineNormalizationConfig,
        ...plan.batch.restoredAnalysisConfig.baselineNormalization,
      },
    } : defaultAnalysisConfig,
    controlGroupTouched: Boolean(plan.batch.restoredAnalysisConfig?.controlGroup),
    experiment: plan.batch.experiment ?? { name: "", operator: "", date: "", notes: "" },
  });
}

export function appendPlateWorkspace(
  workspace: PlateWorkspace,
  plan: WorkspaceImportPlan,
  options?: WorkspaceImportOptions,
): PlateWorkspace {
  const usedPlateIds = new Set(workspace.plates.map((plate) => aggregatePlate(plate).plateId).filter((plateId): plateId is string => Boolean(plateId)));
  const appended = materializeImportedPlates(plan, options, usedPlateIds);
  const firstAppended = aggregatePlate(appended[0]);
  return normalizeWorkspace({
    ...workspace,
    plates: [...workspace.plates, ...appended],
    activePlateIndex: workspace.plates.length,
    selectedModuleId: firstAppended.metadata.confirmedAssayModuleId ?? detectedAssayModule(firstAppended),
    selectedWellIds: new Set(),
    selectionAnchor: null,
    selectedSummaryKeys: new Set(),
  });
}

export function transitionPlateWorkspace(workspace: PlateWorkspace, action: PlateWorkspaceAction): PlateWorkspace {
  let next = workspace;
  if (action.type === "select-plate") {
    if (!workspace.plates[action.index]) return workspace;
    const plate = aggregatePlate(workspace.plates[action.index]);
    next = {
      ...workspace,
      activePlateIndex: action.index,
      selectedModuleId: plate.metadata.confirmedAssayModuleId ?? detectedAssayModule(plate),
      selectedWellIds: new Set(),
      selectionAnchor: null,
      selectedSummaryKeys: new Set(),
      analysisConfig: { ...workspace.analysisConfig, controlGroup: "", relativeToControlEnabled: false },
      controlGroupTouched: false,
    };
  } else if (action.type === "rename-active-plate") {
    next = { ...workspace, plates: workspace.plates.map((plate, index) => index === workspace.activePlateIndex ? renamePlate(plate, action.name) : plate) };
  } else if (action.type === "assign-active-assay") {
    next = {
      ...workspace,
      selectedModuleId: action.moduleId,
      selectedSummaryKeys: new Set(),
      plates: workspace.plates.map((plate, index) => index === workspace.activePlateIndex ? assignPlateAssay(plate, action.moduleId) : plate),
    };
  } else if (action.type === "review-active-assay-method") {
    next = {
      ...workspace,
      plates: workspace.plates.map((plate, index) => index === workspace.activePlateIndex ? reviewPlateAssayMethod(plate, action.label) : plate),
    };
  } else if (action.type === "select-wells") {
    next = { ...workspace, selectedWellIds: new Set(action.wellIds), selectionAnchor: action.anchor };
  } else if (action.type === "replace-active-wells") {
    next = { ...workspace, plates: workspace.plates.map((plate, index) => index === workspace.activePlateIndex ? replaceWellAnnotations(plate, action.wells) : plate), controlGroupTouched: false, analysisConfig: { ...workspace.analysisConfig, controlGroup: "", relativeToControlEnabled: false } };
  } else if (action.type === "update-selected-annotations") {
    next = {
      ...workspace,
      plates: workspace.plates.map((plate, index) => index === workspace.activePlateIndex ? updateWellAnnotations(plate, workspace.selectedWellIds, action.update) : plate),
    };
  } else if (action.type === "set-analysis-config") {
    next = { ...workspace, analysisConfig: { ...action.config }, controlGroupTouched: action.touched ?? workspace.controlGroupTouched };
  } else if (action.type === "set-experiment") {
    next = { ...workspace, experiment: { ...action.experiment } };
  } else if (action.type === "toggle-summary") {
    const selectedSummaryKeys = new Set(workspace.selectedSummaryKeys);
    if (selectedSummaryKeys.has(action.key)) selectedSummaryKeys.delete(action.key);
    else selectedSummaryKeys.add(action.key);
    next = { ...workspace, selectedSummaryKeys };
  } else if (action.type === "clear-summary-selection") {
    next = { ...workspace, selectedSummaryKeys: new Set() };
  }
  return normalizeWorkspace(next);
}

export function readPlateWorkspace(workspace: PlateWorkspace): PlateWorkspaceView {
  const aggregate = workspace.plates[workspace.activePlateIndex];
  if (!aggregate) throw new Error("Plate workspace 中没有可读取的活动板。 ");
  const activePlate = aggregatePlate(aggregate);
  const wells = activePlate.wells;
  const activeModuleId = activePlate.metadata.confirmedAssayModuleId ?? workspace.selectedModuleId;
  const activeModule = getAssayWorkflow(activeModuleId);
  const groups = [...new Set(wells.filter((well) => analyzableGroupRoles.includes(well.role)).map((well) => well.group).filter(Boolean))].sort();
  const inferredControlGroup = inferControlGroup(wells, groups);
  const analysis = analyzeCellViability(wells, workspace.analysisConfig);
  const baselineNormalization = analyzeBaselineNormalization(workspace.plates.map(aggregatePlate), workspace.analysisConfig);
  const useGenericWorkflow = Boolean(activePlate.assayData && (
    activeModuleId !== "cell-viability"
    || activePlate.assayData.standardCurves.length
    || activePlate.assayData.measurements.some((item) => item.kind === "kinetic" || item.kind === "spectrum")
  ));
  const workflowReady = activeModule.status === "preview"
    ? Boolean(activePlate.assayData?.measurements.length)
    : activeModule.status === "complete" && (useGenericWorkflow ? Boolean(activePlate.assayData?.measurements.length) : analysis.ready);
  const selectedWells = wells.filter((well) => workspace.selectedWellIds.has(well.well));
  const displayedBiologicalSummaries = workspace.selectedSummaryKeys.size
    ? analysis.biologicalSummaries.filter((row) => workspace.selectedSummaryKeys.has(row.key))
    : analysis.biologicalSummaries;
  const displayedSummaryIdentities = new Set(displayedBiologicalSummaries.map(summaryIdentity));
  const displayedTechnicalSummaries = workspace.selectedSummaryKeys.size
    ? analysis.technicalSummaries.filter((row) => displayedSummaryIdentities.has(summaryIdentity(row)))
    : analysis.technicalSummaries;
  const displayedWellIds = new Set(displayedTechnicalSummaries.flatMap((row) => row.wells));
  const displayedAnnotatedWells = workspace.selectedSummaryKeys.size
    ? analysis.annotatedWells.filter((well) => displayedWellIds.has(well.well))
    : analysis.annotatedWells;
  const significanceScopeWells = !workspace.selectedSummaryKeys.size || !workspace.analysisConfig.controlGroup
    ? wells
    : wells.filter((well) => {
      if (well.role === "blank") return true;
      if (!analyzableGroupRoles.includes(well.role)) return false;
      if (displayedSummaryIdentities.has(summaryIdentity(well))) return true;
      const selectedTimepoints = new Set(displayedBiologicalSummaries.map((row) => row.timepoint));
      return well.group === workspace.analysisConfig.controlGroup && selectedTimepoints.has(well.timepoint);
    });
  const scopedAnalysis = workspace.selectedSummaryKeys.size ? analyzeCellViability(significanceScopeWells, workspace.analysisConfig) : analysis;
  const displayedSignificanceComparisons = workspace.selectedSummaryKeys.size
    ? scopedAnalysis.significanceComparisons.filter((comparison) => displayedSummaryIdentities.has(comparisonIdentity(comparison)))
    : scopedAnalysis.significanceComparisons;
  const displayedAnalysis = {
    ...analysis,
    annotatedWells: displayedAnnotatedWells,
    technicalSummaries: displayedTechnicalSummaries,
    biologicalSummaries: displayedBiologicalSummaries,
    significanceComparisons: displayedSignificanceComparisons,
  };
  return {
    activePlate,
    wells,
    activeModuleId,
    activeModule,
    groups,
    inferredControlGroup,
    analysis,
    baselineNormalization,
    useGenericWorkflow,
    workflowReady,
    selectedWells,
    displayedAnalysis,
    displayedBiologicalSummaries,
    displayedSignificanceComparisons,
    exportScope: workspace.selectedSummaryKeys.size ? `selected-${displayedBiologicalSummaries.length}rows` : "all",
  };
}

export function workspacePlates(workspace: PlateWorkspace): ParsedPlate[] {
  return workspace.plates.map(aggregatePlate);
}

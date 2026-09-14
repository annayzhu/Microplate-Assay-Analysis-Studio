import { getAssayWorkflow } from "../assay-workflows";
import type { AnalysisConfig, AssayModuleDefinition, AssayModuleId, CellViabilityAnalysisResult, ParsedPlate, WellRecord } from "../types";
import { analyzeCellViability } from "./cell-viability";

export type AssayExecution =
  | { kind: "cell-viability"; ready: boolean; result: CellViabilityAnalysisResult }
  | { kind: "measurement-preview"; ready: boolean }
  | { kind: "planned"; ready: false };

export type ExecutableAssayModule = {
  readonly definition: AssayModuleDefinition;
  execute(plate: ParsedPlate, wells: WellRecord[], config: AnalysisConfig): AssayExecution;
};

function hasStructuredMeasurements(plate: ParsedPlate): boolean {
  return Boolean(plate.assayData && (
    plate.assayData.standardCurves.length
    || plate.assayData.measurements.some((series) => series.kind === "kinetic" || series.kind === "spectrum")
  ));
}

function createModule(id: AssayModuleId): ExecutableAssayModule {
  const definition = getAssayWorkflow(id);
  if (id === "cell-viability") {
    return {
      definition,
      execute(plate, wells, config) {
        if (hasStructuredMeasurements(plate)) return { kind: "measurement-preview", ready: Boolean(plate.assayData?.measurements.length) };
        const result = analyzeCellViability(wells, config);
        return { kind: "cell-viability", ready: result.ready, result };
      },
    };
  }
  if (definition.status === "preview") {
    return { definition, execute: (plate) => ({ kind: "measurement-preview", ready: Boolean(plate.assayData?.measurements.length) }) };
  }
  return { definition, execute: () => ({ kind: "planned", ready: false }) };
}

const modules = new Map<AssayModuleId, ExecutableAssayModule>();

export function executableAssayModule(id: AssayModuleId): ExecutableAssayModule {
  const existing = modules.get(id);
  if (existing) return existing;
  const created = createModule(id);
  modules.set(id, created);
  return created;
}

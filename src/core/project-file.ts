import type {
  AnalysisConfig,
  AssayModuleId,
  ExperimentRecord,
  ParsedPlate,
  PlateImportBatch,
  WellRecord,
} from "./types";

export const projectSchemaVersion = 2;

export type ProjectWorkspace = {
  plate: ParsedPlate;
  wells: WellRecord[];
};

type ProjectDocument = {
  schemaVersion: number;
  tool: { id: string; version: string };
  generatedAt: string;
  experiment: ExperimentRecord;
  activeModuleId: AssayModuleId;
  analysisConfig: AnalysisConfig;
  plates: ParsedPlate[];
};

function assertProject(value: unknown): asserts value is ProjectDocument {
  if (!value || typeof value !== "object") throw new Error("项目文件不是有效的 JSON 对象。");
  const project = value as Partial<ProjectDocument>;
  if (project.schemaVersion !== projectSchemaVersion) {
    throw new Error(`项目文件版本不受支持：${String(project.schemaVersion ?? "未知")}。当前支持版本 ${projectSchemaVersion}。`);
  }
  if (project.tool?.id !== "microplate-assay-studio") throw new Error("该 JSON 不是 Microplate Assay Studio 项目文件。");
  if (!Array.isArray(project.plates) || !project.plates.length) throw new Error("项目文件中没有培养板数据。");
  for (const [index, plate] of project.plates.entries()) {
    if (!plate || !Array.isArray(plate.wells) || !plate.metadata || !Number.isFinite(plate.rows) || !Number.isFinite(plate.columns)) {
      throw new Error(`项目文件中的第 ${index + 1} 块板结构不完整。`);
    }
  }
}

export function createReproducibleProject(
  workspaces: ProjectWorkspace[],
  experiment: ExperimentRecord,
  activeModuleId: AssayModuleId,
  analysisConfig: AnalysisConfig,
): string {
  const project: ProjectDocument = {
    schemaVersion: projectSchemaVersion,
    tool: { id: "microplate-assay-studio", version: "0.4.0" },
    generatedAt: new Date().toISOString(),
    experiment,
    activeModuleId,
    analysisConfig,
    plates: workspaces.map(({ plate, wells }) => ({
      ...plate,
      wells: wells.map((well) => ({ ...well })),
    })),
  };
  return JSON.stringify(project, null, 2);
}

export function parseReproducibleProject(rawText: string, sourceFileName: string): PlateImportBatch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("项目文件不是有效的 JSON。");
  }
  assertProject(parsed);
  const plates = parsed.plates.map((plate) => ({
    ...plate,
    metadata: {
      ...plate.metadata,
      reopenedFromProjectFile: sourceFileName,
      assayAssignmentDecision: "project-restored" as const,
    },
    wells: plate.wells.map((well) => ({ ...well })),
  }));
  return {
    id: `project-file-${Date.now()}`,
    sourceKind: "project-file",
    sourceName: sourceFileName,
    plates,
    warnings: plates.flatMap((plate) => plate.warnings),
    experiment: parsed.experiment,
    restoredActiveModuleId: parsed.activeModuleId,
    restoredAnalysisConfig: parsed.analysisConfig,
  };
}

import packageMetadata from "../../package.json";
import { defaultBaselineNormalizationConfig } from "./baseline-normalization";
import { artifactName, type ReproducibleArtifact } from "./artifact-file";
import type { AnalysisConfig, AssayModuleId, ExperimentRecord, ParsedPlate, PlateImportBatch } from "./types";

export const toolIdentity = { id: "microplate-assay-studio", version: packageMetadata.version } as const;
export const projectSchemaVersion = 3;

type ProjectDocument = {
  schemaVersion: number;
  tool: { id: string; version: string };
  generatedAt: string;
  experiment: ExperimentRecord;
  activeModuleId: AssayModuleId;
  analysisConfig: AnalysisConfig;
  plates: ParsedPlate[];
};

function clonePlate(plate: ParsedPlate): ParsedPlate {
  return {
    ...plate,
    metadata: { ...plate.metadata },
    wells: plate.wells.map((well) => ({ ...well })),
    assayData: plate.assayData ? structuredClone(plate.assayData) : undefined,
    warnings: [...plate.warnings],
  };
}

function assertProject(value: unknown): asserts value is ProjectDocument {
  if (!value || typeof value !== "object") throw new Error("项目文件不是有效的 JSON 对象。");
  const project = value as Partial<ProjectDocument>;
  if (project.schemaVersion !== 2 && project.schemaVersion !== projectSchemaVersion) throw new Error(`项目文件版本不受支持：${String(project.schemaVersion ?? "未知")}。当前支持版本 2-${projectSchemaVersion}。`);
  if (project.tool?.id !== toolIdentity.id) throw new Error("该 JSON 不是 Microplate Assay Studio 项目文件。");
  if (!Array.isArray(project.plates) || !project.plates.length) throw new Error("项目文件中没有培养板数据。");
  for (const [index, plate] of project.plates.entries()) {
    if (!plate || !Array.isArray(plate.wells) || !plate.metadata || !Number.isFinite(plate.rows) || !Number.isFinite(plate.columns)) {
      throw new Error(`项目文件中的第 ${index + 1} 块板结构不完整。`);
    }
  }
}

export function createProjectArtifact(input: {
  plates: ParsedPlate[];
  experiment: ExperimentRecord;
  activeModuleId: AssayModuleId;
  analysisConfig: AnalysisConfig;
  sourceName?: string;
}): ReproducibleArtifact {
  const project: ProjectDocument = {
    schemaVersion: projectSchemaVersion,
    tool: toolIdentity,
    generatedAt: new Date().toISOString(),
    experiment: structuredClone(input.experiment),
    activeModuleId: input.activeModuleId,
    analysisConfig: {
      ...input.analysisConfig,
      baselineNormalization: { ...defaultBaselineNormalizationConfig, ...input.analysisConfig.baselineNormalization },
    },
    plates: input.plates.map(clonePlate),
  };
  return {
    filename: artifactName(input.sourceName ?? input.plates[0].metadata.sourceFileName, "reproducible-project.json"),
    mimeType: "application/json",
    content: JSON.stringify(project, null, 2),
  };
}

export function parseProjectArtifact(rawText: string, sourceFileName: string): PlateImportBatch {
  let parsed: unknown;
  try { parsed = JSON.parse(rawText); } catch { throw new Error("项目文件不是有效的 JSON。"); }
  assertProject(parsed);
  const plates = parsed.plates.map((plate) => ({
    ...clonePlate(plate),
    metadata: { ...plate.metadata, reopenedFromProjectFile: sourceFileName, assayAssignmentDecision: "project-restored" as const },
  }));
  return {
    id: `project-file-${Date.now()}`,
    sourceKind: "project-file",
    sourceName: sourceFileName,
    plates,
    warnings: plates.flatMap((plate) => plate.warnings),
    experiment: structuredClone(parsed.experiment),
    restoredActiveModuleId: parsed.activeModuleId,
    restoredAnalysisConfig: {
      ...parsed.analysisConfig,
      relativeToControlEnabled: parsed.schemaVersion === 2
        ? Boolean(parsed.analysisConfig.controlGroup)
        : Boolean(parsed.analysisConfig.relativeToControlEnabled),
      baselineNormalization: { ...defaultBaselineNormalizationConfig, ...parsed.analysisConfig.baselineNormalization },
    },
  };
}

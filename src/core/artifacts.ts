import packageMetadata from "../../package.json";
import type {
  AnalysisConfig,
  AssayModuleId,
  CellViabilityAnalysisResult,
  ExperimentRecord,
  ParsedPlate,
  PlateImportBatch,
  WellRecord,
} from "./types";

export const toolIdentity = { id: "microplate-assay-studio", version: packageMetadata.version } as const;
export const projectSchemaVersion = 2;

export type ReproducibleArtifact = {
  filename: string;
  mimeType: "text/csv" | "application/json";
  content: string;
};

export type ArtifactRequest =
  | { kind: "project"; plates: ParsedPlate[]; experiment: ExperimentRecord; activeModuleId: AssayModuleId; analysisConfig: AnalysisConfig; sourceName?: string }
  | { kind: "analysis-package"; plate: ParsedPlate; wells: WellRecord[]; analysisConfig: AnalysisConfig; result: CellViabilityAnalysisResult }
  | { kind: "annotated-wells" | "technical-summary" | "biological-summary"; plate: ParsedPlate; result: CellViabilityAnalysisResult; scope: string }
  | { kind: "measurements"; plate: ParsedPlate; wells?: WellRecord[]; scope?: string };

type ProjectDocument = {
  schemaVersion: number;
  tool: { id: string; version: string };
  generatedAt: string;
  experiment: ExperimentRecord;
  activeModuleId: AssayModuleId;
  analysisConfig: AnalysisConfig;
  plates: ParsedPlate[];
};

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  return /[",\n\r]/.test(stringValue) ? `"${stringValue.replaceAll('"', '""')}"` : stringValue;
}

function rowsToCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
}

function artifactName(source: string, suffix: string): string {
  const stem = source.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${stem || "microplate"}-${suffix}`;
}

function annotatedWellsCsv(result: CellViabilityAnalysisResult, plate: ParsedPlate): string {
  const headers = ["well", "row", "column", "instrument_label", "role", "sample_id", "group", "treatment", "concentration", "timepoint", "biological_replicate", "technical_replicate", "raw_signal", "blank_corrected_signal", "excluded", "notes", "plate_name", "import_source"];
  return rowsToCsv(headers, result.annotatedWells.map((well) => ({
    well: well.well, row: well.row, column: well.column, instrument_label: well.instrumentLabel,
    role: well.role, sample_id: well.sampleId, group: well.group, treatment: well.treatment,
    concentration: well.concentration, timepoint: well.timepoint, biological_replicate: well.biologicalReplicate,
    technical_replicate: well.technicalReplicate, raw_signal: well.rawValue, blank_corrected_signal: well.blankCorrectedValue,
    excluded: well.excluded, notes: well.notes, plate_name: plate.metadata.plateName, import_source: plate.metadata.sourceKind,
  })));
}

function technicalSummaryCsv(result: CellViabilityAnalysisResult, plate: ParsedPlate): string {
  const headers = ["sample_id", "group", "treatment", "concentration", "timepoint", "biological_replicate", "wells", "n_technical", "raw_mean", "raw_sd", "raw_cv_percent", "corrected_mean", "corrected_sd", "corrected_cv_percent", "plate_name", "import_source"];
  return rowsToCsv(headers, result.technicalSummaries.map((row) => ({
    sample_id: row.sampleId, group: row.group, treatment: row.treatment, concentration: row.concentration,
    timepoint: row.timepoint, biological_replicate: row.biologicalReplicate, wells: row.wells.join(";"),
    n_technical: row.nTechnical, raw_mean: row.rawMean, raw_sd: row.rawSd, raw_cv_percent: row.rawCvPercent,
    corrected_mean: row.correctedMean, corrected_sd: row.correctedSd, corrected_cv_percent: row.correctedCvPercent,
    plate_name: plate.metadata.plateName, import_source: plate.metadata.sourceKind,
  })));
}

function biologicalSummaryCsv(result: CellViabilityAnalysisResult, plate: ParsedPlate): string {
  const comparisonByGroup = new Map(result.significanceComparisons.map((comparison) => [[comparison.group, comparison.treatment, comparison.concentration, comparison.timepoint].join("¦"), comparison]));
  const headers = ["category", "value", "sd", "sem", "group", "treatment", "concentration", "timepoint", "n_biological", "blank_corrected_mean", "p_value_vs_control", "fdr_vs_control", "significance", "plate_name", "import_source"];
  return rowsToCsv(headers, result.biologicalSummaries.map((row) => {
    const comparison = comparisonByGroup.get([row.group, row.treatment, row.concentration, row.timepoint].join("¦"));
    return {
      category: [row.group, row.concentration, row.timepoint].filter(Boolean).join(" · "),
      value: row.relativeActivityPercent ?? row.correctedMean, sd: row.relativeSdPercent ?? row.correctedSd,
      sem: row.relativeSemPercent ?? row.correctedSem, group: row.group, treatment: row.treatment,
      concentration: row.concentration, timepoint: row.timepoint, n_biological: row.nBiological,
      blank_corrected_mean: row.correctedMean, p_value_vs_control: comparison?.pValue ?? "",
      fdr_vs_control: comparison?.adjustedPValue ?? "", significance: comparison?.label ?? "",
      plate_name: plate.metadata.plateName, import_source: plate.metadata.sourceKind,
    };
  }));
}

function measurementsCsv(plate: ParsedPlate, annotatedWells: WellRecord[] = plate.wells): string {
  const headers = ["confirmed_assay_module", "detected_assay_module", "assignment_decision", "plate_name", "source_file", "source_kind", "adapter_id", "step_id", "step_name", "kind", "source", "detection_mode", "signal_unit", "formula", "well", "row", "column", "instrument_sample", "instrument_group", "role", "sample_id", "annotated_group", "treatment", "annotated_concentration", "timepoint", "biological_replicate", "technical_replicate", "excluded", "notes", "instrument_concentration", "concentration_unit", "time_seconds", "wavelength_nm", "excitation_nm", "emission_nm", "value", "value_type", "saturated", "disabled"];
  const dataset = plate.assayData;
  if (!dataset) return rowsToCsv(headers, []);
  const annotations = new Map(annotatedWells.map((well) => [well.well, well]));
  return rowsToCsv(headers, dataset.measurements.flatMap((series) => series.points.map((point) => ({
    confirmed_assay_module: plate.metadata.confirmedAssayModuleId ?? dataset.moduleId,
    detected_assay_module: plate.metadata.detectedAssayModuleId ?? dataset.moduleId,
    assignment_decision: plate.metadata.assayAssignmentDecision ?? "", plate_name: plate.metadata.plateName,
    source_file: plate.metadata.sourceFileName, source_kind: plate.metadata.sourceKind, adapter_id: plate.metadata.adapterId,
    step_id: series.id, step_name: series.name, kind: series.kind, source: series.source,
    detection_mode: series.detectionMode, signal_unit: series.signalUnit, formula: series.formula,
    well: point.well, row: point.row, column: point.column, instrument_sample: point.sampleName,
    instrument_group: point.group, role: annotations.get(point.well)?.role ?? "", sample_id: annotations.get(point.well)?.sampleId ?? "",
    annotated_group: annotations.get(point.well)?.group ?? "", treatment: annotations.get(point.well)?.treatment ?? "",
    annotated_concentration: annotations.get(point.well)?.concentration ?? "", timepoint: annotations.get(point.well)?.timepoint ?? "",
    biological_replicate: annotations.get(point.well)?.biologicalReplicate ?? "", technical_replicate: annotations.get(point.well)?.technicalReplicate ?? "",
    excluded: annotations.get(point.well)?.excluded ?? false, notes: annotations.get(point.well)?.notes ?? "",
    instrument_concentration: point.concentration, concentration_unit: point.concentrationUnit, time_seconds: point.timeSeconds,
    wavelength_nm: point.wavelengthNm, excitation_nm: point.excitationWavelengthNm, emission_nm: point.emissionWavelengthNm,
    value: point.value, value_type: point.valueType, saturated: point.saturated, disabled: point.disabled,
  }))));
}

function assertProject(value: unknown): asserts value is ProjectDocument {
  if (!value || typeof value !== "object") throw new Error("项目文件不是有效的 JSON 对象。");
  const project = value as Partial<ProjectDocument>;
  if (project.schemaVersion !== projectSchemaVersion) throw new Error(`项目文件版本不受支持：${String(project.schemaVersion ?? "未知")}。当前支持版本 ${projectSchemaVersion}。`);
  if (project.tool?.id !== toolIdentity.id) throw new Error("该 JSON 不是 Microplate Assay Studio 项目文件。");
  if (!Array.isArray(project.plates) || !project.plates.length) throw new Error("项目文件中没有培养板数据。");
  for (const [index, plate] of project.plates.entries()) {
    if (!plate || !Array.isArray(plate.wells) || !plate.metadata || !Number.isFinite(plate.rows) || !Number.isFinite(plate.columns)) {
      throw new Error(`项目文件中的第 ${index + 1} 块板结构不完整。`);
    }
  }
}

export function createArtifact(request: ArtifactRequest): ReproducibleArtifact {
  if (request.kind === "project") {
    const project: ProjectDocument = {
      schemaVersion: projectSchemaVersion,
      tool: toolIdentity,
      generatedAt: new Date().toISOString(),
      experiment: request.experiment,
      activeModuleId: request.activeModuleId,
      analysisConfig: request.analysisConfig,
      plates: request.plates.map((plate) => ({ ...plate, metadata: { ...plate.metadata }, wells: plate.wells.map((well) => ({ ...well })) })),
    };
    return { filename: artifactName(request.sourceName ?? request.plates[0].metadata.sourceFileName, "reproducible-project.json"), mimeType: "application/json", content: JSON.stringify(project, null, 2) };
  }
  if (request.kind === "analysis-package") {
    return {
      filename: artifactName(request.plate.metadata.sourceFileName, "analysis-package.json"),
      mimeType: "application/json",
      content: JSON.stringify({
        schemaVersion: 1, tool: toolIdentity, assay: { id: "cell-viability", label: request.plate.metadata.assayMethodLabel },
        generatedAt: new Date().toISOString(), source: request.plate.metadata, config: request.analysisConfig,
        annotations: request.wells.map(({ rawValue: _rawValue, ...well }) => well),
        qc: { ready: request.result.ready, blankMean: request.result.blankMean, blankSd: request.result.blankSd, blankCvPercent: request.result.blankCvPercent, findings: request.result.findings },
        resultSummary: request.result.biologicalSummaries, significance: request.result.significanceComparisons,
      }, null, 2),
    };
  }
  if (request.kind === "measurements") {
    return { filename: artifactName(request.plate.metadata.sourceFileName, `${request.scope ?? "all"}-measurements.csv`), mimeType: "text/csv", content: measurementsCsv(request.plate, request.wells) };
  }
  const suffix = request.kind === "annotated-wells" ? "annotated-wells" : request.kind;
  const content = request.kind === "annotated-wells" ? annotatedWellsCsv(request.result, request.plate)
    : request.kind === "technical-summary" ? technicalSummaryCsv(request.result, request.plate)
      : biologicalSummaryCsv(request.result, request.plate);
  return { filename: artifactName(request.plate.metadata.sourceFileName, `${suffix}-${request.scope}.csv`), mimeType: "text/csv", content };
}

export function parseProjectArtifact(rawText: string, sourceFileName: string): PlateImportBatch {
  let parsed: unknown;
  try { parsed = JSON.parse(rawText); } catch { throw new Error("项目文件不是有效的 JSON。"); }
  assertProject(parsed);
  const plates = parsed.plates.map((plate) => ({
    ...plate,
    metadata: { ...plate.metadata, reopenedFromProjectFile: sourceFileName, assayAssignmentDecision: "project-restored" as const },
    wells: plate.wells.map((well) => ({ ...well })),
  }));
  return {
    id: `project-file-${Date.now()}`, sourceKind: "project-file", sourceName: sourceFileName, plates,
    warnings: plates.flatMap((plate) => plate.warnings), experiment: parsed.experiment,
    restoredActiveModuleId: parsed.activeModuleId, restoredAnalysisConfig: parsed.analysisConfig,
  };
}

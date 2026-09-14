import { artifactName, rowsToCsv, type ReproducibleArtifact } from "./artifact-file";
import { annotatedWellExportRows, biologicalSummaryExportRows, technicalSummaryExportRows } from "./result-tables";
import type { AnalysisConfig, BaselineNormalizationResult, CellViabilityAnalysisResult, ParsedPlate, WellRecord } from "./types";

export type ResultArtifactRequest =
  | { kind: "annotated-wells"; plate: ParsedPlate; result: CellViabilityAnalysisResult; scope: string; analysisConfig?: AnalysisConfig }
  | { kind: "technical-summary"; plate: ParsedPlate; result: CellViabilityAnalysisResult; scope: string; analysisConfig?: AnalysisConfig }
  | { kind: "biological-summary"; plate: ParsedPlate; result: CellViabilityAnalysisResult; scope: string; analysisConfig?: AnalysisConfig }
  | { kind: "normalization-ready"; plates: ParsedPlate[]; result: BaselineNormalizationResult; sourceName?: string }
  | { kind: "normalized-results"; plates: ParsedPlate[]; result: BaselineNormalizationResult; sourceName?: string }
  | { kind: "measurements"; plate: ParsedPlate; wells?: WellRecord[]; scope?: string };

const wellHeaders = ["well", "row", "column", "instrument_label", "role", "sample_id", "group", "treatment", "concentration", "timepoint", "biological_replicate", "technical_replicate", "raw_signal", "blank_corrected_signal", "excluded", "notes", "plate_id", "plate_name", "source_file", "import_source", "adapter_id", "detection_mode", "signal_unit"];
const technicalHeaders = ["sample_id", "group", "treatment", "concentration", "timepoint", "biological_replicate", "source_wells", "n_technical", "raw_technical_mean", "raw_technical_sd", "raw_technical_cv_percent", "blank_corrected_technical_mean", "blank_corrected_technical_sd", "blank_corrected_technical_cv_percent", "plate_id", "plate_name", "source_file", "import_source", "adapter_id"];
const biologicalHeaders = ["category", "group", "treatment", "concentration", "timepoint", "n_biological", "signal_basis", "blank_corrected_biological_mean", "blank_corrected_biological_sd", "blank_corrected_biological_sem", "relative_to_control_percent", "relative_to_control_sd_percent", "relative_to_control_sem_percent", "normalization_reference", "normalization_method", "normalization_note", "p_value_vs_control", "fdr_vs_control", "significance", "plate_id", "plate_name", "source_file", "import_source", "adapter_id"];

function normalizationReadyRows(result: BaselineNormalizationResult): Array<Record<string, unknown>> {
  const qcCodes = [...new Set(result.findings.map((finding) => finding.code))];
  const qcStatus = result.findings.some((finding) => finding.severity === "error") ? "blocked" : result.findings.length ? "review" : "clear";
  return result.normalizationReadyRows.map((row) => ({
    plate_id: row.plateId, plate_name: row.plateName, source_file: row.sourceFileName,
    sample_id: row.sampleId, group: row.group, treatment: row.treatment, concentration: row.concentration,
    timepoint: row.timepoint, biological_replicate: row.biologicalReplicate, n_technical: row.nTechnical,
    wells: row.wells.join(";"), plate_blank_mean: row.blankMean,
    blank_corrected_biological_value: row.blankCorrectedBiologicalValue, baseline_candidate: row.baselineCandidate,
    group_original_mean: row.groupOriginalMean, group_original_sd: row.groupOriginalSd,
    group_original_sem: row.groupOriginalSem, group_original_n: row.groupOriginalN,
    normalization_qc_status: qcStatus, normalization_qc_codes: qcCodes.join(";"),
  }));
}

function normalizedRows(result: BaselineNormalizationResult): Array<Record<string, unknown>> {
  if (result.status !== "ready") throw new Error("Baseline normalization 尚未启用或存在阻断问题，不能导出 normalized results。");
  return result.normalizedRows.map((row) => ({
    group: row.group, treatment: row.treatment, concentration: row.concentration, timepoint: row.timepoint,
    baseline_group: row.baselineGroup, baseline_timepoint: row.baselineTimepoint, normalization_method: row.method,
    pairing_status: row.pairingStatus, normalized_mean: row.normalizedMean, normalized_sd: row.normalizedSd,
    normalized_sem: row.normalizedSem, propagated_se: row.propagatedSe, ci95_low: row.ci95Low, ci95_high: row.ci95High,
    scale: row.scale, n: row.n, uncertainty_method: row.uncertaintyMethod,
    baseline_original_mean: row.baselineOriginalMean, baseline_original_sd: row.baselineOriginalSd,
    baseline_original_sem: row.baselineOriginalSem, baseline_n: row.baselineN,
    plate_ids: row.plateIds.join(";"), plate_names: row.plateNames.join(";"), warnings: row.warnings.join(" | "),
    provenance: "Calculated in Studio",
  }));
}

function measurementRows(plate: ParsedPlate, wells: WellRecord[] = plate.wells): Array<Record<string, unknown>> {
  const dataset = plate.assayData;
  if (!dataset) return [];
  const annotations = new Map(wells.map((well) => [well.well, well]));
  return dataset.measurements.flatMap((series) => series.points.map((point) => ({
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
  })));
}

export function createResultArtifact(request: ResultArtifactRequest): ReproducibleArtifact {
  if (request.kind === "normalization-ready") {
    const headers = ["plate_id", "plate_name", "source_file", "sample_id", "group", "treatment", "concentration", "timepoint", "biological_replicate", "n_technical", "wells", "plate_blank_mean", "blank_corrected_biological_value", "baseline_candidate", "group_original_mean", "group_original_sd", "group_original_sem", "group_original_n", "normalization_qc_status", "normalization_qc_codes"];
    return { filename: artifactName(request.sourceName ?? request.plates[0]?.metadata.sourceFileName ?? "microplate", "normalization-ready.csv"), mimeType: "text/csv", content: rowsToCsv(headers, normalizationReadyRows(request.result)) };
  }
  if (request.kind === "normalized-results") {
    const headers = ["group", "treatment", "concentration", "timepoint", "baseline_group", "baseline_timepoint", "normalization_method", "pairing_status", "normalized_mean", "normalized_sd", "normalized_sem", "propagated_se", "ci95_low", "ci95_high", "scale", "n", "uncertainty_method", "baseline_original_mean", "baseline_original_sd", "baseline_original_sem", "baseline_n", "plate_ids", "plate_names", "warnings", "provenance"];
    return { filename: artifactName(request.sourceName ?? request.plates[0]?.metadata.sourceFileName ?? "microplate", "normalized-results.csv"), mimeType: "text/csv", content: rowsToCsv(headers, normalizedRows(request.result)) };
  }
  if (request.kind === "measurements") {
    const headers = ["confirmed_assay_module", "detected_assay_module", "assignment_decision", "plate_name", "source_file", "source_kind", "adapter_id", "step_id", "step_name", "kind", "source", "detection_mode", "signal_unit", "formula", "well", "row", "column", "instrument_sample", "instrument_group", "role", "sample_id", "annotated_group", "treatment", "annotated_concentration", "timepoint", "biological_replicate", "technical_replicate", "excluded", "notes", "instrument_concentration", "concentration_unit", "time_seconds", "wavelength_nm", "excitation_nm", "emission_nm", "value", "value_type", "saturated", "disabled"];
    return { filename: artifactName(request.plate.metadata.sourceFileName, `${request.scope ?? "all"}-measurements.csv`), mimeType: "text/csv", content: rowsToCsv(headers, measurementRows(request.plate, request.wells)) };
  }
  const rows = request.kind === "annotated-wells" ? annotatedWellExportRows(request.result, request.plate)
    : request.kind === "technical-summary" ? technicalSummaryExportRows(request.result, request.plate)
      : biologicalSummaryExportRows(request.result, request.plate, request.analysisConfig);
  const headers = request.kind === "annotated-wells" ? wellHeaders : request.kind === "technical-summary" ? technicalHeaders : biologicalHeaders;
  const suffix = request.kind === "annotated-wells" ? "annotated-wells" : request.kind;
  return { filename: artifactName(request.plate.metadata.sourceFileName, `${suffix}-${request.scope}.csv`), mimeType: "text/csv", content: rowsToCsv(headers, rows) };
}

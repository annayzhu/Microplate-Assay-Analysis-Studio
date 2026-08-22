import type { AnalysisConfig, CellViabilityAnalysisResult, ParsedPlate, WellRecord } from "./types";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  return /[",\n\r]/.test(stringValue) ? `"${stringValue.replaceAll('"', '""')}"` : stringValue;
}

export function rowsToCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
}

export function annotatedWellsCsv(result: CellViabilityAnalysisResult, plate?: ParsedPlate): string {
  const headers = ["well", "row", "column", "instrument_label", "role", "sample_id", "group", "treatment", "concentration", "timepoint", "biological_replicate", "technical_replicate", "raw_signal", "blank_corrected_signal", "excluded", "notes", "plate_name", "import_source"];
  return rowsToCsv(headers, result.annotatedWells.map((well) => ({
    well: well.well,
    row: well.row,
    column: well.column,
    instrument_label: well.instrumentLabel,
    role: well.role,
    sample_id: well.sampleId,
    group: well.group,
    treatment: well.treatment,
    concentration: well.concentration,
    timepoint: well.timepoint,
    biological_replicate: well.biologicalReplicate,
    technical_replicate: well.technicalReplicate,
    raw_signal: well.rawValue,
    blank_corrected_signal: well.blankCorrectedValue,
    excluded: well.excluded,
    notes: well.notes,
    plate_name: plate?.metadata.plateName ?? "",
    import_source: plate?.metadata.sourceKind ?? "",
  })));
}

export function technicalSummaryCsv(result: CellViabilityAnalysisResult, plate?: ParsedPlate): string {
  const headers = ["sample_id", "group", "treatment", "concentration", "timepoint", "biological_replicate", "wells", "n_technical", "raw_mean", "raw_sd", "raw_cv_percent", "corrected_mean", "corrected_sd", "corrected_cv_percent", "plate_name", "import_source"];
  return rowsToCsv(headers, result.technicalSummaries.map((row) => ({
    sample_id: row.sampleId,
    group: row.group,
    treatment: row.treatment,
    concentration: row.concentration,
    timepoint: row.timepoint,
    biological_replicate: row.biologicalReplicate,
    wells: row.wells.join(";"),
    n_technical: row.nTechnical,
    raw_mean: row.rawMean,
    raw_sd: row.rawSd,
    raw_cv_percent: row.rawCvPercent,
    corrected_mean: row.correctedMean,
    corrected_sd: row.correctedSd,
    corrected_cv_percent: row.correctedCvPercent,
    plate_name: plate?.metadata.plateName ?? "",
    import_source: plate?.metadata.sourceKind ?? "",
  })));
}

export function biologicalSummaryCsv(result: CellViabilityAnalysisResult, plate?: ParsedPlate): string {
  const comparisonByGroup = new Map(result.significanceComparisons.map((comparison) => [[comparison.group, comparison.treatment, comparison.concentration, comparison.timepoint].join("¦"), comparison]));
  const headers = ["category", "value", "sd", "sem", "group", "treatment", "concentration", "timepoint", "n_biological", "blank_corrected_mean", "p_value_vs_control", "fdr_vs_control", "significance", "plate_name", "import_source"];
  return rowsToCsv(headers, result.biologicalSummaries.map((row) => {
    const comparison = comparisonByGroup.get([row.group, row.treatment, row.concentration, row.timepoint].join("¦"));
    return {
      category: [row.group, row.concentration, row.timepoint].filter(Boolean).join(" · "),
      value: row.relativeActivityPercent ?? row.correctedMean,
      sd: row.relativeSdPercent ?? row.correctedSd,
      sem: row.relativeSemPercent ?? row.correctedSem,
      group: row.group,
      treatment: row.treatment,
      concentration: row.concentration,
      timepoint: row.timepoint,
      n_biological: row.nBiological,
      blank_corrected_mean: row.correctedMean,
      p_value_vs_control: comparison?.pValue ?? "",
      fdr_vs_control: comparison?.adjustedPValue ?? "",
      significance: comparison?.label ?? "",
      plate_name: plate?.metadata.plateName ?? "",
      import_source: plate?.metadata.sourceKind ?? "",
    };
  }));
}

export function analysisPackageJson(plate: ParsedPlate, wells: WellRecord[], config: AnalysisConfig, result: CellViabilityAnalysisResult): string {
  return JSON.stringify({
    schemaVersion: 1,
    tool: { id: "microplate-assay-studio", version: "0.3.0" },
    assay: { id: "cell-viability", label: plate.metadata.assayMethodLabel },
    generatedAt: new Date().toISOString(),
    source: plate.metadata,
    config,
    annotations: wells.map(({ rawValue: _rawValue, ...well }) => well),
    qc: {
      ready: result.ready,
      blankMean: result.blankMean,
      blankSd: result.blankSd,
      blankCvPercent: result.blankCvPercent,
      findings: result.findings,
    },
    resultSummary: result.biologicalSummaries,
    significance: result.significanceComparisons,
  }, null, 2);
}

export function assayMeasurementsCsv(plate: ParsedPlate, annotatedWells: WellRecord[] = plate.wells): string {
  const headers = ["confirmed_assay_module", "detected_assay_module", "assignment_decision", "plate_name", "source_file", "source_kind", "adapter_id", "step_id", "step_name", "kind", "source", "detection_mode", "signal_unit", "formula", "well", "row", "column", "instrument_sample", "instrument_group", "role", "sample_id", "annotated_group", "treatment", "annotated_concentration", "timepoint", "biological_replicate", "technical_replicate", "excluded", "notes", "instrument_concentration", "concentration_unit", "time_seconds", "wavelength_nm", "excitation_nm", "emission_nm", "value", "value_type", "saturated", "disabled"];
  const dataset = plate.assayData;
  if (!dataset) return rowsToCsv(headers, []);
  const annotations = new Map(annotatedWells.map((well) => [well.well, well]));
  return rowsToCsv(headers, dataset.measurements.flatMap((series) => series.points.map((point) => ({
    confirmed_assay_module: plate.metadata.confirmedAssayModuleId ?? dataset.moduleId,
    detected_assay_module: plate.metadata.detectedAssayModuleId ?? dataset.moduleId,
    assignment_decision: plate.metadata.assayAssignmentDecision ?? "",
    plate_name: plate.metadata.plateName,
    source_file: plate.metadata.sourceFileName,
    source_kind: plate.metadata.sourceKind,
    adapter_id: plate.metadata.adapterId,
    step_id: series.id,
    step_name: series.name,
    kind: series.kind,
    source: series.source,
    detection_mode: series.detectionMode,
    signal_unit: series.signalUnit,
    formula: series.formula,
    well: point.well,
    row: point.row,
    column: point.column,
    instrument_sample: point.sampleName,
    instrument_group: point.group,
    role: annotations.get(point.well)?.role ?? "",
    sample_id: annotations.get(point.well)?.sampleId ?? "",
    annotated_group: annotations.get(point.well)?.group ?? "",
    treatment: annotations.get(point.well)?.treatment ?? "",
    annotated_concentration: annotations.get(point.well)?.concentration ?? "",
    timepoint: annotations.get(point.well)?.timepoint ?? "",
    biological_replicate: annotations.get(point.well)?.biologicalReplicate ?? "",
    technical_replicate: annotations.get(point.well)?.technicalReplicate ?? "",
    excluded: annotations.get(point.well)?.excluded ?? false,
    notes: annotations.get(point.well)?.notes ?? "",
    instrument_concentration: point.concentration,
    concentration_unit: point.concentrationUnit,
    time_seconds: point.timeSeconds,
    wavelength_nm: point.wavelengthNm,
    excitation_nm: point.excitationWavelengthNm,
    emission_nm: point.emissionWavelengthNm,
    value: point.value,
    value_type: point.valueType,
    saturated: point.saturated,
    disabled: point.disabled,
  }))));
}

export function downloadText(filename: string, content: string, mimeType: string): void {
  downloadBlob(filename, new Blob([content], { type: `${mimeType};charset=utf-8` }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

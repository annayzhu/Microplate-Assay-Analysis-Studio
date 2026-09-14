import type { AnalysisConfig, CellViabilityAnalysisResult, ParsedPlate } from "./types";

export function annotatedWellExportRows(result: CellViabilityAnalysisResult, plate: ParsedPlate): Array<Record<string, unknown>> {
  return result.annotatedWells.map((well) => ({
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
    plate_id: plate.plateId ?? "",
    plate_name: plate.metadata.plateName,
    source_file: plate.metadata.sourceFileName,
    import_source: plate.metadata.sourceKind,
    adapter_id: plate.metadata.adapterId,
    detection_mode: plate.metadata.detectionMode,
    signal_unit: plate.metadata.signalUnit,
  }));
}

export function technicalSummaryExportRows(result: CellViabilityAnalysisResult, plate: ParsedPlate): Array<Record<string, unknown>> {
  return result.technicalSummaries.map((row) => ({
    sample_id: row.sampleId,
    group: row.group,
    treatment: row.treatment,
    concentration: row.concentration,
    timepoint: row.timepoint,
    biological_replicate: row.biologicalReplicate,
    source_wells: row.wells.join(";"),
    n_technical: row.nTechnical,
    raw_technical_mean: row.rawMean,
    raw_technical_sd: row.rawSd,
    raw_technical_cv_percent: row.rawCvPercent,
    blank_corrected_technical_mean: row.correctedMean,
    blank_corrected_technical_sd: row.correctedSd,
    blank_corrected_technical_cv_percent: row.correctedCvPercent,
    plate_id: plate.plateId ?? "",
    plate_name: plate.metadata.plateName,
    source_file: plate.metadata.sourceFileName,
    import_source: plate.metadata.sourceKind,
    adapter_id: plate.metadata.adapterId,
  }));
}

export function biologicalSummaryExportRows(result: CellViabilityAnalysisResult, plate: ParsedPlate, analysisConfig?: AnalysisConfig): Array<Record<string, unknown>> {
  const comparisonByGroup = new Map(result.significanceComparisons.map((comparison) => [
    [comparison.group, comparison.treatment, comparison.concentration, comparison.timepoint].join("¦"),
    comparison,
  ]));
  return result.biologicalSummaries.map((row) => {
    const comparison = comparisonByGroup.get([row.group, row.treatment, row.concentration, row.timepoint].join("¦"));
    return {
      category: [row.group, row.concentration, row.timepoint].filter(Boolean).join(" · "),
      group: row.group,
      treatment: row.treatment,
      concentration: row.concentration,
      timepoint: row.timepoint,
      n_biological: row.nBiological,
      signal_basis: "blank-corrected",
      blank_corrected_biological_mean: row.correctedMean,
      blank_corrected_biological_sd: row.correctedSd,
      blank_corrected_biological_sem: row.correctedSem,
      relative_to_control_percent: row.relativeActivityPercent,
      relative_to_control_sd_percent: row.relativeSdPercent,
      relative_to_control_sem_percent: row.relativeSemPercent,
      normalization_reference: row.relativeActivityPercent === null ? "" : analysisConfig?.controlGroup ?? comparison?.controlGroup ?? "control group",
      normalization_method: row.relativeActivityPercent === null ? "" : "fixed-reference-scaling",
      normalization_note: row.relativeActivityPercent === null ? "" : "Control mean is treated as an error-free fixed reference; denominator uncertainty is ignored.",
      p_value_vs_control: comparison?.pValue ?? "",
      fdr_vs_control: comparison?.adjustedPValue ?? "",
      significance: comparison?.label ?? "",
      plate_id: plate.plateId ?? "",
      plate_name: plate.metadata.plateName,
      source_file: plate.metadata.sourceFileName,
      import_source: plate.metadata.sourceKind,
      adapter_id: plate.metadata.adapterId,
    };
  });
}

import type { AnalysisConfig, CellViabilityAnalysisResult, ParsedPlate, WellRecord } from "./types";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  return /[",\n\r]/.test(stringValue) ? `"${stringValue.replaceAll('"', '""')}"` : stringValue;
}

export function rowsToCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
}

export function annotatedWellsCsv(result: CellViabilityAnalysisResult): string {
  const headers = ["well", "row", "column", "instrument_label", "role", "sample_id", "group", "treatment", "concentration", "timepoint", "biological_replicate", "technical_replicate", "raw_signal", "blank_corrected_signal", "excluded", "notes"];
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
  })));
}

export function technicalSummaryCsv(result: CellViabilityAnalysisResult): string {
  const headers = ["sample_id", "group", "treatment", "concentration", "timepoint", "biological_replicate", "wells", "n_technical", "raw_mean", "raw_sd", "raw_cv_percent", "corrected_mean", "corrected_sd", "corrected_cv_percent"];
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
  })));
}

export function biologicalSummaryCsv(result: CellViabilityAnalysisResult): string {
  const comparisonByGroup = new Map(result.significanceComparisons.map((comparison) => [[comparison.group, comparison.treatment, comparison.concentration, comparison.timepoint].join("¦"), comparison]));
  const headers = ["category", "value", "sd", "sem", "group", "treatment", "concentration", "timepoint", "n_biological", "blank_corrected_mean", "p_value_vs_control", "fdr_vs_control", "significance"];
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
    };
  }));
}

export function analysisPackageJson(plate: ParsedPlate, wells: WellRecord[], config: AnalysisConfig, result: CellViabilityAnalysisResult): string {
  return JSON.stringify({
    schemaVersion: 1,
    tool: { id: "microplate-assay-studio", version: "0.1.0" },
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

export function assayMeasurementsCsv(plate: ParsedPlate): string {
  const headers = ["assay_module", "step_id", "step_name", "kind", "source", "detection_mode", "signal_unit", "formula", "well", "row", "column", "sample", "group", "concentration", "concentration_unit", "time_seconds", "wavelength_nm", "excitation_nm", "emission_nm", "value", "value_type", "saturated", "disabled"];
  const dataset = plate.assayData;
  if (!dataset) return rowsToCsv(headers, []);
  return rowsToCsv(headers, dataset.measurements.flatMap((series) => series.points.map((point) => ({
    assay_module: dataset.moduleId,
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
    sample: point.sampleName,
    group: point.group,
    concentration: point.concentration,
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
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

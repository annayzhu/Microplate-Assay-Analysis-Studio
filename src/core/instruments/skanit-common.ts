import type {
  AssayDataset,
  AssayModuleId,
  CellViabilityMethod,
  DetectionMode,
  MeasurementPoint,
  MeasurementSeries,
  MetadataEvidence,
  ParsedPlate,
  PlateMetadata,
  StandardCurve,
  WellRecord,
  WellRole,
} from "../types";

export type SkanitSessionMetadata = Partial<PlateMetadata> & {
  sourceFileName: string;
  sourceExperiment: string;
  runTimestamp: string;
  plateName: string;
  plateType: string;
  instrumentModel: string;
  instrumentSerialNumber: string;
  softwareVersion: string;
};

export function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = text(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeWell(row: string, column: number): string {
  return `${row.toUpperCase()}${column}`;
}

export function roleFromInstrumentLabel(label: string): WellRole {
  if (/^(空白|blank)/i.test(label)) return "blank";
  if (/^(标准|標準|std)/i.test(label)) return "standard";
  if (/^(质控|質控|qc|quality control)/i.test(label)) return "qc";
  if (/^(对照|對照|control)/i.test(label)) return "control";
  return "sample";
}

function seriesNames(series: MeasurementSeries[]): string {
  return series.map((item) => item.name).join(" ");
}

export function classifyAssay(sourceExperiment: string, measurements: MeasurementSeries[]): {
  moduleId: AssayModuleId;
  method: CellViabilityMethod;
  label: string;
  evidence: MetadataEvidence;
} {
  const searchable = `${sourceExperiment} ${seriesNames(measurements)}`;
  if (/dual[\s-]*luciferase|firefly.*renilla|renilla.*firefly/i.test(searchable)) {
    return { moduleId: "luciferase", method: "unknown", label: "Dual-Luciferase Reporter Assay", evidence: "reported" };
  }
  if (/atp/i.test(searchable) && /luminescence|发光/i.test(searchable)) {
    return { moduleId: "atp-quant", method: "unknown", label: "ATP 发光定量", evidence: "reported" };
  }
  if (/bsa|protein quantification/i.test(searchable)) {
    return { moduleId: "protein-quant", method: "unknown", label: /spectrum/i.test(searchable) ? "BSA 蛋白定量与吸收光谱" : "BSA 蛋白定量", evidence: "reported" };
  }
  if (/alamar\s*blue/i.test(searchable)) {
    return { moduleId: "cell-viability", method: "alamarblue", label: "alamarBlue / Resazurin", evidence: "reported" };
  }
  if (/resazurin/i.test(searchable)) {
    return { moduleId: "cell-viability", method: "resazurin", label: "Resazurin", evidence: "reported" };
  }
  if (/mtt/i.test(searchable)) {
    return { moduleId: "cell-viability", method: "mtt", label: "MTT", evidence: "reported" };
  }
  if (/cck[\s-]*8|wst[\s-]*8/i.test(searchable)) {
    return { moduleId: "cell-viability", method: "cck8", label: "CCK-8 / WST-8", evidence: "reported" };
  }
  const primary = measurements.find((item) => item.source === "measured") ?? measurements[0];
  if (primary?.detectionMode === "absorbance" && primary.wavelengthNm === 450) {
    return { moduleId: "cell-viability", method: "cck8", label: "CCK-8 / WST-8", evidence: "inferred" };
  }
  return { moduleId: "unknown", method: "unknown", label: "未识别酶标实验", evidence: "unknown" };
}

function primaryScore(series: MeasurementSeries, moduleId: AssayModuleId): number {
  const name = series.name.toLowerCase();
  let score = series.source === "measured" ? 20 : 30;
  if (series.kind === "endpoint") score += 10;
  if (moduleId === "luciferase") {
    if (/normalization|ratio|比率|归一/.test(name)) score += 100;
    else if (/firefly/.test(name)) score += 40;
  }
  if (moduleId === "atp-quant") {
    if (/background subtraction|背景扣除|减去背景/.test(name)) score += 100;
    else if (/peak/.test(name)) score += 50;
  }
  if (moduleId === "protein-quant") {
    if (/concentration/.test(name)) score += 100;
    else if (/280/.test(name) && !/900|975/.test(name)) score += 60;
  }
  if (moduleId === "cell-viability") {
    if (/blank subtraction|减去空白/.test(name)) score += 80;
    else if (/fluorescence|absorbance|吸光|荧光/.test(name)) score += 60;
  }
  return score;
}

function uniqueWellPoints(series: MeasurementSeries): MeasurementPoint[] {
  const byWell = new Map<string, MeasurementPoint>();
  for (const point of series.points) {
    const current = byWell.get(point.well);
    if (!current || (point.timeSeconds ?? 0) > (current.timeSeconds ?? 0)) byWell.set(point.well, point);
  }
  return [...byWell.values()];
}

function capabilityList(measurements: MeasurementSeries[], standardCurves: StandardCurve[]): string[] {
  const capabilities = new Set<string>();
  if (measurements.some((item) => item.kind === "endpoint")) capabilities.add("终点读数");
  if (measurements.some((item) => item.kind === "kinetic")) capabilities.add("动力学曲线");
  if (measurements.some((item) => item.kind === "spectrum")) capabilities.add("光谱扫描");
  if (measurements.some((item) => item.source === "instrument-calculated")) capabilities.add("仪器计算结果");
  if (measurements.some((item) => /ratio|normalization|比率|归一/i.test(item.name))) capabilities.add("多通道比值");
  if (standardCurves.length) capabilities.add("标准曲线");
  return [...capabilities];
}

export function buildParsedPlate(
  metadata: SkanitSessionMetadata,
  measurements: MeasurementSeries[],
  standardCurves: StandardCurve[],
  adapterId: string,
  warnings: string[] = [],
): ParsedPlate {
  if (!measurements.length) throw new Error("SkanIt 文件中没有识别到可用的测量或计算结果。");
  const classification = classifyAssay(metadata.sourceExperiment, measurements);
  const primary = [...measurements].sort((a, b) => primaryScore(b, classification.moduleId) - primaryScore(a, classification.moduleId))[0];
  const primaryPoints = uniqueWellPoints(primary).filter((point) => !point.disabled);
  const maxColumn = Math.max(1, ...primaryPoints.map((point) => point.column));
  const maxRowIndex = Math.max(0, ...primaryPoints.map((point) => point.row.charCodeAt(0) - 65));
  const plateLooks96 = /96[\s-]*well/i.test(metadata.plateType) || (maxColumn <= 12 && maxRowIndex < 8);
  const rows = plateLooks96 ? 8 : maxRowIndex + 1;
  const columns = plateLooks96 ? 12 : maxColumn;
  const wells: WellRecord[] = primaryPoints.map((point) => {
    const role = roleFromInstrumentLabel(point.sampleName);
    return {
      well: point.well,
      row: point.row,
      column: point.column,
      rawValue: point.value,
      instrumentLabel: point.sampleName,
      role,
      sampleId: point.sampleName,
      group: point.group || (role === "qc" ? "QC" : ""),
      treatment: "",
      concentration: point.concentration === null ? "" : `${point.concentration}${point.concentrationUnit ? ` ${point.concentrationUnit}` : ""}`,
      timepoint: "",
      biologicalReplicate: "",
      technicalReplicate: "",
      excluded: point.disabled,
      notes: point.saturated ? "仪器标记为饱和" : "",
    };
  });
  const assayData: AssayDataset = {
    moduleId: classification.moduleId,
    capabilities: capabilityList(measurements, standardCurves),
    measurements,
    standardCurves,
    primaryMeasurementId: primary.id,
  };
  const measuredReference = measurements.find((series) => series.source === "measured");
  const detectionMode: DetectionMode = primary.source === "instrument-calculated" && measuredReference
    ? measuredReference.detectionMode
    : primary.detectionMode;
  return {
    metadata: {
      sourceFileName: metadata.sourceFileName,
      sourceExperiment: metadata.sourceExperiment,
      runTimestamp: metadata.runTimestamp,
      assayMethod: classification.method,
      assayMethodLabel: classification.label,
      assayMethodEvidence: classification.evidence,
      detectionMode,
      signalUnit: primary.signalUnit,
      wavelengthNm: primary.wavelengthNm,
      excitationWavelengthNm: primary.excitationWavelengthNm,
      emissionWavelengthNm: primary.emissionWavelengthNm,
      referenceWavelengthNm: metadata.referenceWavelengthNm ?? null,
      measurementName: primary.name,
      plateName: metadata.plateName || "Plate 1",
      plateType: metadata.plateType || `${rows} × ${columns}`,
      instrumentManufacturer: metadata.instrumentManufacturer || "Thermo Scientific",
      instrumentModel: metadata.instrumentModel || "Varioskan LUX",
      instrumentSerialNumber: metadata.instrumentSerialNumber,
      assayId: metadata.assayId || "",
      protocolName: metadata.protocolName || metadata.sourceExperiment,
      readDirection: metadata.readDirection || "",
      measurementTimeSeconds: metadata.measurementTimeSeconds ?? null,
      temperatureStartC: metadata.temperatureStartC ?? null,
      temperatureEndC: metadata.temperatureEndC ?? null,
      sheetName: metadata.sheetName || primary.name,
      adapterId,
      assayModuleId: classification.moduleId,
      softwareVersion: metadata.softwareVersion,
    },
    rows,
    columns,
    wells,
    warnings,
    assayData,
  };
}

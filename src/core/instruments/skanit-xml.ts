import type { DetectionMode, MeasurementKind, MeasurementPoint, MeasurementSeries, StandardCurve, StandardCurvePoint } from "../types";
import { buildParsedPlate, normalizeWell, numeric, text, type SkanitSessionMetadata } from "./skanit-common";

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function attributes(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of source.matchAll(/([\w:-]+)="([^"]*)"/g)) result[match[1]] = decodeXml(match[2]);
  return result;
}

function tagValue(source: string, tag: string): string {
  const match = source.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, "").trim()) : "";
}

function firstTagAttributes(source: string, tag: string): Record<string, string> {
  const match = source.match(new RegExp(`<${tag}\\b([^>]*)`, "i"));
  return match ? attributes(match[1]) : {};
}

function detectionMode(name: string, valueType: string): DetectionMode {
  const searchable = `${name} ${valueType}`;
  if (/fluorescence|rfu|荧光/i.test(searchable)) return "fluorescence";
  if (/luminescence|rlu|发光|冷光/i.test(searchable)) return "luminescence";
  return "absorbance";
}

function signalUnit(name: string, valueType: string, body: string): string {
  if (/rlu/i.test(`${name} ${valueType}`)) return "RLU";
  if (/rfu/i.test(`${name} ${valueType}`)) return "RFU";
  if (/absorbance|吸光/i.test(`${name} ${valueType}`)) return "OD";
  if (/concentration/i.test(name)) return name.match(/\(([^)]+)\)/)?.[1] ?? "concentration";
  if (/purity|normalization|ratio|比率|归一/i.test(name)) return "ratio";
  const unit = tagValue(body, "unit");
  return unit || valueType || "value";
}

function measurementKind(name: string, points: MeasurementPoint[], calculated: boolean): MeasurementKind {
  if (/spectrum|光谱/i.test(name) || new Set(points.map((point) => point.wavelengthNm).filter((value) => value !== null)).size > 2) return "spectrum";
  const byWell = new Map<string, number>();
  for (const point of points) byWell.set(point.well, (byWell.get(point.well) ?? 0) + 1);
  if ([...byWell.values()].some((count) => count > 2)) return "kinetic";
  if (/average|sd|cv|replicate/i.test(name)) return "replicate-summary";
  return calculated ? "derived" : "endpoint";
}

function parseCoordinates(stepBody: string, stepName: string): MeasurementPoint[] {
  const points: MeasurementPoint[] = [];
  for (const coordinate of stepBody.matchAll(/<Coordinate\b([^>]*)>([\s\S]*?)<\/Coordinate>/gi)) {
    const coordinateAttrs = attributes(coordinate[1]);
    const body = coordinate[2];
    const row = text(coordinateAttrs.row).toUpperCase();
    const column = numeric(coordinateAttrs.column);
    if (!row || column === null) continue;
    const sampleAttrs = firstTagAttributes(body, "Sample");
    const sampleName = sampleAttrs.name || "";
    const groupAttrs = firstTagAttributes(body, "SampleGroup");
    const concentrationBlock = body.match(/<Concentration>([\s\S]*?)<\/Concentration>/i)?.[1] ?? "";
    const concentration = numeric(tagValue(concentrationBlock, "value"));
    const concentrationUnit = tagValue(concentrationBlock, "unit");
    for (const resultMatch of body.matchAll(/<Result\b([^>]*)\/?\s*>/gi)) {
      const result = attributes(resultMatch[1]);
      const value = numeric(result.value);
      if (value === null) continue;
      const wavelengthEx = numeric(result.wavelength_ex);
      const wavelengthEm = numeric(result.wavelength_em);
      const mode = wavelengthEx !== null && wavelengthEm !== null && wavelengthEx !== wavelengthEm
        ? "fluorescence"
        : detectionMode(stepName, result.value_type || "");
      points.push({
        well: normalizeWell(row, column),
        row,
        column,
        sampleName,
        group: groupAttrs.name || "",
        concentration,
        concentrationUnit,
        value,
        valueType: result.value_type || "value",
        timeSeconds: numeric(result.time),
        wavelengthNm: mode === "absorbance" ? wavelengthEx : null,
        excitationWavelengthNm: mode === "fluorescence" ? wavelengthEx : null,
        emissionWavelengthNm: mode === "fluorescence" ? wavelengthEm : null,
        saturated: result.saturated === "true",
        disabled: result.disabled === "true",
      });
    }
  }
  return points;
}

function parseStandardCurve(stepName: string, stepBody: string, index: number): StandardCurve | null {
  const calculation = firstTagAttributes(stepBody, "CalculationStep");
  if (!/standardcurve/i.test(calculation.name || "") && !/standard curve/i.test(stepName)) return null;
  const formula = firstTagAttributes(stepBody, "Formulas");
  const generic = firstTagAttributes(stepBody, "GenericEquation");
  const coefficientValues = new Map<string, number>();
  for (const coefficient of stepBody.matchAll(/<Coefficient\b([^>]*)\/?\s*>/gi)) {
    const attrs = attributes(coefficient[1]);
    const value = numeric(attrs.value);
    if (attrs.name && value !== null) coefficientValues.set(attrs.name, value);
  }
  const standardsBlock = stepBody.match(/<Standards\b[^>]*>([\s\S]*?)<\/Standards>/i)?.[1] ?? "";
  const points: StandardCurvePoint[] = [];
  for (const sample of standardsBlock.matchAll(/<Sample\b([^>]*)>([\s\S]*?)<\/Sample>/gi)) {
    const sampleAttrs = attributes(sample[1]);
    const body = sample[2];
    const concentrationBlock = body.match(/<Concentration>([\s\S]*?)<\/Concentration>/i)?.[1] ?? "";
    const concentration = numeric(tagValue(concentrationBlock, "value"));
    const signal = numeric(tagValue(body, "originalSignal"));
    if (concentration === null || signal === null) continue;
    points.push({
      sampleName: sampleAttrs.name || "",
      concentration,
      concentrationUnit: tagValue(concentrationBlock, "unit"),
      signal,
      cvPercent: numeric(tagValue(body, "cv")),
      fittedSignal: numeric(tagValue(body, "fittedSignal")),
      residual: numeric(tagValue(body, "residual")),
    });
  }
  return {
    id: `standard-curve-${index + 1}`,
    name: stepName,
    fitType: calculation.fitType || "Unknown",
    concentrationTransform: /log/i.test(calculation.concentrationTransformation || "") ? "logarithmic" : "linear",
    signalTransform: /log/i.test(calculation.SignalTransformation || "") ? "logarithmic" : "linear",
    forceThroughOrigin: calculation.ForceLineThroughOrigin === "true",
    allowExtrapolation: calculation.UseExtrapolation === "true",
    equation: formula.equation || generic.value || "",
    rSquared: numeric(formula.rSquared),
    slope: coefficientValues.get("a") ?? null,
    intercept: coefficientValues.get("b") ?? null,
    points,
  };
}

function parseMeasurement(stepName: string, stepBody: string, index: number): MeasurementSeries | null {
  const points = parseCoordinates(stepBody, stepName);
  if (!points.length) return null;
  const calculated = /<CalculationStep\b/i.test(stepBody) || /subtraction|reduction|correction|normalization|standard curve|concentration|purity|average|sd|cv/i.test(stepName);
  const calculation = firstTagAttributes(stepBody, "CalculationStep");
  const first = points[0];
  const mode = first.excitationWavelengthNm !== null && first.emissionWavelengthNm !== null
    ? "fluorescence"
    : detectionMode(stepName, first.valueType);
  const sourceSteps = Object.entries(calculation)
    .filter(([key, value]) => /source/i.test(key) && value)
    .map(([, value]) => value);
  return {
    id: `measurement-${index + 1}`,
    name: stepName,
    kind: measurementKind(stepName, points, calculated),
    source: calculated ? "instrument-calculated" : "measured",
    detectionMode: mode,
    signalUnit: signalUnit(stepName, first.valueType, stepBody),
    wavelengthNm: mode === "absorbance" ? first.wavelengthNm : null,
    excitationWavelengthNm: mode === "fluorescence" ? first.excitationWavelengthNm : null,
    emissionWavelengthNm: mode === "fluorescence" ? first.emissionWavelengthNm : null,
    formula: calculation.formula || "",
    sourceSteps,
    points,
  };
}

export function parseSkanitXml(xmlText: string, sourceFileName: string, adapterId = "thermo-varioskan-lux:skanit-xml:v1") {
  const clean = xmlText.replace(/^\uFEFF/, "");
  const sessionMatch = clean.match(/<Session\b([^>]*)>/i);
  const sessionAttrs = sessionMatch ? attributes(sessionMatch[1]) : {};
  const measurements: MeasurementSeries[] = [];
  const standardCurves: StandardCurve[] = [];
  let index = 0;
  for (const step of clean.matchAll(/<ResultStep\b([^>]*)>([\s\S]*?)<\/ResultStep>/gi)) {
    const stepAttrs = attributes(step[1]);
    const stepName = stepAttrs.name || `Result ${index + 1}`;
    const body = step[2];
    const measurement = parseMeasurement(stepName, body, index);
    if (measurement) measurements.push(measurement);
    const curve = parseStandardCurve(stepName, body, standardCurves.length);
    if (curve) standardCurves.push(curve);
    index += 1;
  }
  const plateType = tagValue(clean, "PlateTemplate");
  const plateAttrs = firstTagAttributes(clean, "Plate");
  const metadata: SkanitSessionMetadata = {
    sourceFileName,
    sourceExperiment: sessionAttrs.name || tagValue(clean, "SessionName") || sourceFileName,
    runTimestamp: sessionAttrs.time || tagValue(clean, "SessionExecutedTime"),
    plateName: plateAttrs.name || "Plate 1",
    plateType,
    instrumentManufacturer: "Thermo Scientific",
    instrumentModel: "Varioskan LUX",
    instrumentSerialNumber: tagValue(clean, "InstrumentSerialNumber"),
    softwareVersion: tagValue(clean, "SoftwareVersion") || tagValue(clean, "SessionSoftwareVersionExecuted"),
    protocolName: sessionAttrs.name || tagValue(clean, "SessionName"),
  };
  return buildParsedPlate(metadata, measurements, standardCurves, adapterId, [
    `${measurements.length} 个测量/计算步骤，${standardCurves.length} 条标准曲线。`,
  ]);
}

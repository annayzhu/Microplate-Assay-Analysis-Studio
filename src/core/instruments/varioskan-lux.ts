import XLSX from "xlsx-js-style";
import type { DetectionMode, MeasurementPoint, MeasurementSeries, StandardCurve, StandardCurvePoint } from "../types";
import { buildParsedPlate, normalizeWell, numeric, text, type SkanitSessionMetadata } from "./skanit-common";

type Matrix = unknown[][];
type LayoutIdentity = { sampleName: string; group: string; concentration: number | null; concentrationUnit: string };

function rowLetter(value: unknown): string {
  const normalized = text(value).toUpperCase();
  return /^[A-Z]$/.test(normalized) ? normalized : "";
}

function findPlateColumns(header: unknown[]): Array<{ matrixIndex: number; plateColumn: number }> {
  return header.flatMap((value, matrixIndex) => {
    const plateColumn = numeric(value);
    return plateColumn !== null && Number.isInteger(plateColumn) && plateColumn >= 1 && plateColumn <= 48
      ? [{ matrixIndex, plateColumn }]
      : [];
  });
}

function findPlateRows(matrix: Matrix, headerRow: number): Map<string, unknown[]> {
  const rows = new Map<string, unknown[]>();
  for (let index = headerRow + 1; index < matrix.length; index += 1) {
    const letter = rowLetter(matrix[index]?.[0]);
    if (!letter) {
      if (rows.size) break;
      continue;
    }
    rows.set(letter, matrix[index]);
  }
  return rows;
}

function parseConcentration(value: unknown): { concentration: number | null; concentrationUnit: string } {
  const source = text(value);
  const match = source.match(/^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(.*)$/i);
  return match ? { concentration: numeric(match[1]), concentrationUnit: match[2].trim() } : { concentration: null, concentrationUnit: "" };
}

function layoutFromWorkbook(workbook: XLSX.WorkBook): Map<string, LayoutIdentity> {
  const layoutSheetName = workbook.SheetNames.find((name) => /布局定义|layout/i.test(name));
  if (!layoutSheetName) return new Map();
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[layoutSheetName], { header: 1, raw: true, defval: "", blankrows: true });
  const result = new Map<string, LayoutIdentity>();
  const headerIndex = matrix.findIndex((row) => findPlateColumns(row).length >= 1);
  if (headerIndex < 0) return result;
  const columns = findPlateColumns(matrix[headerIndex]);
  for (let index = headerIndex + 1; index < matrix.length; index += 1) {
    const row = rowLetter(matrix[index]?.[0]);
    if (!row) continue;
    const samples = matrix[index] ?? [];
    const groups = matrix[index + 1] ?? [];
    const concentrations = matrix[index + 2] ?? [];
    for (const column of columns) {
      const sampleName = text(samples[column.matrixIndex]);
      if (!sampleName) continue;
      const parsedConcentration = parseConcentration(concentrations[column.matrixIndex]);
      result.set(normalizeWell(row, column.plateColumn), { sampleName, group: text(groups[column.matrixIndex]), ...parsedConcentration });
    }
  }
  return result;
}

function findLabelMap(matrix: Matrix): Map<string, string> {
  const labelHeader = matrix.findIndex((row) => /^(样本|樣本|sample|samples)$/i.test(text(row?.[0])) && findPlateColumns(row).length > 0);
  if (labelHeader < 0) return new Map();
  const columns = findPlateColumns(matrix[labelHeader] ?? []);
  const rows = findPlateRows(matrix, labelHeader);
  const result = new Map<string, string>();
  for (const [row, values] of rows) {
    for (const column of columns) result.set(normalizeWell(row, column.plateColumn), text(values[column.matrixIndex]));
  }
  return result;
}

function detectionMode(name: string, headerLabel: string): DetectionMode {
  const searchable = `${name} ${headerLabel}`;
  if (/fluorescence|rfu|荧光/i.test(searchable)) return "fluorescence";
  if (/luminescence|rlu|发光|冷光/i.test(searchable)) return "luminescence";
  return "absorbance";
}

function seriesUnit(name: string, headerLabel: string): string {
  const searchable = `${name} ${headerLabel}`;
  if (/rlu/i.test(searchable)) return "RLU";
  if (/rfu/i.test(searchable)) return "RFU";
  if (/concentration/i.test(name)) return name.match(/\(([^)]+)\)/)?.[1] ?? "concentration";
  if (/purity|normalization|ratio|比率|归一/i.test(searchable)) return "ratio";
  if (/cv%/i.test(headerLabel)) return "%";
  return "OD";
}

function wavelengthMetadata(matrix: Matrix, name: string): { wavelength: number | null; excitation: number | null; emission: number | null } {
  const leading = matrix.slice(0, 16).flat().map(text).join(" ");
  const pair = `${name} ${leading}`.match(/(?:Ex\s*)?(\d+(?:\.\d+)?)\s*(?:nm)?[^\d]{1,12}(?:Em\s*)?(\d+(?:\.\d+)?)\s*nm/i);
  if (/fluorescence|荧光/i.test(`${name} ${leading}`) && pair) return { wavelength: null, excitation: Number(pair[1]), emission: Number(pair[2]) };
  const single = `${name} ${leading}`.match(/(?:波长[:：]?\s*|absorbance\s*)(\d+(?:\.\d+)?)\s*nm/i);
  return { wavelength: single ? Number(single[1]) : null, excitation: null, emission: null };
}

function calculationInfo(matrix: Matrix, name: string): { calculated: boolean; formula: string; sourceSteps: string[] } {
  const lines = matrix.slice(0, 22).map((row) => row.map(text));
  const sources = lines.flatMap((row) => row.flatMap((cell, index) => {
    const inline = cell.match(/^(?:数据源|源步骤|source)(?:\s+[A-Z])?[:：]\s*(.+)$/i)?.[1];
    return inline ? [inline] : /^(数据源|源步骤|source)/i.test(cell) ? [text(row[index + 1])] : [];
  })).filter(Boolean);
  let formula = "";
  if (/signal normalization/i.test(name)) formula = "A / B";
  if (/background subtraction/i.test(name)) formula = "A - B";
  if (/concentration/i.test(name)) formula = "(A280 - A320) / 6.7 × 10";
  if (/purity/i.test(name)) formula = "(A260 - A320) / (A280 - A320)";
  const calculated = /reduction|correction|subtraction|concentration|average|sd|cv|purity|normalization|standard curve/i.test(name);
  return { calculated, formula, sourceSteps: sources };
}

function createPoint(well: string, value: number, identity: LayoutIdentity | undefined, sampleName: string, overrides: Partial<MeasurementPoint> = {}): MeasurementPoint {
  const match = well.match(/^([A-Z]+)(\d+)$/);
  return {
    well,
    row: match?.[1] ?? "",
    column: Number(match?.[2] ?? 0),
    sampleName: identity?.sampleName || sampleName,
    group: identity?.group || "",
    concentration: identity?.concentration ?? null,
    concentrationUnit: identity?.concentrationUnit || "",
    value,
    valueType: "value",
    timeSeconds: null,
    wavelengthNm: null,
    excitationWavelengthNm: null,
    emissionWavelengthNm: null,
    saturated: false,
    disabled: false,
    ...overrides,
  };
}

function parseSpectrum(matrix: Matrix, sheetName: string, layout: Map<string, LayoutIdentity>, id: string): MeasurementSeries | null {
  const headerRow = matrix.findIndex((row) => /^(波长|wavelength)$/i.test(text(row?.[0])) && row.slice(1).some((value) => /\([A-Z]+\d+\)/i.test(text(value))));
  if (headerRow < 0) return null;
  const columns = (matrix[headerRow] ?? []).flatMap((value, index) => {
    const match = text(value).match(/^(.*?)\s*\(([A-Z]+)0*(\d+)\)$/i);
    return match ? [{ index, sampleName: match[1], well: normalizeWell(match[2], Number(match[3])) }] : [];
  });
  const points: MeasurementPoint[] = [];
  for (let rowIndex = headerRow + 1; rowIndex < matrix.length; rowIndex += 1) {
    const wavelength = numeric(matrix[rowIndex]?.[0]);
    if (wavelength === null) break;
    for (const column of columns) {
      const value = numeric(matrix[rowIndex]?.[column.index]);
      if (value !== null) points.push(createPoint(column.well, value, layout.get(column.well), column.sampleName, { wavelengthNm: wavelength, valueType: "OD" }));
    }
  }
  if (!points.length) return null;
  return { id, name: text(matrix[4]?.[0]) || sheetName, kind: "spectrum", source: "measured", detectionMode: "absorbance", signalUnit: "OD", wavelengthNm: null, excitationWavelengthNm: null, emissionWavelengthNm: null, formula: "", sourceSteps: [], points };
}

function parseKinetic(matrix: Matrix, sheetName: string, layout: Map<string, LayoutIdentity>, id: string): MeasurementSeries | null {
  const headerRow = matrix.findIndex((row) => /^(读数|reading)$/i.test(text(row?.[0])) && /时间|time/i.test(text(row?.[1])));
  if (headerRow < 0) return null;
  const columns = (matrix[headerRow] ?? []).flatMap((value, index) => {
    const match = text(value).match(/^(.*?)\s*\(([A-Z]+)0*(\d+)\)$/i);
    return match ? [{ index, sampleName: match[1], well: normalizeWell(match[2], Number(match[3])) }] : [];
  });
  const points: MeasurementPoint[] = [];
  for (let rowIndex = headerRow + 1; rowIndex < matrix.length; rowIndex += 1) {
    const timeSeconds = numeric(matrix[rowIndex]?.[1]);
    if (timeSeconds === null) break;
    for (const column of columns) {
      const value = numeric(matrix[rowIndex]?.[column.index]);
      if (value !== null) points.push(createPoint(column.well, value, layout.get(column.well), column.sampleName, { timeSeconds, valueType: "RLU" }));
    }
  }
  if (!points.length) return null;
  return { id, name: text(matrix[4]?.[0]) || sheetName, kind: "kinetic", source: "measured", detectionMode: "luminescence", signalUnit: "RLU", wavelengthNm: null, excitationWavelengthNm: null, emissionWavelengthNm: null, formula: "", sourceSteps: [], points };
}

function parsePlateMatrices(matrix: Matrix, sheetName: string, layout: Map<string, LayoutIdentity>, idPrefix: string): MeasurementSeries[] {
  const labels = findLabelMap(matrix);
  const series: MeasurementSeries[] = [];
  const sheetTitle = text(matrix[4]?.[0]) || sheetName;
  const metadata = wavelengthMetadata(matrix, sheetTitle);
  for (let headerRow = 0; headerRow < matrix.length; headerRow += 1) {
    const headerLabel = text(matrix[headerRow]?.[0]);
    if (!/^(吸光值|吸光度值|absorbance|optical density|od|rfu|rlu|数值|已计算|减去空白|平均|sd|cv%|浓度(?:\s*\[[^\]]+\])?|信号)$/i.test(headerLabel)) continue;
    const columns = findPlateColumns(matrix[headerRow] ?? []);
    const rows = findPlateRows(matrix, headerRow);
    if (!columns.length || !rows.size) continue;
    const mode = detectionMode(sheetTitle, headerLabel);
    const points: MeasurementPoint[] = [];
    for (const [row, values] of rows) {
      for (const column of columns) {
        const value = numeric(values[column.matrixIndex]);
        if (value === null) continue;
        const well = normalizeWell(row, column.plateColumn);
        points.push(createPoint(well, value, layout.get(well), labels.get(well) || "", { valueType: headerLabel, wavelengthNm: mode === "absorbance" ? metadata.wavelength : null, excitationWavelengthNm: mode === "fluorescence" ? metadata.excitation : null, emissionWavelengthNm: mode === "fluorescence" ? metadata.emission : null }));
      }
    }
    if (!points.length) continue;
    const calculation = calculationInfo(matrix, sheetTitle);
    series.push({
      id: `${idPrefix}-${series.length + 1}`,
      name: series.length || !/^(吸光值|rfu|rlu|数值|减去空白)$/i.test(headerLabel) ? `${sheetTitle} · ${headerLabel}` : sheetTitle,
      kind: /average|sd|cv|replicate/i.test(sheetTitle) ? "replicate-summary" : calculation.calculated ? "derived" : "endpoint",
      source: calculation.calculated ? "instrument-calculated" : "measured",
      detectionMode: mode,
      signalUnit: seriesUnit(sheetTitle, headerLabel),
      wavelengthNm: mode === "absorbance" ? metadata.wavelength : null,
      excitationWavelengthNm: mode === "fluorescence" ? metadata.excitation : null,
      emissionWavelengthNm: mode === "fluorescence" ? metadata.emission : null,
      formula: calculation.formula,
      sourceSteps: calculation.sourceSteps,
      points,
    });
  }
  return series;
}

function regression(points: StandardCurvePoint[], logX: boolean, logY: boolean): { slope: number | null; intercept: number | null; rSquared: number | null } {
  const usable = points.filter((point) => point.concentration > 0 && point.signal > 0);
  if (usable.length < 2) return { slope: null, intercept: null, rSquared: null };
  const xs = usable.map((point) => logX ? Math.log10(point.concentration) : point.concentration);
  const ys = usable.map((point) => logY ? Math.log10(point.signal) : point.signal);
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const denominator = xs.reduce((sum, value) => sum + (value - xMean) ** 2, 0);
  if (denominator === 0) return { slope: null, intercept: null, rSquared: null };
  const slope = xs.reduce((sum, value, index) => sum + (value - xMean) * (ys[index] - yMean), 0) / denominator;
  const intercept = yMean - slope * xMean;
  const fitted = xs.map((value) => slope * value + intercept);
  const total = ys.reduce((sum, value) => sum + (value - yMean) ** 2, 0);
  const residual = ys.reduce((sum, value, index) => sum + (value - fitted[index]) ** 2, 0);
  return { slope, intercept, rSquared: total === 0 ? 1 : 1 - residual / total };
}

function parseStandardCurve(matrix: Matrix, sheetName: string, id: string): StandardCurve | null {
  const headerRow = matrix.findIndex((row) => /^(孔|well)$/i.test(text(row?.[0])) && /样本|sample/i.test(text(row?.[1])) && /浓度|concentration/i.test(text(row?.[2])));
  if (headerRow < 0) return null;
  const unit = text(matrix[headerRow]?.[2]).match(/\[([^\]]+)\]/)?.[1] ?? "";
  const points: StandardCurvePoint[] = [];
  for (let index = headerRow + 1; index < matrix.length; index += 1) {
    if (!/^(平均|average|mean)$/i.test(text(matrix[index]?.[0]))) continue;
    const concentration = numeric(matrix[index]?.[2]);
    const signal = numeric(matrix[index]?.[3]);
    if (concentration === null || signal === null) continue;
    points.push({ sampleName: text(matrix[index]?.[1]), concentration, concentrationUnit: unit, signal, cvPercent: numeric(matrix[index]?.[4]), fittedSignal: numeric(matrix[index]?.[5]), residual: numeric(matrix[index]?.[6]) });
  }
  if (!points.length) return null;
  const leading = matrix.slice(0, 20).flat().map(text).join(" ");
  const logX = /浓度转换[:：]\s*(对数|log)|concentration transformation.*log/i.test(leading);
  const logY = /信号转换[:：]\s*(对数|log)|signal transformation.*log/i.test(leading);
  const fitted = regression(points, logX, logY);
  const equation = fitted.slope === null || fitted.intercept === null ? "" : `${logY ? "log10(y)" : "y"} = ${fitted.slope.toPrecision(6)} × ${logX ? "log10(x)" : "x"} ${fitted.intercept >= 0 ? "+" : "−"} ${Math.abs(fitted.intercept).toPrecision(6)}`;
  return { id, name: text(matrix[4]?.[0]) || sheetName, fitType: /线性回归|linear regression/i.test(leading) ? "LinearRegression" : "Unknown", concentrationTransform: logX ? "logarithmic" : "linear", signalTransform: logY ? "logarithmic" : "linear", forceThroughOrigin: /通过原点[:：]\s*(是|yes)/i.test(leading), allowExtrapolation: /外推法[:：]\s*(是|yes)/i.test(leading), equation, rSquared: fitted.rSquared, slope: fitted.slope, intercept: fitted.intercept, points };
}

function workbookMetadata(workbook: XLSX.WorkBook, sourceFileName: string): SkanitSessionMetadata {
  const resultSheetName = workbook.SheetNames.find((name) => !/基本信息|程序信息|仪器信息|程序设置|运行日志|布局定义/i.test(name)) ?? workbook.SheetNames[0];
  const resultMatrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[resultSheetName], { header: 1, raw: true, defval: "", blankrows: true });
  const matrixFor = (pattern: RegExp): Matrix => {
    const sheetName = workbook.SheetNames.find((name) => pattern.test(name));
    return sheetName ? XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "", blankrows: true }) : [];
  };
  const layoutMatrix = matrixFor(/布局定义|layout/i);
  const instrumentMatrix = matrixFor(/仪器信息|instrument/i);
  const basicMatrix = matrixFor(/基本信息|general/i);
  const lookup = (matrix: Matrix, pattern: RegExp) => text(matrix.find((candidate) => pattern.test(text(candidate?.[0])))?.[1]);
  return {
    sourceFileName,
    sourceExperiment: text(resultMatrix[1]?.[0]) || sourceFileName,
    runTimestamp: text(resultMatrix[2]?.[0]),
    plateName: text(resultMatrix.find((row) => /^plate\s*\d*/i.test(text(row?.[0])))?.[0]) || text(layoutMatrix[0]?.[1]) || "Plate 1",
    plateType: lookup(layoutMatrix, /板型模板|plate template/i),
    instrumentManufacturer: "Thermo Scientific",
    instrumentModel: lookup(instrumentMatrix, /^(名称|name)$/i) || "Varioskan LUX",
    instrumentSerialNumber: lookup(instrumentMatrix, /序列号|serial/i),
    softwareVersion: lookup(basicMatrix, /软件版本|software version/i),
    protocolName: text(resultMatrix[1]?.[0]) || sourceFileName,
    sheetName: resultSheetName,
  };
}

export function parseVarioskanLuxWorkbook(bytes: ArrayBuffer, sourceFileName: string) {
  const workbook = XLSX.read(bytes, { type: "array", raw: true, cellStyles: true });
  const layout = layoutFromWorkbook(workbook);
  const measurements: MeasurementSeries[] = [];
  const standardCurves: StandardCurve[] = [];
  for (const [sheetIndex, sheetName] of workbook.SheetNames.entries()) {
    if (/基本信息|程序信息|仪器信息|程序设置|运行日志|布局定义/i.test(sheetName)) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "", blankrows: true });
    const spectrum = parseSpectrum(matrix, sheetName, layout, `sheet-${sheetIndex + 1}-spectrum`);
    const kinetic = parseKinetic(matrix, sheetName, layout, `sheet-${sheetIndex + 1}-kinetic`);
    if (spectrum) measurements.push(spectrum);
    if (kinetic) measurements.push(kinetic);
    if (!spectrum && !kinetic) measurements.push(...parsePlateMatrices(matrix, sheetName, layout, `sheet-${sheetIndex + 1}`));
    const curve = parseStandardCurve(matrix, sheetName, `standard-curve-${standardCurves.length + 1}`);
    if (curve) standardCurves.push(curve);
  }
  for (const series of measurements) {
    if (series.source !== "instrument-calculated" || !series.sourceSteps.length) continue;
    const sources = measurements.filter((candidate) => series.sourceSteps.some((sourceName) => candidate.name.toLowerCase().includes(sourceName.toLowerCase()) || sourceName.toLowerCase().includes(candidate.name.toLowerCase())));
    const modes = [...new Set(sources.map((candidate) => candidate.detectionMode))];
    if (modes.length === 1) series.detectionMode = modes[0];
  }
  if (!measurements.length) throw new Error("没有识别到 Varioskan LUX 的结果矩阵。请确认这是 SkanIt 导出的 XLSX 文件。");
  const warnings = measurements.length > 1 || standardCurves.length
    ? [`${measurements.length} 个测量/计算步骤，${standardCurves.length} 条标准曲线。`]
    : [];
  return buildParsedPlate(workbookMetadata(workbook, sourceFileName), measurements, standardCurves, "thermo-varioskan-lux:skanit-xlsx:v1", warnings);
}

export async function parseVarioskanLuxFile(file: File) {
  if (!/\.xlsx$/i.test(file.name)) throw new Error("当前 Varioskan XLSX 适配器只处理 XLSX 文件。");
  return parseVarioskanLuxWorkbook(await file.arrayBuffer(), file.name);
}

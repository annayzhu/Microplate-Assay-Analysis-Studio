import XLSX from "xlsx-js-style";
import { plateTemplateDefinitions, type PlateTemplateDefinition } from "../layout";
import type {
  AssayDataset,
  AssayModuleId,
  DetectionMode,
  MeasurementPoint,
  MeasurementSeries,
  ParsedPlate,
  PlateImportBatch,
  PlateImportSource,
  WellRecord,
} from "../types";

type Matrix = unknown[][];

export type ManualReadingMetadata = {
  assayModuleId: AssayModuleId;
  assayMethodLabel: string;
  detectionMode: DetectionMode;
  signalUnit: string;
  wavelengthNm: number | null;
  excitationWavelengthNm?: number | null;
  emissionWavelengthNm?: number | null;
};

type HeaderMatch = {
  lineIndex: number;
  valueStartIndex: number;
  template: PlateTemplateDefinition;
};

const acceptedMatrixLabels = /^(?:吸光值|吸光度|读数|数值|signal|value|values|absorbance|fluorescence|luminescence|荧光值|发光值)?$/i;

function cellText(value: unknown): string {
  return String(value ?? "").trim();
}

function rowLabel(index: number): string {
  let label = "";
  let current = index;
  do {
    label = String.fromCharCode(65 + (current % 26)) + label;
    current = Math.floor(current / 26) - 1;
  } while (current >= 0);
  return label;
}

function splitTextMatrix(rawText: string): Matrix {
  return rawText.replace(/^\uFEFF/, "").replace(/\r/g, "").split("\n").map((line) => {
    const delimiter = line.includes("\t") ? "\t" : ",";
    return line.split(delimiter);
  });
}

function findHeader(row: unknown[], lineIndex: number): HeaderMatch | null {
  const cells = row.map(cellText);
  const valueStartIndex = cells.findIndex((cell) => cell === "1");
  if (valueStartIndex < 1) return null;
  const label = cells.slice(0, valueStartIndex).filter(Boolean).join(" ");
  if (!acceptedMatrixLabels.test(label)) return null;
  const numberedColumns: number[] = [];
  for (let index = valueStartIndex; index < cells.length; index += 1) {
    const expected = numberedColumns.length + 1;
    if (cells[index] !== String(expected)) break;
    numberedColumns.push(expected);
  }
  const template = plateTemplateDefinitions.find((item) => item.columns === numberedColumns.length);
  return template ? { lineIndex, valueStartIndex, template } : null;
}

function inferPlateName(matrix: Matrix, headerIndex: number, fallback: string): string {
  for (let index = headerIndex - 1; index >= Math.max(0, headerIndex - 12); index -= 1) {
    const nonempty = matrix[index].map(cellText).filter(Boolean);
    if (nonempty.length !== 1) continue;
    const candidate = nonempty[0];
    if (/^(?:波长|wavelength|检测模式|detection|信号单位|signal unit|吸光值|吸光度|样本|sample)/i.test(candidate)) continue;
    if (/^(?:microplate assay studio|填写说明|plate_name|板名称)/i.test(candidate)) continue;
    return candidate;
  }
  return fallback;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = cellText(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function defaultWell(point: MeasurementPoint): WellRecord {
  return {
    well: point.well,
    row: point.row,
    column: point.column,
    rawValue: point.value,
    instrumentLabel: "",
    role: "unassigned",
    sampleId: "",
    group: "",
    treatment: "",
    concentration: "",
    timepoint: "",
    biologicalReplicate: "",
    technicalReplicate: "",
    excluded: false,
    notes: "",
  };
}

function manualPlate(
  plateName: string,
  template: PlateTemplateDefinition,
  points: MeasurementPoint[],
  metadata: ManualReadingMetadata,
  sourceKind: PlateImportSource,
  sourceName: string,
  adapterId: string,
  warnings: string[],
): ParsedPlate {
  const measurement: MeasurementSeries = {
    id: `${plateName}-manual-endpoint`,
    name: metadata.detectionMode === "absorbance" ? "人工录入吸光值" : "人工录入终点读数",
    kind: "endpoint",
    source: "measured",
    detectionMode: metadata.detectionMode,
    signalUnit: metadata.signalUnit,
    wavelengthNm: metadata.detectionMode === "absorbance" ? metadata.wavelengthNm : null,
    excitationWavelengthNm: metadata.detectionMode === "fluorescence" ? metadata.excitationWavelengthNm ?? null : null,
    emissionWavelengthNm: metadata.detectionMode === "fluorescence" ? metadata.emissionWavelengthNm ?? null : null,
    formula: "",
    sourceSteps: [sourceKind === "manual-paste" ? "从表格复制粘贴" : "标准读数模板"],
    points,
  };
  const assayData: AssayDataset = {
    moduleId: metadata.assayModuleId,
    capabilities: ["终点读数", "人工录入"],
    measurements: [measurement],
    standardCurves: [],
    primaryMeasurementId: measurement.id,
  };
  return {
    metadata: {
      sourceKind,
      sourceFileName: sourceName,
      sourceExperiment: plateName,
      runTimestamp: "",
      assayMethod: "unknown",
      assayMethodLabel: metadata.assayMethodLabel,
      assayMethodEvidence: "user-reported",
      detectionMode: metadata.detectionMode,
      signalUnit: metadata.signalUnit,
      wavelengthNm: metadata.detectionMode === "absorbance" ? metadata.wavelengthNm : null,
      excitationWavelengthNm: metadata.detectionMode === "fluorescence" ? metadata.excitationWavelengthNm ?? null : null,
      emissionWavelengthNm: metadata.detectionMode === "fluorescence" ? metadata.emissionWavelengthNm ?? null : null,
      referenceWavelengthNm: null,
      measurementName: measurement.name,
      plateName,
      plateType: `${template.rows} × ${template.columns} · ${template.id}孔板`,
      instrumentManufacturer: "",
      instrumentModel: "人工录入",
      instrumentSerialNumber: "",
      assayId: "",
      protocolName: "",
      readDirection: "",
      measurementTimeSeconds: null,
      temperatureStartC: null,
      temperatureEndC: null,
      sheetName: plateName,
      adapterId,
      assayModuleId: metadata.assayModuleId,
      detectedAssayModuleId: "unknown",
      selectedAssayModuleId: metadata.assayModuleId,
      confirmedAssayModuleId: metadata.assayModuleId,
      assayAssignmentDecision: "manual",
    },
    rows: template.rows,
    columns: template.columns,
    wells: points.map(defaultWell),
    warnings,
    assayData,
  };
}

function parseMatrixBlocks(
  matrix: Matrix,
  metadata: ManualReadingMetadata,
  sourceKind: PlateImportSource,
  sourceName: string,
  namePrefix = "培养板",
): ParsedPlate[] {
  const headers = matrix.map(findHeader).filter((item): item is HeaderMatch => item !== null);
  if (!headers.length) throw new Error("没有识别到孔板读数矩阵。首行应为“读数标签 + 连续列号”，后续行应使用对应板型的行标签。");
  const plates: ParsedPlate[] = [];
  const blockingErrors: string[] = [];
  headers.forEach((header, blockIndex) => {
    const points: MeasurementPoint[] = [];
    const expectedRows = Array.from({ length: header.template.rows }, (_, index) => rowLabel(index));
    let cursor = header.lineIndex + 1;
    for (const expectedRow of expectedRows) {
      while (cursor < matrix.length && matrix[cursor].every((cell) => !cellText(cell))) cursor += 1;
      const row = matrix[cursor] ?? [];
      const rowCellIndex = header.valueStartIndex - 1;
      const actualRow = cellText(row[rowCellIndex]).toUpperCase();
      if (actualRow !== expectedRow) {
        blockingErrors.push(`${namePrefix} ${blockIndex + 1}：第 ${cursor + 1} 行应为 ${expectedRow} 行，实际为“${actualRow || "空"}”。`);
        cursor += 1;
        continue;
      }
      for (let column = 1; column <= header.template.columns; column += 1) {
        const raw = row[header.valueStartIndex + column - 1];
        const parsed = parseNumber(raw);
        if (parsed === null) continue;
        if (Number.isNaN(parsed)) {
          blockingErrors.push(`${namePrefix} ${blockIndex + 1} · ${expectedRow}${column} 不是有效数值：“${cellText(raw)}”。`);
          continue;
        }
        points.push({
          well: `${expectedRow}${column}`,
          row: expectedRow,
          column,
          sampleName: "",
          group: "",
          concentration: null,
          concentrationUnit: "",
          value: parsed,
          valueType: "raw",
          timeSeconds: null,
          wavelengthNm: metadata.detectionMode === "absorbance" ? metadata.wavelengthNm : null,
          excitationWavelengthNm: metadata.detectionMode === "fluorescence" ? metadata.excitationWavelengthNm ?? null : null,
          emissionWavelengthNm: metadata.detectionMode === "fluorescence" ? metadata.emissionWavelengthNm ?? null : null,
          saturated: false,
          disabled: false,
        });
      }
      cursor += 1;
    }
    if (!points.length) blockingErrors.push(`${namePrefix} ${blockIndex + 1} 没有可用数值。`);
    const plateName = inferPlateName(matrix, header.lineIndex, `${namePrefix} ${blockIndex + 1}`);
    const warnings: string[] = [];
    if (points.length < header.template.rows * header.template.columns) {
      warnings.push(`${plateName} 包含 ${points.length} / ${header.template.rows * header.template.columns} 个已测孔；空单元格保留为未测。`);
    }
    if (metadata.detectionMode === "absorbance" && metadata.wavelengthNm === null) {
      warnings.push(`${plateName} 未填写检测波长；系统不会根据读数推断波长。`);
    }
    plates.push(manualPlate(
      plateName,
      header.template,
      points,
      metadata,
      sourceKind,
      sourceName,
      sourceKind === "manual-paste" ? "manual-matrix:paste:v1" : "manual-matrix:xlsx:v1",
      warnings,
    ));
  });
  if (blockingErrors.length) throw new Error(blockingErrors.join(" "));
  return plates;
}

function batch(sourceKind: PlateImportSource, sourceName: string, plates: ParsedPlate[], extraWarnings: string[] = []): PlateImportBatch {
  return {
    id: `${sourceKind}-${Date.now()}`,
    sourceKind,
    sourceName,
    plates,
    warnings: [...plates.flatMap((plate) => plate.warnings), ...extraWarnings],
  };
}

export function parsePastedPlateReadings(rawText: string, metadata: ManualReadingMetadata): PlateImportBatch {
  const plates = parseMatrixBlocks(splitTextMatrix(rawText), metadata, "manual-paste", "manual-paste.tsv");
  return batch("manual-paste", "manual-paste.tsv", plates);
}

function templateMetadata(matrix: Matrix, fallback: ManualReadingMetadata): ManualReadingMetadata {
  const values = new Map(matrix.slice(0, 20).map((row) => [cellText(row[0]).toLowerCase(), cellText(row[1])]));
  const mode = values.get("detection_mode") as DetectionMode | undefined;
  const wavelengthText = values.get("wavelength_nm") ?? "";
  const wavelength = wavelengthText === "" ? fallback.wavelengthNm : Number(wavelengthText);
  const excitation = Number(values.get("excitation_nm") ?? "");
  const emission = Number(values.get("emission_nm") ?? "");
  const moduleId = values.get("assay_module") as AssayModuleId | undefined;
  return {
    ...fallback,
    assayModuleId: moduleId || fallback.assayModuleId,
    assayMethodLabel: values.get("assay_method") || fallback.assayMethodLabel,
    detectionMode: mode && ["absorbance", "fluorescence", "luminescence", "trf", "alpha"].includes(mode) ? mode : fallback.detectionMode,
    signalUnit: values.get("signal_unit") || fallback.signalUnit,
    wavelengthNm: Number.isFinite(wavelength) ? wavelength : fallback.wavelengthNm,
    excitationWavelengthNm: Number.isFinite(excitation) && values.get("excitation_nm") !== "" ? excitation : fallback.excitationWavelengthNm ?? null,
    emissionWavelengthNm: Number.isFinite(emission) && values.get("emission_nm") !== "" ? emission : fallback.emissionWavelengthNm ?? null,
  };
}

export function parseReadingTemplateWorkbook(bytes: ArrayBuffer, sourceFileName: string, metadata: ManualReadingMetadata): PlateImportBatch {
  const workbook = XLSX.read(bytes, { type: "array", raw: true });
  const plates: ParsedPlate[] = [];
  const errors: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    if (/^(?:填写说明|instructions)$/i.test(sheetName)) continue;
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: true });
    try {
      const sheetMetadata = templateMetadata(matrix, metadata);
      const parsed = parseMatrixBlocks(matrix, sheetMetadata, "reading-template", sourceFileName, sheetName);
      parsed.forEach((plate, index) => {
        plate.metadata.plateName = parsed.length === 1 ? sheetName : `${sheetName} · ${index + 1}`;
        plate.metadata.sheetName = sheetName;
      });
      plates.push(...parsed);
    } catch (error) {
      errors.push(`${sheetName}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!plates.length) throw new Error(`模板中没有可导入的孔板。${errors.join(" ")}`);
  return batch("reading-template", sourceFileName, plates, errors.map((error) => `未载入：${error}`));
}

export function createReadingTemplateWorkbook(template: PlateTemplateDefinition, plateCount = 1, suppliedMetadata?: ManualReadingMetadata): ArrayBuffer {
  const metadata: ManualReadingMetadata = suppliedMetadata ?? {
    assayModuleId: "cell-viability",
    assayMethodLabel: "细胞活性 / 细胞增殖",
    detectionMode: "absorbance",
    signalUnit: "OD",
    wavelengthNm: null,
  };
  const workbook = XLSX.utils.book_new();
  const instructions = [
    ["Microplate Assay Studio 孔板读数模板"],
    ["用途", "填写仪器截图、纸面记录或简化 Excel 中的原始终点读数。"],
    ["填写规则", "不要修改行列标签；空单元格表示未测孔，数字 0 表示真实读数。"],
    ["多块板", "每块板使用一个工作表；可复制板工作表后继续填写。"],
    ["科学说明", "模板记录用户报告的实验类型与通道，但不推断空白、对照、分组或重复；导入后请复核并注释。"],
    ["示例", "A1 可填 0.4586；未测孔保持空白。"],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(instructions), "填写说明");
  for (let plateIndex = 0; plateIndex < Math.max(1, plateCount); plateIndex += 1) {
    const rows: unknown[][] = [
      ["Microplate Assay Studio 原始读数"],
      ["plate_name", `培养板 ${plateIndex + 1}`],
      ["assay_module", metadata.assayModuleId],
      ["assay_method", metadata.assayMethodLabel],
      ["detection_mode", metadata.detectionMode],
      ["signal_unit", metadata.signalUnit],
      ["wavelength_nm", metadata.wavelengthNm ?? ""],
      ["excitation_nm", metadata.excitationWavelengthNm ?? ""],
      ["emission_nm", metadata.emissionWavelengthNm ?? ""],
      [],
      [metadata.detectionMode === "absorbance" ? "吸光值" : metadata.detectionMode === "fluorescence" ? "荧光值" : "发光值", ...Array.from({ length: template.columns }, (_, index) => index + 1)],
      ...Array.from({ length: template.rows }, (_, rowIndex) => [rowLabel(rowIndex), ...Array(template.columns).fill("")]),
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = [{ wch: 20 }, ...Array.from({ length: template.columns }, () => ({ wch: 12 }))];
    XLSX.utils.book_append_sheet(workbook, sheet, `培养板 ${plateIndex + 1}`);
  }
  const output = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return output instanceof ArrayBuffer ? output : new Uint8Array(output).buffer;
}

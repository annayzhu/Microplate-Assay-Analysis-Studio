import XLSX from "xlsx-js-style";
import type { ParsedPlate, WellRecord } from "../types";

type Matrix = unknown[][];

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function protocolValue(lines: string[], label: RegExp): string {
  const line = lines.find((item) => label.test(item));
  if (!line) return "";
  const dottedValue = line.match(/\.{2,}\s*(.*?)\s*$/)?.[1];
  return text(dottedValue ?? line.replace(label, ""));
}

function wavelength(value: string): number | null {
  const match = value.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function plateDimensions(plateType: string): { rows: number; columns: number } | null {
  const match = plateType.match(/(\d+)\s*[x×]\s*(\d+)/i);
  return match ? { rows: Number(match[1]), columns: Number(match[2]) } : null;
}

function findSheetName(sheetNames: string[], pattern: RegExp): string {
  return sheetNames.find((name) => pattern.test(name)) ?? "";
}

function matrixFor(workbook: XLSX.WorkBook, sheetName: string): Matrix {
  if (!sheetName || !workbook.Sheets[sheetName]) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: "",
    blankrows: true,
  });
}

function plateTemperatures(matrix: Matrix): { start: number | null; end: number | null } {
  const header = matrix[0]?.map(text) ?? [];
  const values = matrix[1] ?? [];
  const startIndex = header.findIndex((value) => /start temp/i.test(value));
  const endIndex = header.findIndex((value) => /end temp/i.test(value));
  return {
    start: startIndex >= 0 ? numberOrNull(values[startIndex]) : null,
    end: endIndex >= 0 ? numberOrNull(values[endIndex]) : null,
  };
}

export function parseVictorLegacyWorkbook(bytes: ArrayBuffer, sourceFileName: string): ParsedPlate {
  const workbook = XLSX.read(bytes, { type: "array", raw: true, cellDates: true });
  const listSheetName = findSheetName(workbook.SheetNames, /^List\s*;/i);
  const protocolSheetName = findSheetName(workbook.SheetNames, /^Protocol$/i);
  if (!listSheetName || !protocolSheetName) {
    throw new Error("未识别到 VICTOR 旧版导出的 List 和 Protocol 工作表。");
  }

  const listMatrix = matrixFor(workbook, listSheetName);
  const protocolMatrix = matrixFor(workbook, protocolSheetName);
  const protocolLines = protocolMatrix.map((row) => text(row[0])).filter(Boolean);
  const protocolName = protocolValue(protocolLines, /^Protocol name/i);
  if (!/resazurin/i.test(protocolName) && !protocolLines.some((line) => /prompt fluorometry/i.test(line))) {
    throw new Error("该 VICTOR 导出未包含可识别的 Resazurin / 荧光检测协议。");
  }

  const header = listMatrix[0]?.map(text) ?? [];
  const wellIndex = header.findIndex((value) => /^Well$/i.test(value));
  const typeIndex = header.findIndex((value) => /^Type$/i.test(value));
  const valueIndex = header.findIndex((value) => /\((Counts|CPS|RFU)\)$/i.test(value));
  if (wellIndex < 0 || valueIndex < 0) {
    throw new Error("未识别到 VICTOR 导出的孔位列和读数列。");
  }

  const wells: WellRecord[] = [];
  for (const row of listMatrix.slice(1)) {
    const wellMatch = text(row[wellIndex]).toUpperCase().match(/^([A-Z])0*(\d+)$/);
    const rawValue = numberOrNull(row[valueIndex]);
    if (!wellMatch || rawValue === null) continue;
    const wellRow = wellMatch[1];
    const column = Number(wellMatch[2]);
    wells.push({
      well: `${wellRow}${column}`,
      row: wellRow,
      column,
      rawValue,
      instrumentLabel: typeIndex >= 0 ? text(row[typeIndex]) : "",
      role: "sample",
      sampleId: "",
      group: "",
      treatment: "",
      concentration: "",
      timepoint: "",
      biologicalReplicate: "",
      technicalReplicate: "",
      excluded: false,
      notes: "",
    });
  }
  if (!wells.length) throw new Error("VICTOR 导出中没有可用的孔级读数。");

  const plateType = protocolValue(protocolLines, /^Name of the plate type/i);
  const dimensions = plateDimensions(plateType);
  const rows = dimensions?.rows ?? new Set(wells.map((well) => well.row)).size;
  const columns = dimensions?.columns ?? Math.max(...wells.map((well) => well.column));
  const excitationFilter = protocolValue(protocolLines, /^CW-lamp filter name/i);
  const emissionFilter = protocolValue(protocolLines, /^Emission filter name/i);
  const measurementTimeText = protocolValue(protocolLines, /^Measurement time/i);
  const plateSheet = matrixFor(workbook, findSheetName(workbook.SheetNames, /^Plate$/i));
  const temperatures = plateTemperatures(plateSheet);
  const signalHeader = header[valueIndex];
  const signalUnit = signalHeader.match(/\(([^)]+)\)/)?.[1] ?? "Counts";
  const instrumentSerialNumber = protocolValue(protocolLines, /^Instrument serial number/i);
  const assayId = protocolValue(protocolLines, /^Assay ID/i);
  const runTimestamp = protocolValue(protocolLines, /^Measured on/i);
  const readDirection = protocolValue(protocolLines, /^Emission side/i);
  const warnings = [
    `仪器文件记录了 ${wells.length} / ${rows * columns} 个孔的读数；未测孔保持为空。`,
    "VICTOR 文件只标记了测量孔，未提供样本、对照和空白的实验身份；分析前需补充板图。",
  ];

  return {
    metadata: {
      sourceFileName,
      sourceExperiment: protocolName,
      runTimestamp,
      assayMethod: "resazurin",
      assayMethodLabel: "Resazurin",
      assayMethodEvidence: "reported",
      detectionMode: "fluorescence",
      signalUnit,
      wavelengthNm: null,
      excitationWavelengthNm: wavelength(excitationFilter),
      emissionWavelengthNm: wavelength(emissionFilter),
      referenceWavelengthNm: null,
      measurementName: signalHeader.replace(/\s*\([^)]+\)\s*$/, ""),
      plateName: plateType,
      plateType,
      instrumentManufacturer: "PerkinElmer / Wallac",
      instrumentModel: "VICTOR 系列（具体型号未写入文件）",
      instrumentSerialNumber,
      assayId,
      protocolName,
      readDirection,
      measurementTimeSeconds: numberOrNull(measurementTimeText),
      temperatureStartC: temperatures.start,
      temperatureEndC: temperatures.end,
      sheetName: listSheetName,
      adapterId: "perkinelmer-victor:legacy-xls:v1",
    },
    rows,
    columns,
    wells,
    warnings,
  };
}


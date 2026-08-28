import XLSX from "xlsx-js-style";
import packageMetadata from "../../package.json";
import { annotatedWellExportRows, biologicalSummaryExportRows } from "./artifacts";
import type { AnalysisConfig, CellViabilityAnalysisResult, ParsedPlate, WellRole } from "./types";

export type ResultWorkbook = {
  filename: string;
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  bytes: ArrayBuffer;
};

type CellStyle = NonNullable<XLSX.CellObject["s"]>;

const headerStyle: CellStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" } },
  fill: { fgColor: { rgb: "285A59" } },
  alignment: { vertical: "center", horizontal: "center", wrapText: true },
  border: {
    top: { style: "thin", color: { rgb: "D6E1DC" } },
    bottom: { style: "thin", color: { rgb: "D6E1DC" } },
    left: { style: "thin", color: { rgb: "D6E1DC" } },
    right: { style: "thin", color: { rgb: "D6E1DC" } },
  },
};

const roleFill: Record<WellRole, string> = {
  control: "DCEAE5",
  sample: "EAF2EE",
  blank: "F2ECE9",
  qc: "F1D8C0",
  standard: "E8E1EF",
  unassigned: "F3F2EE",
};

function safeStem(source: string): string {
  const stem = source.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "-").replace(/^-+|-+$/g, "");
  return stem || "microplate";
}

function applyTableStyle(sheet: XLSX.WorkSheet, widths: number[]): void {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: column })];
    if (cell) cell.s = headerStyle;
  }
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: range.e.r, c: range.e.c }) };
  sheet["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
}

function roleLabel(role: WellRole): string {
  return ({ control: "对照", sample: "样本", blank: "空白", qc: "质控", standard: "标准品", unassigned: "未指定" })[role];
}

function layoutSheet(plate: ParsedPlate, result: CellViabilityAnalysisResult): XLSX.WorkSheet {
  const included = new Map(result.annotatedWells.map((well) => [well.well, well]));
  const rows: unknown[][] = [
    ["板布局", ...Array.from({ length: plate.columns }, (_, index) => index + 1)],
  ];
  for (let rowIndex = 0; rowIndex < plate.rows; rowIndex += 1) {
    const rowLabel = String.fromCharCode(65 + rowIndex);
    rows.push([rowLabel, ...Array.from({ length: plate.columns }, (_, columnIndex) => {
      const well = included.get(`${rowLabel}${columnIndex + 1}`);
      if (!well) return "";
      const identity = well.sampleId || well.group || well.instrumentLabel || "未标注";
      const replicate = [well.biologicalReplicate, well.technicalReplicate].filter(Boolean).join(" · ");
      return [well.well, `${roleLabel(well.role)} · ${identity}`, replicate, `raw ${well.rawValue}`, well.blankCorrectedValue === null ? "" : `corrected ${well.blankCorrectedValue}`].filter(Boolean).join("\n");
    })]);
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 8 }, ...Array.from({ length: plate.columns }, () => ({ wch: 19 }))];
  sheet["!rows"] = [{ hpt: 24 }, ...Array.from({ length: plate.rows }, () => ({ hpt: 72 }))];
  for (let column = 0; column <= plate.columns; column += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: column })];
    if (cell) cell.s = headerStyle;
  }
  for (let rowIndex = 1; rowIndex <= plate.rows; rowIndex += 1) {
    const rowHeader = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 0 })];
    if (rowHeader) rowHeader.s = headerStyle;
    for (let column = 1; column <= plate.columns; column += 1) {
      const address = `${String.fromCharCode(64 + rowIndex)}${column}`;
      const well = included.get(address);
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: column })];
      if (!cell || !well) continue;
      cell.s = {
        alignment: { vertical: "top", horizontal: "left", wrapText: true },
        fill: { fgColor: { rgb: well.excluded ? "E6E2E0" : roleFill[well.role] } },
        font: { color: { rgb: well.excluded ? "8A817C" : "23302D" }, strike: well.excluded },
        border: {
          top: { style: "thin", color: { rgb: "C9D5D0" } },
          bottom: { style: "thin", color: { rgb: "C9D5D0" } },
          left: { style: "thin", color: { rgb: "C9D5D0" } },
          right: { style: "thin", color: { rgb: "C9D5D0" } },
        },
      };
    }
  }
  sheet["!freeze"] = { xSplit: 1, ySplit: 1, topLeftCell: "B2", activePane: "bottomRight", state: "frozen" };
  return sheet;
}

function exportInfoSheet(plate: ParsedPlate, result: CellViabilityAnalysisResult, scope: string): XLSX.WorkSheet {
  const rows = [
    ["字段", "内容"],
    ["工具", `Microplate Assay Studio v${packageMetadata.version}`],
    ["导出范围", scope === "all" ? "当前板全部汇总行" : "当前点选的汇总行"],
    ["板名称", plate.metadata.plateName],
    ["板 ID", plate.plateId ?? ""],
    ["来源文件", plate.metadata.sourceFileName],
    ["导入适配器", plate.metadata.adapterId],
    ["检测模式", plate.metadata.detectionMode],
    ["信号单位", plate.metadata.signalUnit],
    ["Blank mean", result.blankMean ?? ""],
    ["Blank SD", result.blankSd ?? ""],
    ["说明", "原始读数保持不变；blank-corrected 值为派生结果。技术复孔先在同一 biological replicate 内汇总，但不作为独立工作表导出。"],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  applyTableStyle(sheet, [22, 88]);
  return sheet;
}

export function createResultWorkbook(input: {
  plate: ParsedPlate;
  result: CellViabilityAnalysisResult;
  analysisConfig?: AnalysisConfig;
  scope: string;
}): ResultWorkbook {
  const { plate, result, analysisConfig, scope } = input;
  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.json_to_sheet(biologicalSummaryExportRows(result, plate, analysisConfig));
  const wellSheet = XLSX.utils.json_to_sheet(annotatedWellExportRows(result, plate));
  applyTableStyle(summarySheet, [24, 18, 18, 14, 12, 12, 18, 20, 20, 20, 20, 22, 22, 24, 25, 54, 18, 18, 14, 18, 20, 32, 18, 28]);
  applyTableStyle(wellSheet, [10, 8, 9, 20, 12, 22, 18, 18, 14, 12, 18, 18, 16, 22, 12, 28, 20, 18, 30, 18, 28, 18, 14]);
  XLSX.utils.book_append_sheet(workbook, exportInfoSheet(plate, result, scope), "导出说明");
  XLSX.utils.book_append_sheet(workbook, summarySheet, "生物学汇总");
  XLSX.utils.book_append_sheet(workbook, wellSheet, "孔级数据");
  XLSX.utils.book_append_sheet(workbook, layoutSheet(plate, result), "板布局");
  const output = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true }));
  return {
    filename: `${safeStem(plate.metadata.sourceFileName)}-results-${scope}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer,
  };
}

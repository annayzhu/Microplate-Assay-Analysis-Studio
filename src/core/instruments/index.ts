import XLSX from "xlsx-js-style";
import type { ParsedPlate, PlateImportBatch } from "../types";
import {
  parsePastedPlateReadings,
  parseReadingTemplateWorkbook,
  type ManualReadingMetadata,
} from "./manual-readings";
import { parseVarioskanLuxWorkbook } from "./varioskan-lux";
import { parseVictorLegacyWorkbook } from "./victor-legacy";
import { parseSkanitXml } from "./skanit-xml";

type WorkbookParser = (bytes: ArrayBuffer, sourceFileName: string) => ParsedPlate;

export function parseMicroplateWorkbook(bytes: ArrayBuffer, sourceFileName: string): ParsedPlate {
  const parsers: WorkbookParser[] = /\.xls$/i.test(sourceFileName)
    ? [parseVictorLegacyWorkbook, parseVarioskanLuxWorkbook]
    : [parseVarioskanLuxWorkbook, parseVictorLegacyWorkbook];
  const errors: string[] = [];
  for (const parser of parsers) {
    try {
      return parser(bytes, sourceFileName);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`无法识别该酶标仪文件。${errors.join(" ")}`);
}

export async function parseMicroplateFile(file: File): Promise<ParsedPlate> {
  const bytes = await file.arrayBuffer();
  if (/\.xml$/i.test(file.name)) return parseSkanitXml(new TextDecoder("utf-8").decode(bytes), file.name);
  if (/\.skax$/i.test(file.name)) {
    const archive = XLSX.CFB.read(new Uint8Array(bytes), { type: "array" });
    const entry = archive.FileIndex.find((item: { name: string }) => /(?:^|\/)Session\.xml$/i.test(item.name));
    if (!entry?.content) throw new Error("SKAX 会话包中没有找到 Session.xml。");
    const content = entry.content instanceof Uint8Array ? entry.content : new Uint8Array(entry.content as ArrayBuffer);
    const sessionXml = new TextDecoder("utf-8").decode(content);
    if (!/<ResultStep\b/i.test(sessionXml)) {
      throw new Error("SKAX 是 SkanIt 会话归档，数值保存在内部专用数据块中，不能作为独立结果表直接分析。请在 SkanIt 中将同一会话导出为 XML 或 XLSX；协议与计算设置会随导出结果一起保留。");
    }
    return parseSkanitXml(sessionXml, file.name, "thermo-varioskan-lux:skanit-skax:v1");
  }
  if (/\.xlsx?$/i.test(file.name)) return parseMicroplateWorkbook(bytes, file.name);
  throw new Error("当前支持 SkanIt SKAX / XML / XLSX，以及旧版 XLS 仪器导出文件。");
}

export type PlateReadingImportRequest =
  | { kind: "instrument-file"; file: File }
  | { kind: "manual-paste"; text: string; metadata: ManualReadingMetadata }
  | { kind: "reading-template"; file: File; metadata: ManualReadingMetadata };

export async function importPlateReadings(request: PlateReadingImportRequest): Promise<PlateImportBatch> {
  if (request.kind === "manual-paste") return parsePastedPlateReadings(request.text, request.metadata);
  if (request.kind === "reading-template") {
    return parseReadingTemplateWorkbook(await request.file.arrayBuffer(), request.file.name, request.metadata);
  }
  const plate = await parseMicroplateFile(request.file);
  return {
    id: `instrument-file-${Date.now()}`,
    sourceKind: "instrument-file",
    sourceName: request.file.name,
    plates: [plate],
    warnings: plate.warnings,
  };
}

import XLSX from "xlsx-js-style";
import type { ParsedPlate } from "../types";
import { parseSkanitXml } from "./skanit-xml";
import { parseVarioskanLuxWorkbook } from "./varioskan-lux";
import { parseVictorLegacyWorkbook } from "./victor-legacy";

export type InstrumentFileData = { name: string; bytes: ArrayBuffer };

export type InstrumentAdapter = {
  id: string;
  supports: (sourceName: string) => boolean;
  parse: (input: InstrumentFileData) => ParsedPlate;
};

export type AdapterAttempt = { adapterId: string; message: string };

export class InstrumentImportError extends Error {
  readonly attempts: AdapterAttempt[];

  constructor(sourceName: string, attempts: AdapterAttempt[]) {
    super(`无法识别酶标仪文件 ${sourceName}。${attempts.map((attempt) => `${attempt.adapterId}: ${attempt.message}`).join(" ")}`);
    this.name = "InstrumentImportError";
    this.attempts = attempts;
  }
}

function workbookAdapter(id: string, parser: (bytes: ArrayBuffer, sourceFileName: string) => ParsedPlate, preferXls: boolean): InstrumentAdapter {
  return {
    id,
    supports: (sourceName) => preferXls ? /\.xls$/i.test(sourceName) : /\.xlsx?$/i.test(sourceName),
    parse: ({ bytes, name }) => parser(bytes, name),
  };
}

const skanitXmlAdapter: InstrumentAdapter = {
  id: "thermo-skanit-xml",
  supports: (sourceName) => /\.xml$/i.test(sourceName),
  parse: ({ bytes, name }) => parseSkanitXml(new TextDecoder("utf-8").decode(bytes), name),
};

const skanitArchiveAdapter: InstrumentAdapter = {
  id: "thermo-skanit-skax",
  supports: (sourceName) => /\.skax$/i.test(sourceName),
  parse: ({ bytes, name }) => {
    const archive = XLSX.CFB.read(new Uint8Array(bytes), { type: "array" });
    const entry = archive.FileIndex.find((item: { name: string }) => /(?:^|\/)Session\.xml$/i.test(item.name));
    if (!entry?.content) throw new Error("SKAX 会话包中没有找到 Session.xml。");
    const content = entry.content instanceof Uint8Array ? entry.content : new Uint8Array(entry.content as ArrayBuffer);
    const sessionXml = new TextDecoder("utf-8").decode(content);
    if (!/<ResultStep\b/i.test(sessionXml)) {
      throw new Error("SKAX 数值位于内部专用数据块中。请在 SkanIt 中将同一会话导出为 XML 或 XLSX。");
    }
    return parseSkanitXml(sessionXml, name, "thermo-varioskan-lux:skanit-skax:v1");
  },
};

const varioskanWorkbookAdapter = workbookAdapter("thermo-skanit-workbook", parseVarioskanLuxWorkbook, false);
const victorWorkbookAdapter = workbookAdapter("perkinelmer-victor-workbook", parseVictorLegacyWorkbook, true);

export const instrumentAdapters: readonly InstrumentAdapter[] = [
  skanitXmlAdapter,
  skanitArchiveAdapter,
  varioskanWorkbookAdapter,
  victorWorkbookAdapter,
];

export function parseInstrumentData(input: InstrumentFileData): ParsedPlate {
  const extensionCandidates = instrumentAdapters.filter((adapter) => adapter.supports(input.name));
  if (!extensionCandidates.length) {
    throw new InstrumentImportError(input.name, [{ adapterId: "format-detection", message: "支持 SkanIt SKAX / XML / XLSX 和旧版 XLS。" }]);
  }
  const candidates = /\.xls$/i.test(input.name)
    ? [...extensionCandidates].sort((adapter) => adapter.id.includes("victor") ? -1 : 1)
    : extensionCandidates;
  const attempts: AdapterAttempt[] = [];
  for (const adapter of candidates) {
    try {
      return adapter.parse(input);
    } catch (error) {
      attempts.push({ adapterId: adapter.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  throw new InstrumentImportError(input.name, attempts);
}

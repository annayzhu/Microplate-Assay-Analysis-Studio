import XLSX from "xlsx-js-style";
import { describe, expect, it } from "vitest";
import { importInstrumentFiles, importPlateReadings, type BinaryFileSource } from "../src/core/import";
import { InstrumentImportError } from "../src/core/instruments/registry";

function binarySource(name: string, bytes: ArrayBuffer): BinaryFileSource {
  return { name, arrayBuffer: async () => bytes };
}

function victorWorkbook(): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Plate", "Repeat", "Well", "Type", "Time", "XR600nm (Counts)"],
    [1, 1, "B01", "M", "00:00:17.83", 38103],
  ]), "List ; Plates 1 - 1");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Protocol description"],
    ["Protocol name ..................... cell viability (resazurin)"],
    ["Name of the plate type ............ Generic 8x12 size plate"],
    ["Label technology .................. Prompt fluorometry"],
    ["CW-lamp filter name ............... P570"],
    ["Emission filter name .............. D600"],
  ]), "Protocol");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xls" });
  return bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer;
}

describe("normalized plate-reading import module", () => {
  it("routes a binary source through the matching vendor adapter and normalized batch", async () => {
    const batch = await importPlateReadings({ kind: "instrument-file", file: binarySource("victor.xls", victorWorkbook()) });
    expect(batch).toMatchObject({ sourceKind: "instrument-file", sourceName: "victor.xls" });
    expect(batch.plates[0].metadata).toMatchObject({ adapterId: "perkinelmer-victor:legacy-xls:v1", detectedAssayModuleId: "unknown" });
    expect(batch.plates[0].wells[0]).toMatchObject({ well: "B1", rawValue: 38103 });
  });

  it("returns structured adapter attempts for unsupported data", async () => {
    const invalid = new TextEncoder().encode("not a workbook").buffer;
    await expect(importPlateReadings({ kind: "instrument-file", file: binarySource("unknown.xlsx", invalid) }))
      .rejects.toBeInstanceOf(InstrumentImportError);
    try {
      await importPlateReadings({ kind: "instrument-file", file: binarySource("unknown.xlsx", invalid) });
    } catch (error) {
      expect((error as InstrumentImportError).attempts.length).toBeGreaterThan(0);
      expect((error as InstrumentImportError).attempts[0].adapterId).toBe("thermo-skanit-workbook");
    }
  });

  it("combines separate instrument exports into one ordered multi-plate batch", async () => {
    const batch = await importInstrumentFiles([
      binarySource("day-0.xls", victorWorkbook()),
      binarySource("day-1.xls", victorWorkbook()),
    ]);

    expect(batch).toMatchObject({ sourceKind: "instrument-file", sourceName: "day-0.xls; day-1.xls" });
    expect(batch.plates).toHaveLength(2);
    expect(batch.plates.map((plate) => plate.metadata.sourceFileName)).toEqual(["day-0.xls", "day-1.xls"]);
  });
});

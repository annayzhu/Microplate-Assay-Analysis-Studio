import XLSX from "xlsx-js-style";
import { describe, expect, it } from "vitest";
import { parseVictorLegacyWorkbook } from "../src/core/instruments/victor-legacy";

function fixtureBytes(): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Plate", "Repeat", "Well", "Type", "Time", "XR600nm (Counts)"],
    [1, 1, "B01", "M", "00:00:17.83", 38103],
    [1, 1, "B02", "M", "00:00:18.19", 35514],
    [1, 1, "H12", "M", "00:00:55.00", 2307],
  ]), "List ; Plates 1 - 1");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Plate", "Repeat", "End time", "Start temp.", "End temp.", "BarCode"],
    [1, 1, "3:50:30 PM", 24.4, 24.4, "N/A"],
  ]), "Plate");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Protocol description"],
    ["Protocol name ..................... Copy of cell viability (resazurin)"],
    ["Name of the plate type ............ Generic 8x12 size plate"],
    ["Name of the label ................. XR600nm"],
    ["Label technology .................. Prompt fluorometry"],
    ["CW-lamp filter name ............... P570"],
    ["Emission filter name .............. D600"],
    ["Measurement time .................. 0.1 s"],
    ["Emission side ..................... Above"],
    ["Instrument serial number: ......... 4207933"],
    ["Assay ID:  ........................ 17822"],
    ["Measured on ....................... 5/17/2019 3:49:13 PM"],
  ]), "Protocol");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Notes for the assay run"]]), "Notes");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xls" });
  return bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer;
}

describe("PerkinElmer / Wallac VICTOR legacy XLS adapter", () => {
  it("separates assay method, detection mode, channel, unit, and provenance", () => {
    const plate = parseVictorLegacyWorkbook(fixtureBytes(), "victor-resazurin.xls");

    expect(plate.metadata).toMatchObject({
      adapterId: "perkinelmer-victor:legacy-xls:v1",
      assayMethod: "resazurin",
      assayMethodEvidence: "reported",
      detectionMode: "fluorescence",
      signalUnit: "Counts",
      excitationWavelengthNm: 570,
      emissionWavelengthNm: 600,
      instrumentSerialNumber: "4207933",
      assayId: "17822",
      readDirection: "Above",
      measurementTimeSeconds: 0.1,
      temperatureStartC: 24.4,
      temperatureEndC: 24.4,
    });
    expect(plate.rows).toBe(8);
    expect(plate.columns).toBe(12);
    expect(plate.wells).toHaveLength(3);
    expect(plate.wells[0]).toMatchObject({ well: "B1", rawValue: 38103, role: "sample" });
    expect(plate.warnings.join(" ")).toContain("3 / 96");
  });
});


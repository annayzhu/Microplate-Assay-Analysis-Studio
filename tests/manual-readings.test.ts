import XLSX from "xlsx-js-style";
import { describe, expect, it } from "vitest";
import { plateTemplateDefinitions } from "../src/core/layout";
import {
  createReadingTemplateWorkbook,
  parsePastedPlateReadings,
  parseReadingTemplateWorkbook,
  type ManualReadingMetadata,
} from "../src/core/instruments/manual-readings";

const metadata: ManualReadingMetadata = {
  assayModuleId: "cell-viability",
  assayMethodLabel: "细胞活性 / 细胞增殖",
  detectionMode: "absorbance",
  signalUnit: "OD",
  wavelengthNm: 450,
};

function matrix96(offset = 0, missing = ""): string {
  const lines = [`吸光值\t${Array.from({ length: 12 }, (_, index) => index + 1).join("\t")}`];
  for (let rowIndex = 0; rowIndex < 8; rowIndex += 1) {
    const row = String.fromCharCode(65 + rowIndex);
    const values = Array.from({ length: 12 }, (_, columnIndex) => {
      if (rowIndex === 7 && columnIndex === 11 && missing) return missing;
      return (offset + rowIndex * 0.01 + columnIndex * 0.001).toFixed(4);
    });
    lines.push(`${row}\t${values.join("\t")}`);
  }
  return lines.join("\n");
}

describe("manual plate-reading import seam", () => {
  it("maps a complete Excel-style 96-well matrix without inferring experimental roles", () => {
    const result = parsePastedPlateReadings(matrix96(), metadata);
    const plate = result.plates[0];

    expect(result.sourceKind).toBe("manual-paste");
    expect(plate.rows).toBe(8);
    expect(plate.columns).toBe(12);
    expect(plate.wells).toHaveLength(96);
    expect(plate.wells[0]).toMatchObject({ well: "A1", rawValue: 0, role: "unassigned", group: "" });
    expect(plate.wells.at(-1)).toMatchObject({ well: "H12", rawValue: 0.081 });
    expect(plate.metadata).toMatchObject({
      sourceKind: "manual-paste",
      assayMethodEvidence: "user-reported",
      detectionMode: "absorbance",
      wavelengthNm: 450,
      signalUnit: "OD",
    });
  });

  it("keeps zero values and treats empty cells as unmeasured", () => {
    const sparse = matrix96(0, "").split("\n");
    const last = sparse.at(-1)?.split("\t") ?? [];
    last[last.length - 1] = "";
    sparse[sparse.length - 1] = last.join("\t");
    const plate = parsePastedPlateReadings(sparse.join("\n"), metadata).plates[0];

    expect(plate.wells.find((well) => well.well === "A1")?.rawValue).toBe(0);
    expect(plate.wells.some((well) => well.well === "H12")).toBe(false);
    expect(plate.warnings.join(" ")).toContain("95 / 96");
  });

  it("recognizes two vertically stacked reading blocks while ignoring the sample-label matrix", () => {
    const sampleLabels = [
      `样本\t${Array.from({ length: 12 }, (_, index) => index + 1).join("\t")}`,
      ...Array.from({ length: 8 }, (_, rowIndex) => `${String.fromCharCode(65 + rowIndex)}\t${Array.from({ length: 12 }, (_, columnIndex) => `未知${rowIndex * 12 + columnIndex + 1}`).join("\t")}`),
    ].join("\n");
    const pasted = ["培养板 1", matrix96(), sampleLabels, "波长：450 nm", "培养板 2", matrix96(1)].join("\n\n");
    const result = parsePastedPlateReadings(pasted, metadata);

    expect(result.plates).toHaveLength(2);
    expect(result.plates.map((plate) => plate.metadata.plateName)).toEqual(["培养板 1", "培养板 2"]);
    expect(result.plates[0].wells[0].rawValue).toBe(0);
    expect(result.plates[1].wells[0].rawValue).toBe(1);
  });

  it("reports the plate and well coordinate for invalid numeric content", () => {
    expect(() => parsePastedPlateReadings(matrix96().replace("0.0010", "not-a-number"), metadata))
      .toThrow(/培养板 1 · A2 不是有效数值/);
  });

  it("round-trips every supported reading-template geometry and imports multiple sheets as independent plates", () => {
    for (const template of plateTemplateDefinitions) {
      const workbook = XLSX.read(createReadingTemplateWorkbook(template, 2), { type: "array" });
      for (const sheetName of workbook.SheetNames.filter((name) => name !== "填写说明")) {
        const sheet = workbook.Sheets[sheetName];
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
        const headerIndex = matrix.findIndex((row) => String(row[1] ?? "") === "1");
        const valueCell = XLSX.utils.encode_cell({ r: headerIndex + 1, c: 1 });
        sheet[valueCell] = { t: "n", v: sheetName.endsWith("1") ? 0 : 1 };
      }
      const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
      const result = parseReadingTemplateWorkbook(bytes, `${template.id}-well.xlsx`, metadata);

      expect(result.plates).toHaveLength(2);
      expect(result.plates[0]).toMatchObject({ rows: template.rows, columns: template.columns });
      expect(result.plates[0].wells[0]).toMatchObject({ well: "A1", rawValue: 0 });
      expect(result.plates[1].wells[0]).toMatchObject({ well: "A1", rawValue: 1 });
      expect(result.plates.every((plate) => plate.metadata.sourceKind === "reading-template")).toBe(true);
    }
  });
});

import XLSX from "xlsx-js-style";
import { describe, expect, it } from "vitest";
import { analyzeCellViability } from "../src/core/assays/cck8";
import { createResultWorkbook } from "../src/core/result-workbook";
import { fixturePlate } from "./fixtures/plate-fixtures";

const config = {
  controlGroup: "Control",
  relativeToControlEnabled: true,
  technicalCvThresholdPercent: 15,
  blankCvThresholdPercent: 10,
};

describe("result workbook export", () => {
  it("combines the biological summary, well-level data, and plate layout without a technical-summary sheet", () => {
    const plate = { ...fixturePlate(), plateId: "plate-1" };
    const result = analyzeCellViability(plate.wells, config);
    const artifact = createResultWorkbook({ plate, result, analysisConfig: config, scope: "all" });
    const workbook = XLSX.read(artifact.bytes, { type: "array" });

    expect(artifact.filename).toBe("fixture-results-all.xlsx");
    expect(workbook.SheetNames).toEqual(["导出说明", "生物学汇总", "孔级数据", "板布局"]);
    expect(workbook.SheetNames).not.toContain("技术复孔");

    const summaries = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["生物学汇总"]);
    const wells = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["孔级数据"]);
    const layout = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets["板布局"], { header: 1, defval: "" });

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({ signal_basis: "blank-corrected", plate_id: "plate-1", source_file: "fixture.tsv" });
    expect(wells).toHaveLength(6);
    expect(wells[0]).toMatchObject({ raw_signal: 0.1, plate_id: "plate-1", source_file: "fixture.tsv" });
    expect(String(layout[2][1])).toContain("B1");
    expect(String(layout[2][1])).toContain("对照");
    expect(String(layout[3][1])).toContain("C1");
    expect(String(layout[3][1])).toContain("样本");
  });

  it("uses the displayed result as the export scope", () => {
    const plate = { ...fixturePlate(), plateId: "plate-1" };
    const full = analyzeCellViability(plate.wells, config);
    const selected = {
      ...full,
      biologicalSummaries: full.biologicalSummaries.filter((row) => row.group === "Drug"),
      technicalSummaries: full.technicalSummaries.filter((row) => row.group === "Drug"),
      annotatedWells: full.annotatedWells.filter((well) => well.group === "Drug"),
      significanceComparisons: full.significanceComparisons.filter((row) => row.group === "Drug"),
    };
    const artifact = createResultWorkbook({ plate, result: selected, analysisConfig: config, scope: "selected" });
    const workbook = XLSX.read(artifact.bytes, { type: "array" });
    const summaries = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["生物学汇总"]);
    const wells = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["孔级数据"]);
    const layout = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets["板布局"], { header: 1, defval: "" });

    expect(summaries.map((row) => row.group)).toEqual(["Drug"]);
    expect(wells.map((row) => row.group)).toEqual(["Drug", "Drug"]);
    expect(layout[2][1]).toBe("");
    expect(String(layout[3][1])).toContain("C1");
  });
});

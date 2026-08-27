import { describe, expect, it } from "vitest";
import { analyzeCck8 } from "../src/core/assays/cck8";
import { createArtifact } from "../src/core/artifacts";
import type { WellRecord, WellRole } from "../src/core/types";
import { fixturePlate } from "./fixtures/plate-fixtures";

function makeWell(
  well: string,
  rawValue: number,
  role: WellRole,
  group = "",
  biologicalReplicate = "",
  technicalReplicate = "",
): WellRecord {
  const match = well.match(/^([A-Z])(\d+)$/);
  if (!match) throw new Error("invalid test well");
  return {
    well,
    row: match[1],
    column: Number(match[2]),
    rawValue,
    instrumentLabel: role,
    role,
    sampleId: group && biologicalReplicate ? `${group}_${biologicalReplicate}` : "",
    group,
    treatment: group,
    concentration: "",
    timepoint: "Day0",
    biologicalReplicate,
    technicalReplicate,
    excluded: false,
    notes: "",
  };
}

const config = {
  controlGroup: "Vehicle",
  technicalCvThresholdPercent: 10,
  blankCvThresholdPercent: 10,
};

describe("CCK-8 analysis", () => {
  it("subtracts blank before collapsing technical replicates and normalizing to control", () => {
    const wells: WellRecord[] = [
      makeWell("H10", 0.1, "blank"),
      makeWell("H11", 0.1, "blank"),
      makeWell("H12", 0.1, "blank"),
    ];
    const correctedByGroup = {
      Vehicle: [0.2, 0.22, 0.18],
      Drug: [0.1, 0.11, 0.09],
    };
    let rowCode = 0;
    for (const [group, biologicalValues] of Object.entries(correctedByGroup)) {
      biologicalValues.forEach((correctedValue, biologicalIndex) => {
        [0.99, 1.01].forEach((technicalFactor, technicalIndex) => {
          const address = `${String.fromCharCode(65 + rowCode)}${technicalIndex + 1}`;
          wells.push(makeWell(
            address,
            0.1 + correctedValue * technicalFactor,
            group === "Vehicle" ? "control" : "sample",
            group,
            `B${biologicalIndex + 1}`,
            `T${technicalIndex + 1}`,
          ));
        });
        rowCode += 1;
      });
    }

    const result = analyzeCck8(wells, config);
    const byGroup = new Map(result.biologicalSummaries.map((summary) => [summary.group, summary]));

    expect(result.ready).toBe(true);
    expect(result.blankMean).toBeCloseTo(0.1, 12);
    expect(result.technicalSummaries).toHaveLength(6);
    expect(byGroup.get("Vehicle")).toMatchObject({ nBiological: 3, relativeActivityPercent: 100 });
    expect(byGroup.get("Drug")?.correctedMean).toBeCloseTo(0.1, 12);
    expect(byGroup.get("Drug")?.correctedSd).toBeCloseTo(0.01, 12);
    expect(byGroup.get("Drug")?.relativeActivityPercent).toBeCloseTo(50, 12);
    expect(byGroup.get("Drug")?.relativeSdPercent).toBeCloseTo(5, 12);
    expect(result.significanceComparisons).toHaveLength(1);
    expect(result.significanceComparisons[0]).toMatchObject({ group: "Drug", controlGroup: "Vehicle", nGroup: 3, nControl: 3 });
    expect(result.significanceComparisons[0].pValue).not.toBeNull();
    expect(result.significanceComparisons[0].adjustedPValue).not.toBeNull();
    expect(result.significanceComparisons[0].note).toContain("Paired t-test");
    expect(result.findings.filter((finding) => finding.severity === "error")).toEqual([]);

    const summaryCsv = createArtifact({ kind: "biological-summary", plate: fixturePlate(), result, scope: "all", analysisConfig: config }).content;
    const [headerLine, ...dataLines] = summaryCsv.split("\n");
    const headers = headerLine.split(",");
    const drugCsvRow = dataLines.find((line) => line.includes("Drug"))?.split(",");
    const value = (column: string) => drugCsvRow?.[headers.indexOf(column)];

    expect(headers).toEqual(expect.arrayContaining([
      "signal_basis", "blank_corrected_mean", "blank_corrected_sd", "blank_corrected_sem",
      "relative_to_control_percent", "relative_to_control_sd_percent", "relative_to_control_sem_percent", "normalization_reference",
    ]));
    expect(headers).not.toContain("value");
    expect(headers).not.toContain("sd");
    expect(headers).not.toContain("sem");
    expect(value("signal_basis")).toBe("blank-corrected");
    expect(Number(value("blank_corrected_mean"))).toBeCloseTo(0.1, 12);
    expect(Number(value("blank_corrected_sd"))).toBeCloseTo(0.01, 12);
    expect(Number(value("relative_to_control_percent"))).toBeCloseTo(50, 12);
    expect(Number(value("relative_to_control_sd_percent"))).toBeCloseTo(5, 12);
    expect(value("normalization_reference")).toBe("Vehicle");
  });

  it("falls back to Welch t-test when biological replicates are not matched", () => {
    const wells: WellRecord[] = [
      makeWell("H10", 0.1, "blank"),
      makeWell("H11", 0.1, "blank"),
      makeWell("H12", 0.1, "blank"),
      makeWell("A1", 0.31, "control", "Vehicle", "Vehicle_B1", "T1"),
      makeWell("A2", 0.32, "control", "Vehicle", "Vehicle_B2", "T1"),
      makeWell("B1", 0.21, "sample", "Drug", "Drug_B1", "T1"),
      makeWell("B2", 0.22, "sample", "Drug", "Drug_B2", "T1"),
    ];

    const result = analyzeCck8(wells, config);

    expect(result.significanceComparisons[0].pValue).not.toBeNull();
    expect(result.significanceComparisons[0].note).toContain("Welch t-test");
  });

  it("allows multiple biological replicates on one plate while warning about one-well-per-Bio patterns", () => {
    const wells = [
      makeWell("H10", 0.1, "blank"), makeWell("H11", 0.1, "blank"), makeWell("H12", 0.1, "blank"),
      makeWell("A1", 0.3, "control", "Vehicle", "Bio1", "T1"),
      makeWell("A2", 0.31, "control", "Vehicle", "Bio2", "T1"),
      makeWell("A3", 0.32, "control", "Vehicle", "Bio3", "T1"),
    ];
    const result = analyzeCck8(wells, config);
    expect(result.biologicalSummaries[0]).toMatchObject({ group: "Vehicle", nBiological: 3 });
    expect(result.findings.some((finding) => finding.code === "REPLICATE_STRUCTURE_REVIEW")).toBe(true);
  });

  it("blocks formal summaries when blank or experimental layout is incomplete", () => {
    const missingBlank = analyzeCck8([
      makeWell("A1", 0.2, "sample", "Drug", "B1", "T1"),
    ], config);
    expect(missingBlank.ready).toBe(false);
    expect(missingBlank.findings.some((finding) => finding.code === "BLANK_MISSING")).toBe(true);

    const missingLayout = analyzeCck8([
      makeWell("H10", 0.1, "blank"),
      makeWell("H11", 0.1, "blank"),
      makeWell("H12", 0.1, "blank"),
      makeWell("A1", 0.2, "sample"),
    ], config);
    expect(missingLayout.ready).toBe(false);
    expect(missingLayout.findings.some((finding) => finding.code === "LAYOUT_INCOMPLETE")).toBe(true);
  });
});

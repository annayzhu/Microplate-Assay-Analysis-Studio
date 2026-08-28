import { describe, expect, it } from "vitest";
import { createArtifact, parseProjectArtifact } from "../src/core/artifacts";
import { analyzeBaselineNormalization } from "../src/core/baseline-normalization";
import {
  appendPlateWorkspace,
  defaultAnalysisConfig,
  openPlateWorkspace,
  planWorkspaceImport,
  readPlateWorkspace,
  transitionPlateWorkspace,
  workspacePlates,
} from "../src/core/plate-workspace";
import type { BaselineNormalizationConfig, ParsedPlate, WellRecord } from "../src/core/types";
import { fixtureBatch, fixturePlate, fixtureWell } from "./fixtures/plate-fixtures";

const normalization: BaselineNormalizationConfig = {
  enabled: true,
  plateSelectionMode: "all",
  participatingPlateIds: [],
  baselineTimepoint: "Day 0",
  scope: "within-group",
  referenceGroup: "",
  method: "matched-replicate-ratio",
  scale: "fold",
  uncertaintyDisplay: "ci95",
};

function timepointPlate(name: string, timepoint: string, blank: number, values: Record<string, number[]>): ParsedPlate {
  const wells: WellRecord[] = [
    fixtureWell({ well: "A1", row: "A", column: 1, rawValue: blank, role: "blank" }),
    fixtureWell({ well: "A2", row: "A", column: 2, rawValue: blank, role: "blank" }),
  ];
  let cursor = 0;
  Object.entries(values).forEach(([group, replicates]) => {
    replicates.forEach((correctedMean, replicateIndex) => {
      [-0.02, 0.02].forEach((offset, technicalIndex) => {
        const rowIndex = Math.floor(cursor / 12) + 1;
        const column = cursor % 12 + 1;
        const row = String.fromCharCode(65 + rowIndex);
        wells.push(fixtureWell({
          well: `${row}${column}`,
          row,
          column,
          rawValue: blank + correctedMean + offset,
          role: group === "Control" ? "control" : "sample",
          sampleId: `${group}-B${replicateIndex + 1}`,
          group,
          timepoint,
          biologicalReplicate: `Bio${replicateIndex + 1}`,
          technicalReplicate: `T${technicalIndex + 1}`,
        }));
        cursor += 1;
      });
    });
  });
  const plate = fixturePlate(name);
  return { ...plate, metadata: { ...plate.metadata, plateName: name, sourceFileName: `${name}.tsv` }, wells };
}

function multiPlateWorkspace() {
  const day0 = timepointPlate("Plate Day 0", "Day 0", 0.1, {
    Control: [1, 1.2, 0.8],
    Drug: [1, 2, 4],
  });
  const day1 = timepointPlate("Plate Day 1", "Day 1", 0.2, {
    Control: [1.4, 1.5, 1.3],
    Drug: [2, 6, 8],
  });
  let workspace = openPlateWorkspace(planWorkspaceImport(fixtureBatch([day0, day1]), "cell-viability", true));
  workspace = transitionPlateWorkspace(workspace, {
    type: "set-analysis-config",
    config: { ...defaultAnalysisConfig, controlGroup: "Control", baselineNormalization: normalization },
    touched: true,
  });
  return workspace;
}

describe("project-level baseline normalization", () => {
  it("becomes ready after a later timepoint plate is appended from a separate import", () => {
    const day0 = timepointPlate("Plate Day 0", "Day 0", 0.1, { Control: [1, 1.2, 0.8], Drug: [1, 2, 4] });
    const day1 = timepointPlate("Plate Day 1", "Day 1", 0.2, { Control: [1.4, 1.5, 1.3], Drug: [2, 6, 8] });
    let workspace = openPlateWorkspace(planWorkspaceImport(fixtureBatch([day0]), "cell-viability", true));
    workspace = transitionPlateWorkspace(workspace, {
      type: "set-analysis-config",
      config: { ...defaultAnalysisConfig, controlGroup: "Control", baselineNormalization: normalization },
      touched: true,
    });
    workspace = appendPlateWorkspace(workspace, planWorkspaceImport(fixtureBatch([day1]), "cell-viability", true));

    const result = readPlateWorkspace(workspace).baselineNormalization;
    expect(result.status).toBe("ready");
    expect(result.normalizationReadyRows.map((row) => row.plateName)).toEqual(expect.arrayContaining(["Plate Day 0", "Plate Day 1"]));
    expect(result.normalizationReadyRows.find((row) => row.plateName === "Plate Day 1")?.blankMean).toBeCloseTo(0.2);

    const artifact = createArtifact({
      kind: "project",
      plates: workspacePlates(workspace),
      experiment: { name: "Appended time course", operator: "", date: "", notes: "" },
      activeModuleId: "cell-viability",
      analysisConfig: workspace.analysisConfig,
    });
    const restored = parseProjectArtifact(artifact.content, "appended-time-course.json");
    expect(restored.plates).toHaveLength(2);
    expect(restored.restoredAnalysisConfig?.baselineNormalization?.baselineTimepoint).toBe("Day 0");
  });

  it("blank-corrects each plate, collapses technical wells, then summarizes matched biological ratios", () => {
    const workspace = multiPlateWorkspace();
    const view = readPlateWorkspace(workspace);
    const result = view.baselineNormalization;

    expect(result.status).toBe("ready");
    expect(result.normalizationReadyRows).toHaveLength(12);
    expect(result.normalizationReadyRows.filter((row) => row.group === "Drug" && row.timepoint === "Day 1")).toHaveLength(3);
    expect(result.normalizationReadyRows.find((row) => row.plateName === "Plate Day 1")?.blankMean).toBeCloseTo(0.2);

    const baseline = result.normalizedRows.find((row) => row.group === "Drug" && row.timepoint === "Day 0");
    expect(baseline).toMatchObject({ normalizedMean: 1, normalizedSd: 0, normalizedSem: 0, method: "matched-replicate-ratio", pairingStatus: "definitional-baseline", n: 3 });
    expect(baseline?.baselineOriginalMean).toBeCloseTo(7 / 3);
    expect(baseline?.baselineOriginalSd).toBeGreaterThan(0);

    const day1 = result.normalizedRows.find((row) => row.group === "Drug" && row.timepoint === "Day 1");
    expect(day1?.normalizedMean).toBeCloseTo(7 / 3);
    expect(day1?.normalizedSd).toBeCloseTo(Math.sqrt(1 / 3));
    expect(day1?.normalizedSem).toBeCloseTo(1 / 3);
    expect(day1?.ci95Low).toBeLessThan(day1?.normalizedMean ?? 0);
    expect(day1?.ci95High).toBeGreaterThan(day1?.normalizedMean ?? 0);
    expect(result.findings.filter((finding) => finding.code === "NORMALIZATION_UNSTABLE_BASELINE")).toHaveLength(1);
  });

  it("exports explicit normalization-ready and derived normalized fields and restores settings", () => {
    const workspace = multiPlateWorkspace();
    const view = readPlateWorkspace(workspace);
    const plates = workspacePlates(workspace);
    const ready = createArtifact({ kind: "normalization-ready", plates, result: view.baselineNormalization, sourceName: "cck8-timecourse" });
    const normalized = createArtifact({ kind: "normalized-results", plates, result: view.baselineNormalization, sourceName: "cck8-timecourse" });

    expect(ready.content).toContain("blank_corrected_biological_value");
    expect(ready.content).toContain("baseline_candidate");
    expect(ready.content).toContain("group_original_mean,group_original_sd,group_original_sem,group_original_n");
    expect(ready.content).toContain("normalization_qc_status,normalization_qc_codes");
    expect(normalized.content).toContain("baseline_timepoint,normalization_method,pairing_status");
    expect(normalized.content).toContain("normalized_mean,normalized_sd,normalized_sem,propagated_se");

    const project = createArtifact({
      kind: "project",
      plates,
      experiment: { name: "CCK8 time course", operator: "", date: "", notes: "" },
      activeModuleId: "cell-viability",
      analysisConfig: workspace.analysisConfig,
    });
    const restored = parseProjectArtifact(project.content, "cck8-project.json");
    expect(restored.restoredAnalysisConfig?.baselineNormalization).toEqual(normalization);
  });

  it("falls back to ratio-of-means without fabricating a normalized SD", () => {
    let workspace = multiPlateWorkspace();
    workspace = transitionPlateWorkspace(workspace, {
      type: "set-analysis-config",
      config: {
        ...workspace.analysisConfig,
        baselineNormalization: { ...normalization, method: "ratio-of-means" },
      },
    });
    const row = readPlateWorkspace(workspace).baselineNormalization.normalizedRows.find((item) => item.group === "Drug" && item.timepoint === "Day 1");
    expect(row?.normalizedSd).toBeNull();
    expect(row?.propagatedSe).toBeGreaterThan(0);
    expect(row?.pairingStatus).toBe("paired-covariance");
    expect(row?.uncertaintyMethod).toBe("delta-method-paired-covariance");
  });

  it("propagates uncertainty when the target mean is zero", () => {
    const plates = workspacePlates(multiPlateWorkspace()).map((plate, index) => index !== 1 ? plate : {
      ...plate,
      wells: plate.wells.map((well) => well.group === "Drug"
        ? { ...well, rawValue: 0.2 + (({ Bio1: -0.2, Bio2: 0, Bio3: 0.2 } as Record<string, number>)[well.biologicalReplicate] ?? 0) + (well.technicalReplicate === "T1" ? -0.02 : 0.02) }
        : well),
    });
    let workspace = openPlateWorkspace(planWorkspaceImport(fixtureBatch(plates), "cell-viability", true));
    workspace = transitionPlateWorkspace(workspace, {
      type: "set-analysis-config",
      config: { ...defaultAnalysisConfig, baselineNormalization: { ...normalization, method: "ratio-of-means" } },
    });
    const row = readPlateWorkspace(workspace).baselineNormalization.normalizedRows.find((item) => item.group === "Drug" && item.timepoint === "Day 1");
    expect(row?.normalizedMean).toBeCloseTo(0);
    expect(row?.propagatedSe).toBeGreaterThan(0);
  });

  it("uses auto fallback only when explicit biological matching is incomplete", () => {
    const plates = workspacePlates(multiPlateWorkspace()).map((plate, index) => index !== 1 ? plate : {
      ...plate,
      wells: plate.wells.map((well) => well.group === "Drug" && well.biologicalReplicate === "Bio3"
        ? { ...well, sampleId: "Drug-BioX", biologicalReplicate: "BioX" }
        : well),
    });
    let workspace = openPlateWorkspace(planWorkspaceImport(fixtureBatch(plates), "cell-viability", true));
    workspace = transitionPlateWorkspace(workspace, {
      type: "set-analysis-config",
      config: { ...defaultAnalysisConfig, baselineNormalization: { ...normalization, method: "auto" } },
    });
    const auto = readPlateWorkspace(workspace).baselineNormalization;
    expect(auto.status).toBe("ready");
    expect(auto.normalizedRows.find((row) => row.group === "Drug" && row.timepoint === "Day 1")?.method).toBe("ratio-of-means");

    workspace = transitionPlateWorkspace(workspace, {
      type: "set-analysis-config",
      config: { ...workspace.analysisConfig, baselineNormalization: normalization },
    });
    const explicit = readPlateWorkspace(workspace).baselineNormalization;
    expect(explicit.status).toBe("blocked");
    expect(explicit.findings.some((finding) => finding.code === "NORMALIZATION_MATCHING_INCOMPLETE")).toBe(true);
  });

  it("keeps primary significance unchanged and a normalization-ready table available when the transform is off", () => {
    const enabledWorkspace = multiPlateWorkspace();
    const enabledView = readPlateWorkspace(enabledWorkspace);
    const disabledWorkspace = transitionPlateWorkspace(enabledWorkspace, {
      type: "set-analysis-config",
      config: { ...enabledWorkspace.analysisConfig, baselineNormalization: { ...normalization, enabled: false } },
    });
    const disabledView = readPlateWorkspace(disabledWorkspace);
    expect(disabledView.baselineNormalization.status).toBe("disabled");
    expect(disabledView.baselineNormalization.normalizationReadyRows).toHaveLength(12);
    expect(disabledView.analysis.significanceComparisons.map((row) => row.pValue)).toEqual(enabledView.analysis.significanceComparisons.map((row) => row.pValue));
  });

  it("labels fixed baseline scaling as ignoring denominator uncertainty", () => {
    let workspace = multiPlateWorkspace();
    workspace = transitionPlateWorkspace(workspace, {
      type: "set-analysis-config",
      config: { ...workspace.analysisConfig, baselineNormalization: { ...normalization, method: "fixed-baseline-scaling" } },
    });
    const row = readPlateWorkspace(workspace).baselineNormalization.normalizedRows.find((item) => item.group === "Drug" && item.timepoint === "Day 1");
    expect(row?.pairingStatus).toBe("fixed-reference");
    expect(row?.uncertaintyMethod).toBe("fixed-denominator-scaling");
    expect(row?.warnings.join(" ")).toMatch(/denominator uncertainty is ignored/i);
  });

  it("blocks incompatible plates while leaving primary plate analysis available", () => {
    let workspace = multiPlateWorkspace();
    const incompatible = workspacePlates(workspace).map((plate, index) => index === 1
      ? { ...plate, metadata: { ...plate.metadata, wavelengthNm: 570 } }
      : plate);
    workspace = openPlateWorkspace(planWorkspaceImport(fixtureBatch(incompatible), "cell-viability", true));
    workspace = transitionPlateWorkspace(workspace, {
      type: "set-analysis-config",
      config: { ...defaultAnalysisConfig, baselineNormalization: normalization },
    });
    const view = readPlateWorkspace(workspace);
    expect(view.analysis.biologicalSummaries.length).toBeGreaterThan(0);
    expect(view.baselineNormalization.status).toBe("blocked");
    expect(view.baselineNormalization.findings.some((finding) => finding.code === "NORMALIZATION_INCOMPATIBLE_PLATES")).toBe(true);
  });

  it("blocks an ambiguous reference baseline instead of choosing the first row", () => {
    const plates = workspacePlates(multiPlateWorkspace()).map((plate, index) => index !== 0 ? plate : {
      ...plate,
      wells: plate.wells.map((well) => well.group === "Control" && well.biologicalReplicate === "Bio3"
        ? { ...well, treatment: "Alternate" }
        : well),
    });
    let workspace = openPlateWorkspace(planWorkspaceImport(fixtureBatch(plates), "cell-viability", true));
    workspace = transitionPlateWorkspace(workspace, {
      type: "set-analysis-config",
      config: { ...defaultAnalysisConfig, baselineNormalization: { ...normalization, scope: "reference-group", referenceGroup: "Control" } },
    });
    const result = readPlateWorkspace(workspace).baselineNormalization;
    expect(result.status).toBe("blocked");
    expect(result.findings.some((finding) => finding.code === "NORMALIZATION_REFERENCE_AMBIGUOUS")).toBe(true);
  });

  it("supports percent output with a definitional baseline of 100", () => {
    let workspace = multiPlateWorkspace();
    workspace = transitionPlateWorkspace(workspace, { type: "set-analysis-config", config: { ...workspace.analysisConfig, baselineNormalization: { ...normalization, scale: "percent" } } });
    const baseline = readPlateWorkspace(workspace).baselineNormalization.normalizedRows.find((row) => row.group === "Drug" && row.timepoint === "Day 0");
    expect(baseline).toMatchObject({ normalizedMean: 100, normalizedSd: 0, normalizedSem: 0, ci95Low: 100, ci95High: 100 });
  });

  it("blocks invalid baselines, duplicate identities, and normalized export", () => {
    const invalidPlates = workspacePlates(multiPlateWorkspace()).map((plate, index) => index !== 0 ? plate : {
      ...plate,
      wells: plate.wells.map((well) => well.group === "Drug" ? { ...well, rawValue: 0.05 } : well),
    });
    let invalidWorkspace = openPlateWorkspace(planWorkspaceImport(fixtureBatch(invalidPlates), "cell-viability", true));
    invalidWorkspace = transitionPlateWorkspace(invalidWorkspace, { type: "set-analysis-config", config: { ...defaultAnalysisConfig, baselineNormalization: normalization } });
    const invalid = readPlateWorkspace(invalidWorkspace).baselineNormalization;
    expect(invalid.status).toBe("blocked");
    expect(invalid.findings.some((finding) => finding.code === "NORMALIZATION_INVALID_BASELINE")).toBe(true);
    expect(() => createArtifact({ kind: "normalized-results", plates: invalidPlates, result: invalid })).toThrow(/不能导出 normalized results/);

    const duplicatePlates = workspacePlates(multiPlateWorkspace()).map((plate, index) => index !== 1 ? plate : {
      ...plate,
      wells: plate.wells.map((well) => ({ ...well, timepoint: "Day 0" })),
    });
    let duplicateWorkspace = openPlateWorkspace(planWorkspaceImport(fixtureBatch(duplicatePlates), "cell-viability", true));
    duplicateWorkspace = transitionPlateWorkspace(duplicateWorkspace, { type: "set-analysis-config", config: { ...defaultAnalysisConfig, baselineNormalization: normalization } });
    expect(readPlateWorkspace(duplicateWorkspace).baselineNormalization.findings.some((finding) => finding.code === "NORMALIZATION_DUPLICATE_IDENTITY")).toBe(true);
  });

  it("keeps an explicit empty plate selection empty and stable across plate renaming", () => {
    let workspace = multiPlateWorkspace();
    workspace = transitionPlateWorkspace(workspace, { type: "set-analysis-config", config: { ...workspace.analysisConfig, baselineNormalization: { ...normalization, plateSelectionMode: "selected", participatingPlateIds: [] } } });
    let result = readPlateWorkspace(workspace).baselineNormalization;
    expect(result.status).toBe("blocked");
    expect(result.findings.some((finding) => finding.code === "NORMALIZATION_NO_PLATES")).toBe(true);

    const secondId = workspacePlates(workspace)[1].plateId!;
    workspace = transitionPlateWorkspace(workspace, { type: "set-analysis-config", config: { ...workspace.analysisConfig, baselineNormalization: { ...normalization, plateSelectionMode: "selected", participatingPlateIds: [secondId] } } });
    workspace = transitionPlateWorkspace(workspace, { type: "select-plate", index: 1 });
    workspace = transitionPlateWorkspace(workspace, { type: "rename-active-plate", name: "Renamed follow-up" });
    result = readPlateWorkspace(workspace).baselineNormalization;
    expect(result.config.participatingPlateIds).toEqual([secondId]);
    expect(result.normalizationReadyRows.every((row) => row.plateId === secondId)).toBe(true);
  });

  it("blocks source-plate QC errors, reference-wavelength mismatch, and baseline-only matched IDs", () => {
    const sourceErrorPlates = workspacePlates(multiPlateWorkspace()).map((plate, index) => index !== 1 ? plate : {
      ...plate,
      wells: plate.wells.map((well, wellIndex) => wellIndex === 2 ? { ...well, role: "unassigned" as const } : well),
    });
    let sourceWorkspace = openPlateWorkspace(planWorkspaceImport(fixtureBatch(sourceErrorPlates), "cell-viability", true));
    sourceWorkspace = transitionPlateWorkspace(sourceWorkspace, { type: "set-analysis-config", config: { ...defaultAnalysisConfig, baselineNormalization: normalization } });
    const sourceResult = readPlateWorkspace(sourceWorkspace).baselineNormalization;
    expect(sourceResult.status).toBe("blocked");
    expect(sourceResult.findings.some((finding) => finding.code.startsWith("NORMALIZATION_SOURCE_") && finding.severity === "error")).toBe(true);

    const wavelengthPlates = workspacePlates(multiPlateWorkspace()).map((plate, index) => index === 1 ? { ...plate, metadata: { ...plate.metadata, referenceWavelengthNm: 620 } } : plate);
    let wavelengthWorkspace = openPlateWorkspace(planWorkspaceImport(fixtureBatch(wavelengthPlates), "cell-viability", true));
    wavelengthWorkspace = transitionPlateWorkspace(wavelengthWorkspace, { type: "set-analysis-config", config: { ...defaultAnalysisConfig, baselineNormalization: normalization } });
    expect(readPlateWorkspace(wavelengthWorkspace).baselineNormalization.findings.some((finding) => finding.code === "NORMALIZATION_INCOMPATIBLE_PLATES")).toBe(true);

    const attritionPlates = workspacePlates(multiPlateWorkspace()).map((plate, index) => index !== 1 ? plate : { ...plate, wells: plate.wells.map((well) => well.group === "Drug" && well.biologicalReplicate === "Bio3" ? { ...well, excluded: true } : well) });
    let attritionWorkspace = openPlateWorkspace(planWorkspaceImport(fixtureBatch(attritionPlates), "cell-viability", true));
    attritionWorkspace = transitionPlateWorkspace(attritionWorkspace, { type: "set-analysis-config", config: { ...defaultAnalysisConfig, baselineNormalization: normalization } });
    expect(readPlateWorkspace(attritionWorkspace).baselineNormalization.findings.some((finding) => finding.code === "NORMALIZATION_MATCHING_INCOMPLETE")).toBe(true);
  });

  it("audits disabled preparation exports before pooling summaries", () => {
    const duplicatePlates = workspacePlates(multiPlateWorkspace()).map((plate, index) => index !== 1 ? plate : {
      ...plate,
      wells: plate.wells.map((well) => ({ ...well, timepoint: "Day 0" })),
    });
    let workspace = openPlateWorkspace(planWorkspaceImport(fixtureBatch(duplicatePlates), "cell-viability", true));
    workspace = transitionPlateWorkspace(workspace, {
      type: "set-analysis-config",
      config: { ...defaultAnalysisConfig, baselineNormalization: { ...normalization, enabled: false } },
    });
    const result = readPlateWorkspace(workspace).baselineNormalization;
    expect(result.status).toBe("disabled");
    expect(result.findings.some((finding) => finding.code === "NORMALIZATION_DUPLICATE_IDENTITY")).toBe(true);
    expect(result.normalizationReadyRows.every((row) => row.groupOriginalMean === null && row.groupOriginalN === 0)).toBe(true);
    const ready = createArtifact({ kind: "normalization-ready", plates: workspacePlates(workspace), result, sourceName: "disabled-review" });
    expect(ready.content).toContain("blocked,NORMALIZATION_SOURCE_BLANK_LOW_N;NORMALIZATION_DUPLICATE_IDENTITY");

    const incompatible = workspacePlates(multiPlateWorkspace()).map((plate, index) => index === 1 ? { ...plate, metadata: { ...plate.metadata, wavelengthNm: 490 } } : plate);
    const incompatibleResult = analyzeBaselineNormalization(incompatible, { ...defaultAnalysisConfig, baselineNormalization: { ...normalization, enabled: false } });
    expect(incompatibleResult.findings.some((finding) => finding.code === "NORMALIZATION_INCOMPATIBLE_PLATES")).toBe(true);
    expect(incompatibleResult.normalizationReadyRows.every((row) => row.groupOriginalMean === null)).toBe(true);
  });

  it("blocks multiple plates without stable IDs instead of merging their provenance", () => {
    const platesWithoutIds = workspacePlates(multiPlateWorkspace()).map(({ plateId: _plateId, ...plate }) => plate);
    const result = analyzeBaselineNormalization(platesWithoutIds, { ...defaultAnalysisConfig, baselineNormalization: normalization });
    expect(result.status).toBe("blocked");
    expect(result.findings.filter((finding) => finding.code === "NORMALIZATION_PLATE_ID_MISSING")).toHaveLength(2);
    expect(result.normalizationReadyRows.every((row) => row.plateId === "")).toBe(true);
  });
});

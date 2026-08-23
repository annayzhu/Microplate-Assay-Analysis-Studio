import { describe, expect, it } from "vitest";
import { createArtifact, parseProjectArtifact, projectSchemaVersion, toolIdentity } from "../src/core/artifacts";
import { parsePastedPlateReadings } from "../src/core/instruments/manual-readings";

const matrix = "读数\t1\t2\t3\nA\t0\t0.2\t0.3\nB\t0.4\t0.5\t0.6";
const config = { controlGroup: "Control", technicalCvThresholdPercent: 15, blankCvThresholdPercent: 10 };

describe("versioned reproducible artifact module", () => {
  it("round-trips raw values, annotations, assay assignment, experiment record, and parameters", () => {
    const plate = parsePastedPlateReadings(matrix, {
      assayModuleId: "cell-viability",
      assayMethodLabel: "CCK-8",
      detectionMode: "absorbance",
      signalUnit: "OD",
      wavelengthNm: 450,
    }).plates[0];
    const wells = plate.wells.map((well, index) => index === 0 ? {
      ...well,
      role: "control" as const,
      group: "Control",
      biologicalReplicate: "Bio1",
      technicalReplicate: "T1",
      notes: "confirmed",
    } : well);
    const experiment = { name: "Round trip", operator: "Researcher", date: "2026-08-22", notes: "local only" };
    const artifact = createArtifact({ kind: "project", plates: [{ ...plate, wells }], experiment, activeModuleId: "cell-viability", analysisConfig: config });
    const restored = parseProjectArtifact(artifact.content, "round-trip.json");

    expect(artifact.filename).toContain("reproducible-project.json");
    expect(JSON.parse(artifact.content)).toMatchObject({ schemaVersion: projectSchemaVersion, tool: toolIdentity });
    expect(restored.sourceKind).toBe("project-file");
    expect(restored.experiment).toEqual(experiment);
    expect(restored.restoredAnalysisConfig).toEqual(config);
    expect(restored.restoredActiveModuleId).toBe("cell-viability");
    expect(restored.plates[0].wells[0]).toMatchObject({ rawValue: 0, role: "control", group: "Control", notes: "confirmed" });
    expect(restored.plates[0].metadata).toMatchObject({ reopenedFromProjectFile: "round-trip.json", assayAssignmentDecision: "project-restored" });
  });

  it("rejects unrelated or unsupported JSON instead of guessing", () => {
    expect(() => parseProjectArtifact("{}", "empty.json")).toThrow(/版本不受支持/);
    expect(() => parseProjectArtifact("not json", "broken.json")).toThrow(/不是有效的 JSON/);
  });
});

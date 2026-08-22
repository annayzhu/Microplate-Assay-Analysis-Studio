import { describe, expect, it } from "vitest";
import {
  assayModules,
  assignmentDecision,
  detectedAssayModule,
  getAssayWorkflow,
} from "../src/core/assay-workflows";
import { parsePastedPlateReadings } from "../src/core/instruments/manual-readings";
import { assayMeasurementsCsv } from "../src/core/export";

const simpleMatrix = "吸光值\t1\t2\t3\nA\t0.1\t0.2\t0.3\nB\t0.1\t0.2\t0.3";

describe("assay workflow boundary", () => {
  it("distinguishes complete analysis, import/preview, and planned modules", () => {
    expect(getAssayWorkflow("cell-viability").status).toBe("complete");
    expect(getAssayWorkflow("protein-quant").status).toBe("preview");
    expect(getAssayWorkflow("atp-quant").status).toBe("preview");
    expect(getAssayWorkflow("luciferase").status).toBe("preview");
    expect(getAssayWorkflow("elisa").status).toBe("planned");
    expect(getAssayWorkflow("unknown")).toMatchObject({ id: "unknown", status: "preview" });
    expect(assayModules.every((module) => module.requiredInformation.length > 0)).toBe(true);
  });

  it("keeps user intent and system detection as distinct decisions", () => {
    expect(assignmentDecision("instrument-file", "protein-quant", "protein-quant", true)).toBe("matched");
    expect(assignmentDecision("instrument-file", "protein-quant", "cell-viability", true)).toBe("user-confirmed");
    expect(assignmentDecision("instrument-file", "protein-quant", "protein-quant", false)).toBe("system-detected");
    expect(assignmentDecision("manual-paste", "atp-quant", "unknown", true)).toBe("manual");
    expect(assignmentDecision("project-file", "luciferase", "luciferase", false)).toBe("project-restored");
  });

  it("does not invent a detected assay for manually entered values", () => {
    const plate = parsePastedPlateReadings(simpleMatrix, {
      assayModuleId: "protein-quant",
      assayMethodLabel: "蛋白定量",
      detectionMode: "absorbance",
      signalUnit: "OD",
      wavelengthNm: 562,
    }).plates[0];
    expect(detectedAssayModule(plate)).toBe("unknown");
    expect(plate.metadata.confirmedAssayModuleId).toBe("protein-quant");
    expect(plate.metadata.assayAssignmentDecision).toBe("manual");
  });

  it("exports confirmed assignment, provenance, and current well annotations with every measurement", () => {
    const plate = parsePastedPlateReadings(simpleMatrix, {
      assayModuleId: "protein-quant",
      assayMethodLabel: "BCA",
      detectionMode: "absorbance",
      signalUnit: "OD",
      wavelengthNm: 562,
    }).plates[0];
    const wells = plate.wells.map((well) => well.well === "A1" ? {
      ...well,
      role: "standard" as const,
      sampleId: "BSA-1",
      concentration: "125 ug/mL",
      biologicalReplicate: "Bio1",
      technicalReplicate: "T1",
    } : well);
    const csv = assayMeasurementsCsv(plate, wells);
    expect(csv.split("\n")[0]).toContain("confirmed_assay_module");
    expect(csv.split("\n")[0]).toContain("biological_replicate");
    expect(csv).toContain("protein-quant");
    expect(csv).toContain("BSA-1");
    expect(csv).toContain("125 ug/mL");
  });
});

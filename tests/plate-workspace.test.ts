import { describe, expect, it } from "vitest";
import { aggregatePlate, createPlateAggregate, replaceWellAnnotations } from "../src/core/plate-aggregate";
import {
  openPlateWorkspace,
  planWorkspaceImport,
  readPlateWorkspace,
  transitionPlateWorkspace,
  workspacePlates,
} from "../src/core/plate-workspace";
import { fixtureBatch, fixturePlate } from "./fixtures/plate-fixtures";

describe("Plate workspace acceptance scenarios", () => {
  it("opens a multi-plate batch, preserves plate-local annotations, and switches plates", () => {
    const plan = planWorkspaceImport(fixtureBatch([fixturePlate("Plate 1"), fixturePlate("Plate 2")]), "cell-viability", true);
    let workspace = openPlateWorkspace(plan);
    workspace = transitionPlateWorkspace(workspace, { type: "select-wells", wellIds: new Set(["C1", "C2"]), anchor: "C2" });
    workspace = transitionPlateWorkspace(workspace, {
      type: "update-selected-annotations",
      update: (annotation, _well, index) => ({ ...annotation, group: "Dose 10", technicalReplicate: `T${index + 1}` }),
    });
    expect(readPlateWorkspace(workspace).wells.filter((well) => well.well.startsWith("C")).map((well) => well.group)).toEqual(["Dose 10", "Dose 10"]);

    workspace = transitionPlateWorkspace(workspace, { type: "select-plate", index: 1 });
    expect(readPlateWorkspace(workspace).wells.find((well) => well.well === "C1")?.group).toBe("Drug");
    workspace = transitionPlateWorkspace(workspace, { type: "select-plate", index: 0 });
    expect(readPlateWorkspace(workspace).wells.find((well) => well.well === "C1")?.group).toBe("Dose 10");
  });

  it("uses the current summary selection for analysis and export scope", () => {
    let workspace = openPlateWorkspace(planWorkspaceImport(fixtureBatch(), "cell-viability", true));
    const first = readPlateWorkspace(workspace);
    const drug = first.analysis.biologicalSummaries.find((row) => row.group === "Drug");
    expect(drug).toBeDefined();
    workspace = transitionPlateWorkspace(workspace, { type: "toggle-summary", key: drug!.key });
    const selected = readPlateWorkspace(workspace);
    expect(selected.exportScope).toBe("selected-1rows");
    expect(selected.displayedBiologicalSummaries.map((row) => row.group)).toEqual(["Drug"]);
    expect(selected.displayedSignificanceComparisons.every((row) => row.group === "Drug")).toBe(true);
  });

  it("keeps raw measurements immutable while annotations change", () => {
    const aggregate = createPlateAggregate(fixturePlate());
    const projected = aggregatePlate(aggregate);
    projected.wells[2] = { ...projected.wells[2], rawValue: 99, notes: "changed" };
    expect(() => replaceWellAnnotations(aggregate, projected.wells)).toThrow(/不能通过孔注释修改原始读数/);
    expect(aggregatePlate(aggregate).wells[2].rawValue).toBe(0.5);
  });

  it("produces project-ready plates without exposing duplicate annotation state", () => {
    let workspace = openPlateWorkspace(planWorkspaceImport(fixtureBatch(), "cell-viability", true));
    workspace = transitionPlateWorkspace(workspace, { type: "rename-active-plate", name: "Day 1" });
    workspace = transitionPlateWorkspace(workspace, { type: "select-wells", wellIds: new Set(["C1"]), anchor: "C1" });
    workspace = transitionPlateWorkspace(workspace, { type: "update-selected-annotations", update: (annotation) => ({ ...annotation, notes: "reviewed" }) });
    const [plate] = workspacePlates(workspace);
    expect(plate.metadata.plateName).toBe("Day 1");
    expect(plate.wells.find((well) => well.well === "C1")?.notes).toBe("reviewed");
  });

  it("preserves an explicitly chosen control group while annotations are edited", () => {
    let workspace = openPlateWorkspace(planWorkspaceImport(fixtureBatch(), "cell-viability", true));
    workspace = transitionPlateWorkspace(workspace, {
      type: "set-analysis-config",
      config: { ...workspace.analysisConfig, controlGroup: "Drug" },
      touched: true,
    });
    workspace = transitionPlateWorkspace(workspace, { type: "select-wells", wellIds: new Set(["C1"]), anchor: "C1" });
    workspace = transitionPlateWorkspace(workspace, { type: "update-selected-annotations", update: (annotation) => ({ ...annotation, notes: "reviewed" }) });
    expect(workspace.analysisConfig.controlGroup).toBe("Drug");
    expect(workspace.controlGroupTouched).toBe(true);
  });
});

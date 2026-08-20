import { describe, expect, it } from "vitest";
import { applyLayoutText, layoutTemplateCsv, plateTemplateDefinitions } from "../src/core/layout";
import type { WellRecord } from "../src/core/types";

function well(address: string): WellRecord {
  const match = address.match(/^([A-Z])(\d+)$/);
  if (!match) throw new Error("invalid test well");
  return {
    well: address,
    row: match[1],
    column: Number(match[2]),
    rawValue: 0.2,
    instrumentLabel: "未知0001",
    role: "sample",
    sampleId: "",
    group: "",
    treatment: "",
    concentration: "",
    timepoint: "",
    biologicalReplicate: "",
    technicalReplicate: "",
    excluded: false,
    notes: "",
  };
}

describe("layout mapping", () => {
  it("accepts bilingual aliases, zero-padded addresses, and exclusion flags", () => {
    const layout = [
      "孔位,类型,样本,分组,处理,浓度,时间点,生物学重复,技术重复,排除,备注",
      "A01,对照,A549_NC_B1,NC,siNC,,Day0,B1,T1,否,control well",
      "A02,sample,A549_NC_B1,NC,siNC,,Day0,B1,T2,true,edge artifact",
    ].join("\n");

    const result = applyLayoutText([well("A1"), well("A2")], layout);

    expect(result.applied).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(result.wells[0]).toMatchObject({
      well: "A1",
      role: "control",
      sampleId: "A549_NC_B1",
      group: "NC",
      biologicalReplicate: "B1",
      technicalReplicate: "T1",
      excluded: false,
    });
    expect(result.wells[1]).toMatchObject({ well: "A2", excluded: true, notes: "edge artifact" });
  });

  it("reports invalid and out-of-plate addresses without mutating the source wells", () => {
    const source = [well("A1")];
    const result = applyLayoutText(source, "well,group\ninvalid,NC\nH12,Treatment");

    expect(result.applied).toBe(0);
    expect(result.warnings).toContain("第 2 行孔位无效。");
    expect(result.warnings).toContain("板图中的 H12 不在当前数据板中。");
    expect(source[0].group).toBe("");
  });

  it("skips template instructions and commented examples during import", () => {
    const layout = [
      "# 填写说明：这一行不应导入",
      "# well,role,sample_id,group,treatment,concentration,timepoint,biological_replicate,technical_replicate,excluded,notes",
      "# A1,sample,EXAMPLE,ExampleGroup,,,,B1,T1,false,示例行不应导入",
      "well,role,sample_id,group,treatment,concentration,timepoint,biological_replicate,technical_replicate,excluded,notes",
      "A1,control,A549_Mock_B1,Control,Mock,0 nM,Day0,B1,T1,false,真实数据",
    ].join("\n");

    const result = applyLayoutText([well("A1")], layout);

    expect(result.applied).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(result.wells[0]).toMatchObject({
      role: "control",
      sampleId: "A549_Mock_B1",
      group: "Control",
      notes: "真实数据",
    });
  });

  it("generates instruction-rich column-major full-plate templates with blank annotation fields", () => {
    const template = plateTemplateDefinitions.find((item) => item.id === "24");
    if (!template) throw new Error("missing 24-well template");
    const lines = layoutTemplateCsv(template).split("\n");
    const headerIndex = lines.findIndex((line) => line === "well,role,sample_id,group,treatment,concentration,timepoint,biological_replicate,technical_replicate,excluded,notes");
    const dataLines = lines.slice(headerIndex + 1);

    expect(lines.some((line) => line.includes("填写说明"))).toBe(true);
    expect(lines.some((line) => line.includes("示例行"))).toBe(true);
    expect(headerIndex).toBeGreaterThan(0);
    expect(dataLines).toHaveLength(24);
    expect(dataLines[0].startsWith("A1,")).toBe(true);
    expect(dataLines[1].startsWith("B1,")).toBe(true);
    expect(dataLines[2].startsWith("C1,")).toBe(true);
    expect(dataLines[3].startsWith("D1,")).toBe(true);
    expect(dataLines[4].startsWith("A2,")).toBe(true);
    expect(dataLines.at(-1)?.startsWith("D6,")).toBe(true);
  });
});

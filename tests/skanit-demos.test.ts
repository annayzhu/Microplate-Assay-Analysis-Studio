import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSkanitXml } from "../src/core/instruments/skanit-xml";
import { parseVarioskanLuxWorkbook } from "../src/core/instruments/varioskan-lux";

const demoDirectory = new URL("../酶标仪demo/", import.meta.url);
const describeWithDemos = fs.existsSync(demoDirectory) ? describe : describe.skip;

function bytes(name: string): ArrayBuffer {
  const buffer = fs.readFileSync(new URL(name, demoDirectory));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function xml(name: string): string {
  return fs.readFileSync(new URL(name, demoDirectory), "utf8");
}

describeWithDemos("Varioskan LUX SkanIt demo matrix (requires local vendor demos)", () => {
  it("parses ATP kinetics, reductions, and its log-log standard curve", () => {
    const name = "BioThema Super Sensitive ATP assay with Varioskan LUX (1).xlsx";
    const plate = parseVarioskanLuxWorkbook(bytes(name), name);
    expect(plate.assayData?.moduleId).toBe("atp-quant");
    expect(plate.assayData?.measurements.some((series) => series.kind === "kinetic" && series.points.length > 9000)).toBe(true);
    expect(plate.assayData?.standardCurves[0]?.concentrationTransform).toBe("logarithmic");
    expect(plate.assayData?.standardCurves[0]?.signalTransform).toBe("logarithmic");
  });

  it("parses BSA spectrum, calculated concentration, and purity", () => {
    const name = "BSA quantification and spectrum with 96-well plate and Varioskan LUX.xlsx";
    const plate = parseVarioskanLuxWorkbook(bytes(name), name);
    expect(plate.assayData?.moduleId).toBe("protein-quant");
    expect(plate.assayData?.measurements.some((series) => series.kind === "spectrum" && series.points.length > 3000)).toBe(true);
    expect(plate.assayData?.measurements.some((series) => /Concentration/.test(series.name) && series.source === "instrument-calculated")).toBe(true);
    expect(plate.assayData?.measurements.some((series) => /Purity/.test(series.name) && series.formula.includes("A260"))).toBe(true);
  });

  it("parses alamarBlue fluorescence and its linear cell-number curve", () => {
    const name = "Invitrogen alamarBlue cell viability assay with cellular titration using Varioskan LUX.xml";
    const plate = parseSkanitXml(xml(name), name);
    expect(plate.metadata.assayMethod).toBe("alamarblue");
    expect(plate.metadata.detectionMode).toBe("fluorescence");
    expect(plate.assayData?.standardCurves[0]?.concentrationTransform).toBe("linear");
    expect(plate.assayData?.standardCurves[0]?.points).toHaveLength(11);
  });

  it("parses Firefly, Renilla, ratio normalization, and standard curve", () => {
    const name = "Promega Dual-Luciferase Reporter Assay with Varioskan LUX.xlsx";
    const plate = parseVarioskanLuxWorkbook(bytes(name), name);
    expect(plate.assayData?.moduleId).toBe("luciferase");
    expect(plate.assayData?.measurements.some((series) => /Firefly/.test(series.name))).toBe(true);
    expect(plate.assayData?.measurements.some((series) => /Renilla/.test(series.name))).toBe(true);
    expect(plate.assayData?.measurements.some((series) => /normalization/i.test(series.name) && series.formula === "A / B")).toBe(true);
    expect(plate.assayData?.standardCurves).toHaveLength(1);
  });
});

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseVarioskanLuxWorkbook } from "../src/core/instruments/varioskan-lux";

const fixtureUrl = new URL("./fixtures/varioskan-lux-cck8-day0.xlsx", import.meta.url);
const describeWithFixture = existsSync(fileURLToPath(fixtureUrl)) ? describe : describe.skip;

function fixtureBytes(): ArrayBuffer {
  const buffer = readFileSync(fileURLToPath(fixtureUrl));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

describeWithFixture("Thermo Varioskan LUX SkanIt adapter (requires local real-data fixture)", () => {
  it("parses the real CCK-8 export without treating metadata as a table header", () => {
    const plate = parseVarioskanLuxWorkbook(fixtureBytes(), "varioskan-lux-cck8-day0.xlsx");

    expect(plate.metadata.adapterId).toBe("thermo-varioskan-lux:skanit-xlsx:v1");
    expect(plate.metadata.sourceExperiment).toBe("proliferation_assay_A549_day0 (1).skax");
    expect(plate.metadata.runTimestamp).toBe("2026-08-17T11:27:53+08:00");
    expect(plate.metadata.wavelengthNm).toBe(450);
    expect(plate.metadata.measurementName).toBe("吸光度 1");
    expect(plate.metadata.sheetName).toBe("吸光度 1_01");
    expect(plate.rows).toBe(8);
    expect(plate.columns).toBe(12);
    expect(plate.wells).toHaveLength(96);
  });

  it("preserves values, well addresses, instrument labels, and instrument roles", () => {
    const plate = parseVarioskanLuxWorkbook(fixtureBytes(), "varioskan-lux-cck8-day0.xlsx");
    const byWell = new Map(plate.wells.map((well) => [well.well, well]));

    expect(byWell.get("A1")).toMatchObject({ rawValue: 0.2832, instrumentLabel: "未知0001", role: "sample" });
    expect(byWell.get("E7")).toMatchObject({ rawValue: 0.2284, instrumentLabel: "质控0001", role: "qc" });
    expect(byWell.get("H12")).toMatchObject({ rawValue: 0.0965, instrumentLabel: "空白1", role: "blank" });

    expect(plate.wells.filter((well) => well.role === "sample")).toHaveLength(72);
    expect(plate.wells.filter((well) => well.role === "qc")).toHaveLength(12);
    expect(plate.wells.filter((well) => well.role === "blank")).toHaveLength(12);
    expect(plate.warnings).toEqual([]);
  });
});

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyzeCck8 } from "../src/core/assays/cck8";
import { parseVarioskanLuxWorkbook } from "../src/core/instruments/varioskan-lux";

const fixtureUrl = new URL("../tests/fixtures/varioskan-lux-cck8-day0.xlsx", import.meta.url);
if (!existsSync(fileURLToPath(fixtureUrl))) {
  console.error("Real-file validation requires the local, non-public tests/fixtures/varioskan-lux-cck8-day0.xlsx file.");
  process.exit(2);
}
const buffer = readFileSync(fileURLToPath(fixtureUrl));
const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const plate = parseVarioskanLuxWorkbook(bytes, "varioskan-lux-cck8-day0.xlsx");
const analysis = analyzeCck8(plate.wells, {
  controlGroup: "",
  technicalCvThresholdPercent: 10,
  blankCvThresholdPercent: 10,
});

const roleCounts = plate.wells.reduce<Record<string, number>>((counts, well) => {
  counts[well.role] = (counts[well.role] ?? 0) + 1;
  return counts;
}, {});

const expectedBlankMean = 0.09691666666666666;
const assertions: Array<[boolean, string]> = [
  [plate.wells.length === 96, `expected 96 wells, got ${plate.wells.length}`],
  [plate.rows === 8 && plate.columns === 12, `expected 8 x 12 plate, got ${plate.rows} x ${plate.columns}`],
  [plate.metadata.wavelengthNm === 450, `expected 450 nm, got ${plate.metadata.wavelengthNm}`],
  [roleCounts.sample === 72, `expected 72 sample wells, got ${roleCounts.sample}`],
  [roleCounts.qc === 12, `expected 12 QC wells, got ${roleCounts.qc}`],
  [roleCounts.blank === 12, `expected 12 blank wells, got ${roleCounts.blank}`],
  [analysis.blankMean !== null && Math.abs(analysis.blankMean - expectedBlankMean) < 1e-12, `unexpected blank mean ${analysis.blankMean}`],
  [analysis.blankCvPercent !== null && analysis.blankCvPercent < 0.5, `blank CV should be below 0.5%, got ${analysis.blankCvPercent}`],
  [analysis.findings.some((finding) => finding.code === "LAYOUT_INCOMPLETE"), "raw instrument file should require experimental layout before formal analysis"],
];

const failures = assertions.filter(([passed]) => !passed).map(([, message]) => message);
if (failures.length) {
  console.error(`Real-file validation failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    file: plate.metadata.sourceFileName,
    sourceExperiment: plate.metadata.sourceExperiment,
    wavelengthNm: plate.metadata.wavelengthNm,
    plate: `${plate.rows}x${plate.columns}`,
    roleCounts,
    blankMean: analysis.blankMean,
    blankCvPercent: analysis.blankCvPercent,
    formalAnalysisReady: analysis.ready,
    expectedNextStep: "apply experimental layout",
  }, null, 2));
}

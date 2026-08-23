import type { ParsedPlate, PlateImportBatch, WellRecord } from "../../src/core/types";

export function fixtureWell(overrides: Partial<WellRecord> & Pick<WellRecord, "well" | "row" | "column" | "rawValue">): WellRecord {
  return {
    instrumentLabel: "",
    role: "unassigned",
    sampleId: "",
    group: "",
    treatment: "",
    concentration: "",
    timepoint: "",
    biologicalReplicate: "",
    technicalReplicate: "",
    excluded: false,
    notes: "",
    ...overrides,
  };
}

export function fixturePlate(name = "Plate 1"): ParsedPlate {
  const wells = [
    fixtureWell({ well: "A1", row: "A", column: 1, rawValue: 0.1, role: "blank" }),
    fixtureWell({ well: "A2", row: "A", column: 2, rawValue: 0.11, role: "blank" }),
    fixtureWell({ well: "B1", row: "B", column: 1, rawValue: 0.5, role: "control", group: "Control", sampleId: "C1", biologicalReplicate: "Bio1", technicalReplicate: "T1" }),
    fixtureWell({ well: "B2", row: "B", column: 2, rawValue: 0.52, role: "control", group: "Control", sampleId: "C1", biologicalReplicate: "Bio1", technicalReplicate: "T2" }),
    fixtureWell({ well: "C1", row: "C", column: 1, rawValue: 0.8, role: "sample", group: "Drug", sampleId: "D1", biologicalReplicate: "Bio1", technicalReplicate: "T1" }),
    fixtureWell({ well: "C2", row: "C", column: 2, rawValue: 0.82, role: "sample", group: "Drug", sampleId: "D1", biologicalReplicate: "Bio1", technicalReplicate: "T2" }),
  ];
  return {
    metadata: {
      sourceKind: "manual-paste",
      sourceFileName: "fixture.tsv",
      sourceExperiment: name,
      runTimestamp: "",
      assayMethod: "cck8",
      assayMethodLabel: "CCK-8/MTT",
      assayMethodEvidence: "user-reported",
      detectionMode: "absorbance",
      signalUnit: "OD",
      wavelengthNm: 450,
      excitationWavelengthNm: null,
      emissionWavelengthNm: null,
      referenceWavelengthNm: null,
      measurementName: "Absorbance",
      plateName: name,
      plateType: "96-well",
      instrumentManufacturer: "",
      instrumentModel: "Manual",
      instrumentSerialNumber: "",
      assayId: "",
      protocolName: "",
      readDirection: "",
      measurementTimeSeconds: null,
      temperatureStartC: null,
      temperatureEndC: null,
      sheetName: name,
      adapterId: "manual:test",
      assayModuleId: "cell-viability",
      detectedAssayModuleId: "cell-viability",
    },
    rows: 8,
    columns: 12,
    wells,
    warnings: [],
  };
}

export function fixtureBatch(plates: ParsedPlate[] = [fixturePlate()]): PlateImportBatch {
  return { id: "fixture-batch", sourceKind: "manual-paste", sourceName: "fixture.tsv", plates, warnings: [] };
}

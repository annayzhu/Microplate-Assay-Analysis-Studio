export function normalizationPlate(name, timepoint, blank, values) {
  const wells = [
    { well: "A1", row: "A", column: 1, rawValue: blank, role: "blank" },
    { well: "A2", row: "A", column: 2, rawValue: blank, role: "blank" },
  ];
  let cursor = 0;
  Object.entries(values).forEach(([group, replicates]) => replicates.forEach((correctedMean, biologicalIndex) => {
    [-0.02, 0.02].forEach((offset, technicalIndex) => {
      const row = String.fromCharCode(66 + Math.floor(cursor / 12));
      const column = cursor % 12 + 1;
      wells.push({
        well: `${row}${column}`, row, column, rawValue: blank + correctedMean + offset,
        instrumentLabel: "", role: group === "Control" ? "control" : "sample",
        sampleId: `${group}-Bio${biologicalIndex + 1}`, group, treatment: "", concentration: "", timepoint,
        biologicalReplicate: `Bio${biologicalIndex + 1}`, technicalReplicate: `T${technicalIndex + 1}`,
        excluded: false, notes: "",
      });
      cursor += 1;
    });
  }));
  wells[0] = { instrumentLabel: "", sampleId: "", group: "", treatment: "", concentration: "", timepoint: "", biologicalReplicate: "", technicalReplicate: "", excluded: false, notes: "", ...wells[0] };
  wells[1] = { instrumentLabel: "", sampleId: "", group: "", treatment: "", concentration: "", timepoint: "", biologicalReplicate: "", technicalReplicate: "", excluded: false, notes: "", ...wells[1] };
  return {
    metadata: {
      sourceKind: "manual-paste", sourceFileName: `${name}.tsv`, sourceExperiment: "Browser normalization", runTimestamp: "",
      assayMethod: "cck8", assayMethodLabel: "CCK-8", assayMethodEvidence: "user-reported", detectionMode: "absorbance", signalUnit: "OD",
      wavelengthNm: 450, excitationWavelengthNm: null, emissionWavelengthNm: null, referenceWavelengthNm: null, measurementName: "Absorbance",
      plateName: name, plateType: "96-well", instrumentManufacturer: "", instrumentModel: "Manual", instrumentSerialNumber: "", assayId: "",
      protocolName: "", readDirection: "", measurementTimeSeconds: null, temperatureStartC: null, temperatureEndC: null, sheetName: name,
      adapterId: "browser:normalization", assayModuleId: "cell-viability", detectedAssayModuleId: "cell-viability", selectedAssayModuleId: "cell-viability",
      confirmedAssayModuleId: "cell-viability", assayAssignmentDecision: "project-restored",
    },
    rows: 8, columns: 12, wells, warnings: [],
  };
}

export function normalizationProject() {
  return {
    schemaVersion: 3,
    tool: { id: "microplate-assay-studio", version: "0.7.0" },
    generatedAt: new Date(0).toISOString(),
    experiment: { name: "Browser baseline normalization", operator: "", date: "", notes: "" },
    activeModuleId: "cell-viability",
    analysisConfig: { controlGroup: "Control", relativeToControlEnabled: false, technicalCvThresholdPercent: 15, blankCvThresholdPercent: 10, baselineNormalization: { enabled: false, plateSelectionMode: "all", participatingPlateIds: [], baselineTimepoint: "", scope: "within-group", referenceGroup: "", method: "auto", scale: "fold", uncertaintyDisplay: "ci95" } },
    plates: [
      normalizationPlate("Plate Day 0", "Day 0", 0.1, { Control: [1, 1.2, 0.8], Drug: [1, 2, 4] }),
      normalizationPlate("Plate Day 1", "Day 1", 0.2, { Control: [1.4, 1.5, 1.3], Drug: [2, 6, 8] }),
    ],
  };
}

import type { AssayDataset, AssayModuleId, ParsedPlate, PlateMetadata, WellRecord } from "./types";

export type WellAnnotation = Pick<WellRecord,
  | "role"
  | "sampleId"
  | "group"
  | "treatment"
  | "concentration"
  | "timepoint"
  | "biologicalReplicate"
  | "technicalReplicate"
  | "excluded"
  | "notes"
>;

type RawWell = Pick<WellRecord, "well" | "row" | "column" | "rawValue" | "instrumentLabel">;

/** Persistent plate state. Raw measurements never change; annotations are patches. */
export type PlateDocument = {
  readonly plateId?: string;
  readonly metadata: PlateMetadata;
  readonly rows: number;
  readonly columns: number;
  readonly rawWells: readonly RawWell[];
  readonly annotations: Readonly<Record<string, WellAnnotation>>;
  readonly warnings: readonly string[];
  readonly assayData?: AssayDataset;
};

const annotationKeys: Array<keyof WellAnnotation> = [
  "role", "sampleId", "group", "treatment", "concentration", "timepoint",
  "biologicalReplicate", "technicalReplicate", "excluded", "notes",
];

function annotationFromWell(well: WellRecord): WellAnnotation {
  return Object.fromEntries(annotationKeys.map((key) => [key, well[key]])) as WellAnnotation;
}

function rawWellFromWell(well: WellRecord): RawWell {
  return { well: well.well, row: well.row, column: well.column, rawValue: well.rawValue, instrumentLabel: well.instrumentLabel };
}

function cloneAssayData(dataset: AssayDataset | undefined): AssayDataset | undefined {
  if (!dataset) return undefined;
  return {
    ...dataset,
    capabilities: [...dataset.capabilities],
    measurements: dataset.measurements.map((series) => ({
      ...series,
      sourceSteps: [...series.sourceSteps],
      points: series.points.map((point) => ({ ...point })),
    })),
    standardCurves: dataset.standardCurves.map((curve) => ({ ...curve, points: curve.points.map((point) => ({ ...point })) })),
  };
}

export function createPlateDocument(plate: ParsedPlate): PlateDocument {
  return {
    plateId: plate.plateId,
    metadata: { ...plate.metadata },
    rows: plate.rows,
    columns: plate.columns,
    rawWells: plate.wells.map(rawWellFromWell),
    annotations: Object.fromEntries(plate.wells.map((well) => [well.well, annotationFromWell(well)])),
    warnings: [...plate.warnings],
    assayData: cloneAssayData(plate.assayData),
  };
}

export function documentWells(document: PlateDocument): WellRecord[] {
  return document.rawWells.map((rawWell) => ({ ...rawWell, ...document.annotations[rawWell.well] }));
}

export function projectPlate(document: PlateDocument): ParsedPlate {
  return {
    plateId: document.plateId,
    metadata: { ...document.metadata },
    rows: document.rows,
    columns: document.columns,
    wells: documentWells(document),
    warnings: [...document.warnings],
    assayData: cloneAssayData(document.assayData),
  };
}

export function replaceDocumentAnnotations(document: PlateDocument, wells: readonly WellRecord[]): PlateDocument {
  const sourceByWell = new Map(document.rawWells.map((well) => [well.well, well]));
  const nextAnnotations = { ...document.annotations };
  for (const well of wells) {
    const sourceWell = sourceByWell.get(well.well);
    if (!sourceWell) continue;
    if (well.rawValue !== sourceWell.rawValue) throw new Error(`不能通过孔注释修改原始读数：${well.well}。`);
    nextAnnotations[well.well] = annotationFromWell(well);
  }
  return { ...document, annotations: nextAnnotations };
}

export function updateDocumentAnnotations(
  document: PlateDocument,
  wellIds: ReadonlySet<string>,
  update: (annotation: WellAnnotation, well: WellRecord, index: number) => WellAnnotation,
): PlateDocument {
  const nextAnnotations = { ...document.annotations };
  let selectedIndex = 0;
  for (const rawWell of document.rawWells) {
    if (!wellIds.has(rawWell.well)) continue;
    const annotation = nextAnnotations[rawWell.well];
    const well = { ...rawWell, ...annotation };
    nextAnnotations[rawWell.well] = update({ ...annotation }, well, selectedIndex);
    selectedIndex += 1;
  }
  return { ...document, annotations: nextAnnotations };
}

export function renamePlateDocument(document: PlateDocument, name: string): PlateDocument {
  return { ...document, metadata: { ...document.metadata, plateName: name, sourceExperiment: name } };
}

export function assignDocumentAssay(document: PlateDocument, moduleId: AssayModuleId): PlateDocument {
  return {
    ...document,
    metadata: {
      ...document.metadata,
      selectedAssayModuleId: moduleId,
      confirmedAssayModuleId: moduleId,
      assayAssignmentDecision: "user-confirmed",
      confirmedAssayMethodLabel: undefined,
      assayMethodReviewDecision: undefined,
    },
  };
}

export function reviewDocumentAssayMethod(document: PlateDocument, label: string): PlateDocument {
  const confirmedLabel = label.trim();
  if (!confirmedLabel) throw new Error("确认实验方法前需要填写方法名称。");
  return {
    ...document,
    metadata: { ...document.metadata, confirmedAssayMethodLabel: confirmedLabel, assayMethodReviewDecision: "user-confirmed" },
  };
}

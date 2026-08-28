import type { AssayModuleId, ParsedPlate, WellRecord } from "./types";

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

export type PlateAggregate = {
  readonly source: ParsedPlate;
  readonly annotations: Readonly<Record<string, WellAnnotation>>;
};

const annotationKeys: Array<keyof WellAnnotation> = [
  "role",
  "sampleId",
  "group",
  "treatment",
  "concentration",
  "timepoint",
  "biologicalReplicate",
  "technicalReplicate",
  "excluded",
  "notes",
];

function annotationFromWell(well: WellRecord): WellAnnotation {
  return Object.fromEntries(annotationKeys.map((key) => [key, well[key]])) as WellAnnotation;
}

function cloneSource(plate: ParsedPlate): ParsedPlate {
  return {
    ...plate,
    metadata: { ...plate.metadata },
    wells: plate.wells.map((well) => ({ ...well })),
    warnings: [...plate.warnings],
  };
}

export function createPlateAggregate(plate: ParsedPlate): PlateAggregate {
  return {
    source: cloneSource(plate),
    annotations: Object.fromEntries(plate.wells.map((well) => [well.well, annotationFromWell(well)])),
  };
}

export function annotatedWells(aggregate: PlateAggregate): WellRecord[] {
  return aggregate.source.wells.map((sourceWell) => ({
    ...sourceWell,
    ...(aggregate.annotations[sourceWell.well] ?? annotationFromWell(sourceWell)),
  }));
}

export function aggregatePlate(aggregate: PlateAggregate): ParsedPlate {
  return {
    ...aggregate.source,
    metadata: { ...aggregate.source.metadata },
    wells: annotatedWells(aggregate),
    warnings: [...aggregate.source.warnings],
  };
}

export function replaceWellAnnotations(aggregate: PlateAggregate, wells: WellRecord[]): PlateAggregate {
  const sourceByWell = new Map(aggregate.source.wells.map((well) => [well.well, well]));
  const nextAnnotations = { ...aggregate.annotations };
  for (const well of wells) {
    const sourceWell = sourceByWell.get(well.well);
    if (!sourceWell) continue;
    if (well.rawValue !== sourceWell.rawValue) {
      throw new Error(`不能通过孔注释修改原始读数：${well.well}。`);
    }
    nextAnnotations[well.well] = annotationFromWell(well);
  }
  return { ...aggregate, annotations: nextAnnotations };
}

export function updateWellAnnotations(
  aggregate: PlateAggregate,
  wellIds: ReadonlySet<string>,
  update: (annotation: WellAnnotation, well: WellRecord, index: number) => WellAnnotation,
): PlateAggregate {
  const nextAnnotations = { ...aggregate.annotations };
  let selectedIndex = 0;
  for (const sourceWell of aggregate.source.wells) {
    if (!wellIds.has(sourceWell.well)) continue;
    const current = nextAnnotations[sourceWell.well] ?? annotationFromWell(sourceWell);
    nextAnnotations[sourceWell.well] = update({ ...current }, sourceWell, selectedIndex);
    selectedIndex += 1;
  }
  return { ...aggregate, annotations: nextAnnotations };
}

export function renamePlate(aggregate: PlateAggregate, name: string): PlateAggregate {
  return {
    ...aggregate,
    source: {
      ...aggregate.source,
      metadata: { ...aggregate.source.metadata, plateName: name, sourceExperiment: name },
    },
  };
}

export function assignPlateAssay(aggregate: PlateAggregate, moduleId: AssayModuleId): PlateAggregate {
  return {
    ...aggregate,
    source: {
      ...aggregate.source,
      metadata: {
        ...aggregate.source.metadata,
        selectedAssayModuleId: moduleId,
        confirmedAssayModuleId: moduleId,
        assayAssignmentDecision: "user-confirmed",
        confirmedAssayMethodLabel: undefined,
        assayMethodReviewDecision: undefined,
      },
    },
  };
}

export function reviewPlateAssayMethod(aggregate: PlateAggregate, label: string): PlateAggregate {
  const confirmedLabel = label.trim();
  if (!confirmedLabel) throw new Error("确认实验方法前需要填写方法名称。");
  return {
    ...aggregate,
    source: {
      ...aggregate.source,
      metadata: {
        ...aggregate.source.metadata,
        confirmedAssayMethodLabel: confirmedLabel,
        assayMethodReviewDecision: "user-confirmed",
      },
    },
  };
}

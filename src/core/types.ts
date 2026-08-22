export type DetectionMode = "absorbance" | "fluorescence" | "luminescence" | "trf" | "alpha";
export type CellViabilityMethod = "cck8" | "mtt" | "resazurin" | "alamarblue" | "unknown";
export type MetadataEvidence = "reported" | "user-reported" | "inferred" | "unknown";
export type WellRole = "unassigned" | "sample" | "control" | "qc" | "blank" | "standard";
export type PlateImportSource = "instrument-file" | "manual-paste" | "reading-template";
export type AssayStatus = "ready" | "planned";
export type AssayModuleId = "cell-viability" | "protein-quant" | "atp-quant" | "elisa" | "luciferase" | "microbial-growth" | "advanced-binding" | "unknown";
export type MeasurementKind = "endpoint" | "kinetic" | "spectrum" | "derived" | "replicate-summary";
export type MeasurementSource = "measured" | "instrument-calculated";

export type AssayModuleDefinition = {
  id: string;
  name: string;
  shortName: string;
  measurementTarget: string;
  description: string;
  detectionModes: DetectionMode[];
  status: AssayStatus;
};

export type PlateMetadata = {
  sourceKind: PlateImportSource;
  sourceFileName: string;
  sourceExperiment: string;
  runTimestamp: string;
  assayMethod: CellViabilityMethod;
  assayMethodLabel: string;
  assayMethodEvidence: MetadataEvidence;
  detectionMode: DetectionMode;
  signalUnit: string;
  wavelengthNm: number | null;
  excitationWavelengthNm: number | null;
  emissionWavelengthNm: number | null;
  referenceWavelengthNm: number | null;
  measurementName: string;
  plateName: string;
  plateType: string;
  instrumentManufacturer: string;
  instrumentModel: string;
  instrumentSerialNumber: string;
  assayId: string;
  protocolName: string;
  readDirection: string;
  measurementTimeSeconds: number | null;
  temperatureStartC: number | null;
  temperatureEndC: number | null;
  sheetName: string;
  adapterId: string;
  assayModuleId?: AssayModuleId;
  softwareVersion?: string;
};

export type PlateImportBatch = {
  id: string;
  sourceKind: PlateImportSource;
  sourceName: string;
  plates: ParsedPlate[];
  warnings: string[];
};

export type MeasurementPoint = {
  well: string;
  row: string;
  column: number;
  sampleName: string;
  group: string;
  concentration: number | null;
  concentrationUnit: string;
  value: number;
  valueType: string;
  timeSeconds: number | null;
  wavelengthNm: number | null;
  excitationWavelengthNm: number | null;
  emissionWavelengthNm: number | null;
  saturated: boolean;
  disabled: boolean;
};

export type MeasurementSeries = {
  id: string;
  name: string;
  kind: MeasurementKind;
  source: MeasurementSource;
  detectionMode: DetectionMode;
  signalUnit: string;
  wavelengthNm: number | null;
  excitationWavelengthNm: number | null;
  emissionWavelengthNm: number | null;
  formula: string;
  sourceSteps: string[];
  points: MeasurementPoint[];
};

export type StandardCurvePoint = {
  sampleName: string;
  concentration: number;
  concentrationUnit: string;
  signal: number;
  cvPercent: number | null;
  fittedSignal: number | null;
  residual: number | null;
};

export type StandardCurve = {
  id: string;
  name: string;
  fitType: string;
  concentrationTransform: "linear" | "logarithmic";
  signalTransform: "linear" | "logarithmic";
  forceThroughOrigin: boolean;
  allowExtrapolation: boolean;
  equation: string;
  rSquared: number | null;
  slope: number | null;
  intercept: number | null;
  points: StandardCurvePoint[];
};

export type AssayDataset = {
  moduleId: AssayModuleId;
  capabilities: string[];
  measurements: MeasurementSeries[];
  standardCurves: StandardCurve[];
  primaryMeasurementId: string;
};

export type WellRecord = {
  well: string;
  row: string;
  column: number;
  rawValue: number;
  instrumentLabel: string;
  role: WellRole;
  sampleId: string;
  group: string;
  treatment: string;
  concentration: string;
  timepoint: string;
  biologicalReplicate: string;
  technicalReplicate: string;
  excluded: boolean;
  notes: string;
};

export type ParsedPlate = {
  metadata: PlateMetadata;
  rows: number;
  columns: number;
  wells: WellRecord[];
  warnings: string[];
  assayData?: AssayDataset;
};

export type AnalysisConfig = {
  controlGroup: string;
  technicalCvThresholdPercent: number;
  blankCvThresholdPercent: number;
};

export type QcSeverity = "error" | "warning" | "info";
export type QcFinding = {
  code: string;
  severity: QcSeverity;
  message: string;
  wells: string[];
};

export type AnnotatedWellResult = WellRecord & {
  blankCorrectedValue: number | null;
};

export type TechnicalSummary = {
  key: string;
  sampleId: string;
  group: string;
  treatment: string;
  concentration: string;
  timepoint: string;
  biologicalReplicate: string;
  wells: string[];
  nTechnical: number;
  rawMean: number;
  rawSd: number | null;
  rawCvPercent: number | null;
  correctedMean: number;
  correctedSd: number | null;
  correctedCvPercent: number | null;
};

export type BiologicalSummary = {
  key: string;
  group: string;
  treatment: string;
  concentration: string;
  timepoint: string;
  nBiological: number;
  correctedMean: number;
  correctedSd: number | null;
  correctedSem: number | null;
  relativeActivityPercent: number | null;
  relativeSdPercent: number | null;
  relativeSemPercent: number | null;
};

export type SignificanceComparison = {
  key: string;
  contrast: string;
  group: string;
  controlGroup: string;
  treatment: string;
  concentration: string;
  timepoint: string;
  nGroup: number;
  nControl: number;
  meanDifference: number;
  statistic: number | null;
  degreesOfFreedom: number | null;
  pValue: number | null;
  adjustedPValue: number | null;
  label: string;
  note: string;
};

export type CellViabilityAnalysisResult = {
  blankMean: number | null;
  blankSd: number | null;
  blankCvPercent: number | null;
  annotatedWells: AnnotatedWellResult[];
  technicalSummaries: TechnicalSummary[];
  biologicalSummaries: BiologicalSummary[];
  significanceComparisons: SignificanceComparison[];
  findings: QcFinding[];
  ready: boolean;
};

/** Backward-compatible name for older callers; new code should use CellViabilityAnalysisResult. */
export type Cck8AnalysisResult = CellViabilityAnalysisResult;

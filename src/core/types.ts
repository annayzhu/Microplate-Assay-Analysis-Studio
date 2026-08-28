export type DetectionMode = "absorbance" | "fluorescence" | "luminescence" | "trf" | "alpha";
export type CellViabilityMethod = "cck8" | "mtt" | "resazurin" | "alamarblue" | "unknown";
export type MetadataEvidence = "reported" | "user-reported" | "inferred" | "unknown";
export type WellRole = "unassigned" | "sample" | "control" | "qc" | "blank" | "standard";
export type PlateImportSource = "instrument-file" | "manual-paste" | "reading-template" | "project-file";
export type AssayStatus = "complete" | "preview" | "planned";
export type AssayModuleId = "cell-viability" | "protein-quant" | "atp-quant" | "elisa" | "luciferase" | "microbial-growth" | "advanced-binding" | "unknown";
export type MeasurementKind = "endpoint" | "kinetic" | "spectrum" | "derived" | "replicate-summary";
export type MeasurementSource = "measured" | "instrument-calculated";

export type AssayModuleDefinition = {
  id: AssayModuleId;
  name: string;
  shortName: string;
  measurementTarget: string;
  description: string;
  detectionModes: DetectionMode[];
  status: AssayStatus;
  supportedMethods: string[];
  requiredInformation: string[];
  availableAnalyses: string[];
  deferredAnalyses: string[];
  annotationGuidance: string;
};

export type AssayAssignmentDecision = "matched" | "system-detected" | "user-confirmed" | "manual" | "project-restored";

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
  detectedAssayModuleId?: AssayModuleId;
  selectedAssayModuleId?: AssayModuleId;
  confirmedAssayModuleId?: AssayModuleId;
  assayAssignmentDecision?: AssayAssignmentDecision;
  reopenedFromProjectFile?: string;
  softwareVersion?: string;
};

export type ExperimentRecord = {
  name: string;
  operator: string;
  date: string;
  notes: string;
};

export type PlateImportBatch = {
  id: string;
  sourceKind: PlateImportSource;
  sourceName: string;
  plates: ParsedPlate[];
  warnings: string[];
  experiment?: ExperimentRecord;
  restoredAnalysisConfig?: AnalysisConfig;
  restoredActiveModuleId?: AssayModuleId;
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
  plateId?: string;
  metadata: PlateMetadata;
  rows: number;
  columns: number;
  wells: WellRecord[];
  warnings: string[];
  assayData?: AssayDataset;
};

export type AnalysisConfig = {
  controlGroup: string;
  relativeToControlEnabled?: boolean;
  technicalCvThresholdPercent: number;
  blankCvThresholdPercent: number;
  baselineNormalization?: BaselineNormalizationConfig;
};

export type BaselineNormalizationMethod = "auto" | "matched-replicate-ratio" | "ratio-of-means" | "fixed-baseline-scaling";
export type BaselineNormalizationConfig = {
  enabled: boolean;
  plateSelectionMode: "all" | "selected";
  participatingPlateIds: string[];
  baselineTimepoint: string;
  scope: "within-group" | "reference-group";
  referenceGroup: string;
  method: BaselineNormalizationMethod;
  scale: "fold" | "percent";
  uncertaintyDisplay: "sem" | "ci95";
};

export type NormalizationReadyRow = {
  plateId: string;
  plateName: string;
  sourceFileName: string;
  sampleId: string;
  group: string;
  treatment: string;
  concentration: string;
  timepoint: string;
  biologicalReplicate: string;
  nTechnical: number;
  wells: string[];
  blankMean: number;
  blankCorrectedBiologicalValue: number;
  baselineCandidate: boolean;
  groupOriginalMean: number | null;
  groupOriginalSd: number | null;
  groupOriginalSem: number | null;
  groupOriginalN: number;
};

export type NormalizedResultRow = {
  key: string;
  group: string;
  treatment: string;
  concentration: string;
  timepoint: string;
  baselineGroup: string;
  baselineTimepoint: string;
  method: Exclude<BaselineNormalizationMethod, "auto">;
  pairingStatus: "matched" | "paired-covariance" | "unpaired" | "fixed-reference" | "definitional-baseline";
  scale: "fold" | "percent";
  normalizedMean: number;
  normalizedSd: number | null;
  normalizedSem: number | null;
  propagatedSe: number | null;
  ci95Low: number | null;
  ci95High: number | null;
  n: number;
  baselineOriginalMean: number;
  baselineOriginalSd: number | null;
  baselineOriginalSem: number | null;
  baselineN: number;
  uncertaintyMethod: "replicate-ratio-sd-sem" | "delta-method-paired-covariance" | "delta-method-propagated-se" | "fixed-denominator-scaling" | "definitional-zero";
  warnings: string[];
  plateNames: string[];
  plateIds: string[];
};

export type BaselineNormalizationResult = {
  status: "disabled" | "ready" | "blocked";
  config: BaselineNormalizationConfig;
  normalizationReadyRows: NormalizationReadyRow[];
  normalizedRows: NormalizedResultRow[];
  findings: QcFinding[];
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

import { analyzeCellViability } from "./assays/cell-viability";
import { mean, sampleSd, sem, studentTCdf } from "./statistics";
import type {
  AnalysisConfig,
  BaselineNormalizationConfig,
  BaselineNormalizationMethod,
  BaselineNormalizationResult,
  BiologicalSummary,
  NormalizationReadyRow,
  NormalizedResultRow,
  ParsedPlate,
  QcFinding,
} from "./types";

export const defaultBaselineNormalizationConfig: BaselineNormalizationConfig = {
  enabled: false,
  plateSelectionMode: "all",
  participatingPlateIds: [],
  baselineTimepoint: "",
  scope: "within-group",
  referenceGroup: "",
  method: "auto",
  scale: "fold",
  uncertaintyDisplay: "ci95",
};

type SummaryGroup = {
  identity: string;
  group: string;
  treatment: string;
  concentration: string;
  timepoint: string;
  rows: NormalizationReadyRow[];
  summary: BiologicalSummary;
};

function exactGroupIdentity(row: Pick<NormalizationReadyRow, "group" | "treatment" | "concentration" | "timepoint">): string {
  return [row.group, row.treatment, row.concentration, row.timepoint].join("¦");
}

function seriesIdentity(row: Pick<NormalizationReadyRow, "group" | "treatment" | "concentration">): string {
  return [row.group, row.treatment, row.concentration].join("¦");
}

function replicateIdentity(row: Pick<NormalizationReadyRow, "group" | "treatment" | "concentration" | "timepoint" | "biologicalReplicate">): string {
  return [exactGroupIdentity(row), row.biologicalReplicate].join("¦");
}

function plateCompatibilityKey(plate: ParsedPlate): string {
  const metadata = plate.metadata;
  return [
    metadata.confirmedAssayModuleId ?? metadata.assayModuleId ?? "unknown",
    metadata.assayMethod,
    metadata.detectionMode,
    metadata.signalUnit,
    metadata.wavelengthNm ?? "",
    metadata.referenceWavelengthNm ?? "",
    metadata.excitationWavelengthNm ?? "",
    metadata.emissionWavelengthNm ?? "",
  ].join("¦");
}

function missingCompatibilityMetadata(plate: ParsedPlate): string[] {
  const metadata = plate.metadata;
  const missing: string[] = [];
  if (!metadata.confirmedAssayModuleId || metadata.confirmedAssayModuleId === "unknown") missing.push("assay module");
  if (!metadata.assayMethod || metadata.assayMethod === "unknown") missing.push("assay method");
  if (!metadata.signalUnit.trim()) missing.push("signal unit");
  if (metadata.detectionMode === "absorbance" && metadata.wavelengthNm === null) missing.push("wavelength");
  if (metadata.detectionMode === "fluorescence" && (metadata.excitationWavelengthNm === null || metadata.emissionWavelengthNm === null)) missing.push("excitation/emission wavelength");
  return missing;
}

function tCritical95(degreesOfFreedom: number): number {
  if (!Number.isFinite(degreesOfFreedom) || degreesOfFreedom <= 0) return 1.96;
  let low = 0;
  let high = 20;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (low + high) / 2;
    if (studentTCdf(middle, degreesOfFreedom) < 0.975) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function summarize(rows: NormalizationReadyRow[]): BiologicalSummary {
  const values = rows.map((row) => row.blankCorrectedBiologicalValue);
  const first = rows[0];
  return {
    key: exactGroupIdentity(first),
    group: first.group,
    treatment: first.treatment,
    concentration: first.concentration,
    timepoint: first.timepoint,
    nBiological: values.length,
    correctedMean: mean(values),
    correctedSd: sampleSd(values),
    correctedSem: sem(values),
    relativeActivityPercent: null,
    relativeSdPercent: null,
    relativeSemPercent: null,
  };
}

function blockedResult(config: BaselineNormalizationConfig, readyRows: NormalizationReadyRow[], findings: QcFinding[]): BaselineNormalizationResult {
  return { status: "blocked", config, normalizationReadyRows: readyRows, normalizedRows: [], findings };
}

function baselineFor(target: SummaryGroup, groups: SummaryGroup[], config: BaselineNormalizationConfig): SummaryGroup | undefined {
  if (config.scope === "reference-group") {
    return groups.find((candidate) => candidate.group === config.referenceGroup && candidate.timepoint === config.baselineTimepoint);
  }
  const targetSeries = seriesIdentity(target.rows[0]);
  return groups.find((candidate) => seriesIdentity(candidate.rows[0]) === targetSeries && candidate.timepoint === config.baselineTimepoint);
}

function chooseMethod(
  requested: BaselineNormalizationMethod,
  numerator: NormalizationReadyRow[],
  denominator: NormalizationReadyRow[],
): Exclude<BaselineNormalizationMethod, "auto"> {
  if (requested !== "auto") return requested;
  const numeratorIds = new Set(numerator.map((row) => row.biologicalReplicate));
  const denominatorIds = new Set(denominator.map((row) => row.biologicalReplicate));
  const complete = numerator.length > 0
    && numeratorIds.size === denominatorIds.size
    && numerator.every((row) => denominatorIds.has(row.biologicalReplicate));
  return complete ? "matched-replicate-ratio" : "ratio-of-means";
}

function scaleFactor(config: BaselineNormalizationConfig): number {
  return config.scale === "percent" ? 100 : 1;
}

function pairedCovarianceOfMeans(numerator: NormalizationReadyRow[], denominator: NormalizationReadyRow[]): number | null {
  const denominatorById = new Map(denominator.map((row) => [row.biologicalReplicate, row.blankCorrectedBiologicalValue]));
  const pairs = numerator.flatMap((row) => {
    const baselineValue = denominatorById.get(row.biologicalReplicate);
    return baselineValue === undefined ? [] : [[row.blankCorrectedBiologicalValue, baselineValue] as const];
  });
  if (pairs.length < 2 || pairs.length !== numerator.length || pairs.length !== denominator.length) return null;
  const numeratorMean = mean(pairs.map((pair) => pair[0]));
  const denominatorMean = mean(pairs.map((pair) => pair[1]));
  const sampleCovariance = pairs.reduce((total, pair) => total + (pair[0] - numeratorMean) * (pair[1] - denominatorMean), 0) / (pairs.length - 1);
  return sampleCovariance / pairs.length;
}

function addFindingOnce(findings: QcFinding[], finding: QcFinding): void {
  if (findings.some((existing) => existing.code === finding.code && existing.message === finding.message)) return;
  findings.push(finding);
}

function normalizedRow(
  target: SummaryGroup,
  baseline: SummaryGroup,
  config: BaselineNormalizationConfig,
  findings: QcFinding[],
): NormalizedResultRow | null {
  const denominator = baseline.summary.correctedMean;
  if (!Number.isFinite(denominator) || denominator <= 0) {
    addFindingOnce(findings, {
      code: "NORMALIZATION_INVALID_BASELINE",
      severity: "error",
      message: `${baseline.group} / ${baseline.timepoint} 的 blank-corrected baseline mean 必须为有限正数。`,
      wells: baseline.rows.flatMap((row) => row.wells),
    });
    return null;
  }
  const baselineSem = baseline.summary.correctedSem;
  const baselineCritical = baseline.summary.nBiological > 1 ? tCritical95(baseline.summary.nBiological - 1) : 1.96;
  if (baselineSem !== null && denominator - baselineCritical * baselineSem <= 0) {
    addFindingOnce(findings, {
      code: "NORMALIZATION_UNSTABLE_BASELINE",
      severity: "warning",
      message: `${baseline.group} / ${baseline.timepoint} 的 baseline 95% CI 包含 0；比值可能不稳定。`,
      wells: baseline.rows.flatMap((row) => row.wells),
    });
  }

  const method = chooseMethod(config.method, target.rows, baseline.rows);
  const multiplier = scaleFactor(config);
  const sameDefinitionalBaseline = target.identity === baseline.identity;
  const plateNames = [...new Set([...target.rows, ...baseline.rows].map((row) => row.plateName))];
  const plateIds = [...new Set([...target.rows, ...baseline.rows].map((row) => row.plateId))];
  const common = {
    key: target.identity,
    group: target.group,
    treatment: target.treatment,
    concentration: target.concentration,
    timepoint: target.timepoint,
    baselineGroup: baseline.group,
    baselineTimepoint: config.baselineTimepoint,
    method,
    scale: config.scale,
    baselineOriginalMean: baseline.summary.correctedMean,
    baselineOriginalSd: baseline.summary.correctedSd,
    baselineOriginalSem: baseline.summary.correctedSem,
    baselineN: baseline.summary.nBiological,
    plateNames,
    plateIds,
  } as const;

  if (sameDefinitionalBaseline) {
    return {
      ...common,
      pairingStatus: "definitional-baseline",
      normalizedMean: multiplier,
      normalizedSd: 0,
      normalizedSem: 0,
      propagatedSe: method === "ratio-of-means" ? 0 : null,
      ci95Low: multiplier,
      ci95High: multiplier,
      n: target.summary.nBiological,
      uncertaintyMethod: "definitional-zero",
      warnings: ["Derived baseline error is zero by definition; original baseline SD and SEM are retained separately."],
    };
  }

  if (method === "matched-replicate-ratio") {
    const numeratorIds = new Set(target.rows.map((row) => row.biologicalReplicate));
    const denominatorByReplicate = new Map(baseline.rows.map((row) => [row.biologicalReplicate, row]));
    const matched = target.rows.map((row) => ({ numerator: row, denominator: denominatorByReplicate.get(row.biologicalReplicate) }))
      .filter((pair): pair is { numerator: NormalizationReadyRow; denominator: NormalizationReadyRow } => Boolean(pair.denominator));
    if (matched.length !== target.rows.length || matched.length < 2 || denominatorByReplicate.size !== numeratorIds.size) {
      findings.push({
        code: "NORMALIZATION_MATCHING_INCOMPLETE",
        severity: "error",
        message: `${target.group} / ${target.timepoint} 无法按明确 biological replicate ID 完整匹配到 ${baseline.group} / ${baseline.timepoint}。`,
        wells: target.rows.flatMap((row) => row.wells),
      });
      return null;
    }
    if (matched.some((pair) => pair.denominator.blankCorrectedBiologicalValue <= 0)) {
      findings.push({ code: "NORMALIZATION_INVALID_REPLICATE_BASELINE", severity: "error", message: `${baseline.group} / ${baseline.timepoint} 存在不大于 0 的 replicate baseline。`, wells: baseline.rows.flatMap((row) => row.wells) });
      return null;
    }
    const ratios = matched.map((pair) => pair.numerator.blankCorrectedBiologicalValue / pair.denominator.blankCorrectedBiologicalValue * multiplier);
    const ratioMean = mean(ratios);
    const ratioSd = sampleSd(ratios);
    const ratioSem = sem(ratios);
    const margin = ratioSem === null ? null : tCritical95(ratios.length - 1) * ratioSem;
    return {
      ...common,
      pairingStatus: "matched",
      normalizedMean: ratioMean,
      normalizedSd: ratioSd,
      normalizedSem: ratioSem,
      propagatedSe: null,
      ci95Low: margin === null ? null : ratioMean - margin,
      ci95High: margin === null ? null : ratioMean + margin,
      n: ratios.length,
      uncertaintyMethod: "replicate-ratio-sd-sem",
      warnings: [],
    };
  }

  const ratio = target.summary.correctedMean / denominator * multiplier;
  if (method === "ratio-of-means") {
    const numeratorSem = target.summary.correctedSem;
    const covarianceOfMeans = pairedCovarianceOfMeans(target.rows, baseline.rows);
    const propagatedSe = numeratorSem === null || baselineSem === null
      ? null
      : multiplier * Math.sqrt(Math.max(0,
        (numeratorSem / denominator) ** 2
        + (target.summary.correctedMean * baselineSem / denominator ** 2) ** 2
        - 2 * target.summary.correctedMean * (covarianceOfMeans ?? 0) / denominator ** 3,
      ));
    return {
      ...common,
      pairingStatus: covarianceOfMeans === null ? "unpaired" : "paired-covariance",
      normalizedMean: ratio,
      normalizedSd: null,
      normalizedSem: null,
      propagatedSe,
      ci95Low: propagatedSe === null ? null : ratio - 1.96 * propagatedSe,
      ci95High: propagatedSe === null ? null : ratio + 1.96 * propagatedSe,
      n: target.summary.nBiological,
      uncertaintyMethod: covarianceOfMeans === null ? "delta-method-propagated-se" : "delta-method-paired-covariance",
      warnings: [covarianceOfMeans === null
        ? "Delta-method CI is approximate and assumes independent numerator and denominator means."
        : "Delta-method CI is approximate and includes covariance estimated from explicitly matched biological replicate IDs."],
    };
  }

  const scaledSd = target.summary.correctedSd === null ? null : target.summary.correctedSd / denominator * multiplier;
  const scaledSem = target.summary.correctedSem === null ? null : target.summary.correctedSem / denominator * multiplier;
  return {
    ...common,
    pairingStatus: "fixed-reference",
    normalizedMean: ratio,
    normalizedSd: scaledSd,
    normalizedSem: scaledSem,
    propagatedSe: null,
    ci95Low: scaledSem === null ? null : ratio - tCritical95(Math.max(1, target.summary.nBiological - 1)) * scaledSem,
    ci95High: scaledSem === null ? null : ratio + tCritical95(Math.max(1, target.summary.nBiological - 1)) * scaledSem,
    n: target.summary.nBiological,
    uncertaintyMethod: "fixed-denominator-scaling",
    warnings: ["Baseline mean is treated as an error-free constant; denominator uncertainty is ignored."],
  };
}

export function analyzeBaselineNormalization(plates: readonly ParsedPlate[], analysisConfig: AnalysisConfig): BaselineNormalizationResult {
  const config = { ...defaultBaselineNormalizationConfig, ...analysisConfig.baselineNormalization };
  const requestedIds = new Set(config.participatingPlateIds);
  const selected = config.plateSelectionMode === "selected"
    ? plates.filter((plate) => plate.plateId && requestedIds.has(plate.plateId))
    : [...plates];
  const findings: QcFinding[] = [];
  let normalizationReadyRows: NormalizationReadyRow[] = [];

  if (!selected.length) findings.push({ code: "NORMALIZATION_NO_PLATES", severity: "error", message: "没有选择参与 baseline normalization 的板。", wells: [] });
  selected.forEach((plate) => {
    if (!plate.plateId) findings.push({ code: "NORMALIZATION_PLATE_ID_MISSING", severity: "error", message: `${plate.metadata.plateName} 缺少稳定 plate ID；请重新载入项目后再导出或计算。`, wells: [] });
    const missing = missingCompatibilityMetadata(plate);
    if (missing.length) findings.push({ code: "NORMALIZATION_COMPATIBILITY_METADATA_MISSING", severity: "error", message: `${plate.metadata.plateName} 缺少兼容性判断所需的 ${missing.join(", ")}。`, wells: [] });
  });
  if (selected.length > 1 && new Set(selected.map(plateCompatibilityKey)).size > 1) {
    findings.push({ code: "NORMALIZATION_INCOMPATIBLE_PLATES", severity: "error", message: "所选板的 assay module、method、detection mode、signal unit 或 wavelength 不兼容。", wells: [] });
  }

  for (const plate of selected) {
    const perPlate = analyzeCellViability(plate.wells, { ...analysisConfig, controlGroup: "", baselineNormalization: undefined });
    perPlate.findings.forEach((finding) => findings.push({
      ...finding,
      code: `NORMALIZATION_SOURCE_${finding.code}`,
      severity: finding.severity,
      message: `${plate.metadata.plateName}: ${finding.message}`,
    }));
    if (perPlate.blankMean === null) {
      findings.push({ code: "NORMALIZATION_PLATE_BLANK_MISSING", severity: "error", message: `${plate.metadata.plateName} 缺少可用 blank。`, wells: [] });
      continue;
    }
    perPlate.technicalSummaries.forEach((row) => normalizationReadyRows.push({
      plateId: plate.plateId ?? "",
      plateName: plate.metadata.plateName,
      sourceFileName: plate.metadata.sourceFileName,
      sampleId: row.sampleId,
      group: row.group,
      treatment: row.treatment,
      concentration: row.concentration,
      timepoint: row.timepoint,
      biologicalReplicate: row.biologicalReplicate,
      nTechnical: row.nTechnical,
      wells: row.wells,
      blankMean: perPlate.blankMean as number,
      blankCorrectedBiologicalValue: row.correctedMean,
      baselineCandidate: row.timepoint === config.baselineTimepoint,
      groupOriginalMean: null,
      groupOriginalSd: null,
      groupOriginalSem: null,
      groupOriginalN: 0,
    }));
  }

  const duplicateIdentities = [...new Set(normalizationReadyRows.map(replicateIdentity).filter((identity, index, all) => all.indexOf(identity) !== index))];
  if (duplicateIdentities.length) {
    findings.push({ code: "NORMALIZATION_DUPLICATE_IDENTITY", severity: "error", message: "检测到重复的 group-timepoint-biological replicate identity；请先复核或按既定规则聚合。", wells: normalizationReadyRows.filter((row) => duplicateIdentities.includes(replicateIdentity(row))).flatMap((row) => row.wells) });
  }

  if (!findings.some((finding) => finding.severity === "error")) {
    const originalGroups = new Map<string, NormalizationReadyRow[]>();
    normalizationReadyRows.forEach((row) => originalGroups.set(exactGroupIdentity(row), [...(originalGroups.get(exactGroupIdentity(row)) ?? []), row]));
    const originalSummaries = new Map([...originalGroups.entries()].map(([identity, rows]) => [identity, summarize(rows)]));
    normalizationReadyRows = normalizationReadyRows.map((row) => {
      const original = originalSummaries.get(exactGroupIdentity(row));
      if (!original) return row;
      return {
        ...row,
        groupOriginalMean: original.correctedMean,
        groupOriginalSd: original.correctedSd,
        groupOriginalSem: original.correctedSem,
        groupOriginalN: original.nBiological,
      };
    });
  }

  if (!config.enabled) return { status: "disabled", config, normalizationReadyRows, normalizedRows: [], findings };
  if (!config.baselineTimepoint) findings.push({ code: "NORMALIZATION_BASELINE_REQUIRED", severity: "error", message: "请选择精确的 baseline timepoint。", wells: [] });
  if (config.scope === "reference-group" && !config.referenceGroup) findings.push({ code: "NORMALIZATION_REFERENCE_REQUIRED", severity: "error", message: "Reference-group 模式必须选择 reference group。", wells: [] });
  if (findings.some((finding) => finding.severity === "error")) return blockedResult(config, normalizationReadyRows, findings);

  const grouped = new Map<string, NormalizationReadyRow[]>();
  normalizationReadyRows.forEach((row) => grouped.set(exactGroupIdentity(row), [...(grouped.get(exactGroupIdentity(row)) ?? []), row]));
  const groups: SummaryGroup[] = [...grouped.entries()].map(([identity, rows]) => ({
    identity,
    group: rows[0].group,
    treatment: rows[0].treatment,
    concentration: rows[0].concentration,
    timepoint: rows[0].timepoint,
    rows,
    summary: summarize(rows),
  }));
  if (config.scope === "reference-group") {
    const candidates = groups.filter((candidate) => candidate.group === config.referenceGroup && candidate.timepoint === config.baselineTimepoint);
    if (candidates.length > 1) {
      findings.push({
        code: "NORMALIZATION_REFERENCE_AMBIGUOUS",
        severity: "error",
        message: `${config.referenceGroup} / ${config.baselineTimepoint} 对应多个 treatment 或 concentration；无法唯一确定 reference baseline。`,
        wells: candidates.flatMap((candidate) => candidate.rows).flatMap((row) => row.wells),
      });
      return blockedResult(config, normalizationReadyRows, findings);
    }
  }
  const normalizedRows: NormalizedResultRow[] = [];
  for (const target of groups) {
    const baseline = baselineFor(target, groups, config);
    if (!baseline) {
      findings.push({ code: "NORMALIZATION_BASELINE_MISSING", severity: "error", message: `${target.group} 缺少精确时间点 ${config.baselineTimepoint} 的 baseline。`, wells: target.rows.flatMap((row) => row.wells) });
      continue;
    }
    const row = normalizedRow(target, baseline, config, findings);
    if (row) normalizedRows.push(row);
  }
  if (findings.some((finding) => finding.severity === "error")) return blockedResult(config, normalizationReadyRows, findings);
  return { status: "ready", config, normalizationReadyRows, normalizedRows, findings };
}

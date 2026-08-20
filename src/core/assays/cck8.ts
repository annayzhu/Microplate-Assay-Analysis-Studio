import { benjaminiHochberg, cvPercent, mean, pairedTTest, sampleSd, sem, welchTTest } from "../statistics";
import type {
  AnalysisConfig,
  BiologicalSummary,
  CellViabilityAnalysisResult,
  QcFinding,
  SignificanceComparison,
  TechnicalSummary,
  WellRecord,
} from "../types";

const cellViabilityAnalyzableRoles: WellRecord["role"][] = ["sample", "control"];

function technicalKey(well: WellRecord): string {
  return [
    well.sampleId,
    well.group,
    well.treatment,
    well.concentration,
    well.timepoint,
    well.biologicalReplicate,
  ].join("¦");
}

function biologicalKey(summary: TechnicalSummary): string {
  return [summary.group, summary.treatment, summary.concentration, summary.timepoint].join("¦");
}

function displayGroup(summary: Pick<BiologicalSummary, "group" | "treatment" | "concentration" | "timepoint">): string {
  return [summary.group, summary.treatment, summary.concentration, summary.timepoint].filter(Boolean).join(" · ");
}

function significanceLabel(pValue: number | null): string {
  if (pValue === null) return "n/a";
  if (pValue < 0.001) return "***";
  if (pValue < 0.01) return "**";
  if (pValue < 0.05) return "*";
  return "ns";
}

export function analyzeCellViability(wells: WellRecord[], config: AnalysisConfig): CellViabilityAnalysisResult {
  const included = wells.filter((well) => !well.excluded);
  const blankWells = included.filter((well) => well.role === "blank");
  const blankValues = blankWells.map((well) => well.rawValue);
  const blankMean = blankValues.length ? mean(blankValues) : null;
  const blankSd = blankValues.length > 1 ? sampleSd(blankValues) : null;
  const blankCv = blankValues.length > 1 ? cvPercent(blankValues) : null;
  const findings: QcFinding[] = [];

  if (blankMean === null) {
    findings.push({ code: "BLANK_MISSING", severity: "error", message: "没有标记空白孔，无法进行背景扣除。", wells: [] });
  } else if (blankValues.length < 3) {
    findings.push({ code: "BLANK_LOW_N", severity: "warning", message: `仅有 ${blankValues.length} 个空白孔；建议至少设置 3 个。`, wells: blankWells.map((well) => well.well) });
  }
  if (blankCv !== null && blankCv > config.blankCvThresholdPercent) {
    findings.push({ code: "BLANK_CV_HIGH", severity: "warning", message: `空白孔 CV 为 ${blankCv.toFixed(2)}%，高于复核阈值 ${config.blankCvThresholdPercent.toFixed(1)}%。`, wells: blankWells.map((well) => well.well) });
  }

  const annotatedWells = wells.map((well) => ({
    ...well,
    blankCorrectedValue: blankMean === null ? null : well.rawValue - blankMean,
  }));
  const analyzable = annotatedWells.filter((well) => !well.excluded && cellViabilityAnalyzableRoles.includes(well.role));
  const unannotated = analyzable.filter((well) => !well.group || !well.biologicalReplicate);
  if (unannotated.length) {
    findings.push({
      code: "LAYOUT_INCOMPLETE",
      severity: "error",
      message: `${unannotated.length} 个样本/对照孔缺少分组或生物学重复编号；暂不生成正式汇总。`,
      wells: unannotated.map((well) => well.well),
    });
  }

  const technicalGroups = new Map<string, typeof analyzable>();
  for (const well of analyzable.filter((item) => item.blankCorrectedValue !== null && item.group && item.biologicalReplicate)) {
    const key = technicalKey(well);
    technicalGroups.set(key, [...(technicalGroups.get(key) ?? []), well]);
  }

  const technicalSummaries: TechnicalSummary[] = [...technicalGroups.entries()].map(([key, groupWells]) => {
    const rawValues = groupWells.map((well) => well.rawValue);
    const correctedValues = groupWells.map((well) => well.blankCorrectedValue as number);
    const first = groupWells[0];
    const summary: TechnicalSummary = {
      key,
      sampleId: first.sampleId,
      group: first.group,
      treatment: first.treatment,
      concentration: first.concentration,
      timepoint: first.timepoint,
      biologicalReplicate: first.biologicalReplicate,
      wells: groupWells.map((well) => well.well),
      nTechnical: groupWells.length,
      rawMean: mean(rawValues),
      rawSd: sampleSd(rawValues),
      rawCvPercent: cvPercent(rawValues),
      correctedMean: mean(correctedValues),
      correctedSd: sampleSd(correctedValues),
      correctedCvPercent: cvPercent(correctedValues),
    };
    if (summary.nTechnical < 2) {
      findings.push({ code: "TECHNICAL_REPLICATE_LOW_N", severity: "info", message: `${displayGroup(summary)} / ${summary.biologicalReplicate} 仅有 1 个技术孔。`, wells: summary.wells });
    }
    if (summary.correctedMean <= 0) {
      findings.push({ code: "NON_POSITIVE_CORRECTED", severity: "warning", message: `${displayGroup(summary)} / ${summary.biologicalReplicate} 的空白校正均值不大于 0。`, wells: summary.wells });
    } else if (summary.correctedCvPercent !== null && summary.correctedCvPercent > config.technicalCvThresholdPercent) {
      findings.push({ code: "TECHNICAL_CV_HIGH", severity: "warning", message: `${displayGroup(summary)} / ${summary.biologicalReplicate} 的技术复孔 CV 为 ${summary.correctedCvPercent.toFixed(2)}%，高于复核阈值。`, wells: summary.wells });
    }
    return summary;
  });

  const biologicalGroups = new Map<string, TechnicalSummary[]>();
  for (const summary of technicalSummaries) {
    const key = biologicalKey(summary);
    biologicalGroups.set(key, [...(biologicalGroups.get(key) ?? []), summary]);
  }
  const baseSummaries: BiologicalSummary[] = [...biologicalGroups.entries()].map(([key, summaries]) => {
    const values = summaries.map((summary) => summary.correctedMean);
    const first = summaries[0];
    return {
      key,
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
  });

  const controlByTimepoint = new Map<string, BiologicalSummary>();
  if (config.controlGroup) {
    for (const summary of baseSummaries.filter((item) => item.group === config.controlGroup)) {
      controlByTimepoint.set(summary.timepoint, summary);
    }
    if (!controlByTimepoint.size) {
      findings.push({ code: "CONTROL_GROUP_MISSING", severity: "error", message: `没有找到所选对照组“${config.controlGroup}”。`, wells: [] });
    }
  }
  const biologicalSummaries = baseSummaries.map((summary) => {
    const control = config.controlGroup ? controlByTimepoint.get(summary.timepoint) : undefined;
    if (!control || control.correctedMean <= 0) return summary;
    const scale = 100 / control.correctedMean;
    return {
      ...summary,
      relativeActivityPercent: summary.correctedMean * scale,
      relativeSdPercent: summary.correctedSd === null ? null : summary.correctedSd * scale,
      relativeSemPercent: summary.correctedSem === null ? null : summary.correctedSem * scale,
    };
  });

  for (const summary of biologicalSummaries) {
    if (summary.nBiological < 3) {
      findings.push({
        code: "BIOLOGICAL_REPLICATE_LOW_N",
        severity: "warning",
        message: `${displayGroup(summary)} 仅有 ${summary.nBiological} 个生物学重复；结果应视为描述性。`,
        wells: technicalSummaries.filter((item) => biologicalKey(item) === summary.key).flatMap((item) => item.wells),
      });
    }
  }

  const technicalByBiologicalKey = new Map<string, TechnicalSummary[]>();
  for (const summary of technicalSummaries) {
    const key = biologicalKey(summary);
    technicalByBiologicalKey.set(key, [...(technicalByBiologicalKey.get(key) ?? []), summary]);
  }

  const significanceComparisons: SignificanceComparison[] = [];
  if (config.controlGroup) {
    const controlKeysByTimepoint = new Map(
      biologicalSummaries
        .filter((summary) => summary.group === config.controlGroup)
        .map((summary) => [summary.timepoint, summary.key]),
    );
    for (const summary of biologicalSummaries.filter((item) => item.group !== config.controlGroup)) {
      const controlKey = controlKeysByTimepoint.get(summary.timepoint);
      const groupSummaries = technicalByBiologicalKey.get(summary.key) ?? [];
      const controlSummaries = controlKey ? (technicalByBiologicalKey.get(controlKey) ?? []) : [];
      const groupValues = groupSummaries.map((item) => item.correctedMean);
      const controlValues = controlSummaries.map((item) => item.correctedMean);
      const controlByBiologicalReplicate = new Map(controlSummaries.map((item) => [item.biologicalReplicate, item.correctedMean]));
      const pairedRows = groupSummaries
        .map((item) => ({ group: item.correctedMean, control: controlByBiologicalReplicate.get(item.biologicalReplicate) }))
        .filter((item): item is { group: number; control: number } => item.control !== undefined);
      const pairedTest = pairedRows.length >= 2 ? pairedTTest(pairedRows.map((item) => item.group), pairedRows.map((item) => item.control)) : null;
      const welchTest = pairedTest ? null : welchTTest(groupValues, controlValues);
      const test = pairedTest ?? welchTest;
      const methodNote = pairedTest
        ? `Paired t-test on ${pairedRows.length} matched biological replicates after technical replicate collapse.`
        : test
          ? "Welch t-test on independent biological replicate means after technical replicate collapse."
          : "需要每组至少 2 个生物学重复；若为配对设计，需要至少 2 个匹配的 biological replicate。";
      const controlSummary = controlKey ? biologicalSummaries.find((item) => item.key === controlKey) : undefined;
      significanceComparisons.push({
        key: `${summary.key}::vs::${controlKey ?? "missing-control"}`,
        contrast: `${displayGroup(summary)} vs ${config.controlGroup}`,
        group: summary.group,
        controlGroup: config.controlGroup,
        treatment: summary.treatment,
        concentration: summary.concentration,
        timepoint: summary.timepoint,
        nGroup: groupValues.length,
        nControl: controlValues.length,
        meanDifference: controlSummary ? summary.correctedMean - controlSummary.correctedMean : Number.NaN,
        statistic: test?.statistic ?? null,
        degreesOfFreedom: test?.degreesOfFreedom ?? null,
        pValue: test?.pValue ?? null,
        adjustedPValue: null,
        label: significanceLabel(test?.pValue ?? null),
        note: methodNote,
      });
    }
    const computableIndexes = significanceComparisons
      .map((comparison, index) => ({ comparison, index }))
      .filter((item) => item.comparison.pValue !== null);
    const adjusted = benjaminiHochberg(computableIndexes.map((item) => item.comparison.pValue as number));
    computableIndexes.forEach((item, index) => {
      significanceComparisons[item.index] = {
        ...significanceComparisons[item.index],
        adjustedPValue: adjusted[index],
        label: significanceLabel(adjusted[index]),
      };
    });
  }

  const ready = blankMean !== null
    && !findings.some((finding) => finding.severity === "error")
    && biologicalSummaries.length > 0;
  return {
    blankMean,
    blankSd,
    blankCvPercent: blankCv,
    annotatedWells,
    technicalSummaries,
    biologicalSummaries,
    significanceComparisons,
    findings,
    ready,
  };
}

/** Backward-compatible entry point for existing tests and integrations. */
export const analyzeCck8 = analyzeCellViability;

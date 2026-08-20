import type { BiologicalSummary } from "../core/types";

export type SummaryChartErrorMetric = "sem" | "sd";

type SummaryChartProps = {
  rows: BiologicalSummary[];
  normalized: boolean;
  compact?: boolean;
  errorMetric?: SummaryChartErrorMetric;
  yAxisLabel?: string;
};

function label(row: BiologicalSummary): string {
  return [row.group, row.concentration, row.timepoint].filter(Boolean).join(" · ");
}

function summaryValue(row: BiologicalSummary, normalized: boolean): number | null {
  return normalized ? row.relativeActivityPercent : row.correctedMean;
}

function summaryError(row: BiologicalSummary, normalized: boolean, metric: SummaryChartErrorMetric): number | null {
  if (normalized) return metric === "sd" ? row.relativeSdPercent : row.relativeSemPercent;
  return metric === "sd" ? row.correctedSd : row.correctedSem;
}

export function SummaryChart({ rows, normalized, compact = false, errorMetric = "sem", yAxisLabel = "Blank-corrected signal" }: SummaryChartProps) {
  const points = rows.map((row) => ({
    row,
    label: label(row),
    value: summaryValue(row, normalized),
    error: summaryError(row, normalized, errorMetric),
  })).filter((point): point is typeof point & { value: number } => point.value !== null && Number.isFinite(point.value));
  if (!points.length) return <div className="chart-empty">完成分组和生物学重复注释后生成汇总图。</div>;
  const width = compact ? Math.max(320, points.length * 56) : Math.max(620, points.length * 82);
  const height = compact ? 235 : 220;
  const left = compact ? 50 : 58;
  const top = compact ? 34 : 32;
  const bottom = compact ? 38 : 42;
  const plotHeight = height - top - bottom;
  const dataMaximum = Math.max(...points.map((point) => point.value + Math.max(0, point.error ?? 0)), normalized ? 100 : 0);
  const maximum = dataMaximum > 0 ? dataMaximum * 1.2 : 1;
  const y = (value: number) => top + (1 - value / maximum) * plotHeight;
  const slot = (width - left - 24) / points.length;
  const barWidth = Math.min(compact ? 30 : 42, slot * 0.58);
  const valueLabelGap = 9;
  return <div className="summary-chart">
    <div className="chart-frame">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Biological summary chart" style={{ minWidth: width }}>
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const value = maximum * fraction;
          return <g key={fraction}>
            <line x1={left} x2={width - 24} y1={y(value)} y2={y(value)} className="chart-gridline" />
            <text x={left - 8} y={y(value) + 4} textAnchor="end" className="chart-axis-text">{value >= 10 ? value.toFixed(0) : value.toFixed(2)}</text>
          </g>;
        })}
        <line x1={left} x2={left} y1={top} y2={height - bottom} className="chart-axis" />
        <line x1={left} x2={width - 24} y1={height - bottom} y2={height - bottom} className="chart-axis" />
        {points.map((point, index) => {
          const center = left + slot * (index + 0.5);
          const barTop = y(point.value);
          const error = Math.max(0, point.error ?? 0);
          const errorTopY = y(point.value + error);
          const errorBottomY = y(Math.max(0, point.value - error));
          const valueLabelY = Math.max(12, errorTopY - valueLabelGap);
          return <g key={point.row.key}>
            <title>{`${index + 1}. ${point.label}`}</title>
            <rect x={center - barWidth / 2} y={barTop} width={barWidth} height={height - bottom - barTop} rx="4" className="chart-bar" />
            {error > 0 ? <>
              <line x1={center} x2={center} y1={errorTopY} y2={errorBottomY} className="chart-error" />
              <line x1={center - 7} x2={center + 7} y1={errorTopY} y2={errorTopY} className="chart-error" />
              <line x1={center - 7} x2={center + 7} y1={errorBottomY} y2={errorBottomY} className="chart-error" />
            </> : null}
            <text x={center} y={valueLabelY} textAnchor="middle" className="chart-value">{point.value.toFixed(normalized ? 1 : 3)}</text>
            <text x={center} y={height - bottom + 18} textAnchor="middle" className="chart-index">{index + 1}</text>
          </g>;
        })}
        <text transform={`translate(16 ${top + plotHeight / 2}) rotate(-90)`} textAnchor="middle" className="chart-axis-title">{normalized ? "Relative activity (%)" : yAxisLabel}</text>
      </svg>
    </div>
    <div className="chart-label-strip" aria-label="图表标签">
      {points.map((point, index) => <span className="chart-label-chip" key={point.row.key} title={point.label}>
        <b>{index + 1}</b><span>{point.label}</span>
      </span>)}
    </div>
  </div>;
}

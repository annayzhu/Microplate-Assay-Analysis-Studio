import { useMemo, useState } from "react";
import type { AssayDataset, MeasurementPoint, MeasurementSeries, StandardCurve } from "../core/types";

const palette = ["#1d4c50", "#d88962", "#5f7565", "#8b6f92", "#b18b52", "#54758a", "#a55f59", "#64714d"];

function number(value: number | null, digits = 4): string {
  if (value === null || !Number.isFinite(value)) return "未记录";
  if (Math.abs(value) >= 10000 || (Math.abs(value) > 0 && Math.abs(value) < 0.001)) return value.toExponential(3);
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function seriesAxis(series: MeasurementSeries, point: MeasurementPoint): number | null {
  if (series.kind === "kinetic") return point.timeSeconds;
  if (series.kind === "spectrum") return point.wavelengthNm ?? point.emissionWavelengthNm ?? point.excitationWavelengthNm;
  return point.column;
}

function axisLabel(series: MeasurementSeries): string {
  if (series.kind === "kinetic") return "Time (s)";
  if (series.kind === "spectrum") return "Wavelength (nm)";
  return "Well column";
}

function LinePreview({ series }: { series: MeasurementSeries }) {
  const groups = useMemo(() => {
    const byWell = new Map<string, MeasurementPoint[]>();
    for (const point of series.points.filter((item) => !item.disabled)) {
      const items = byWell.get(point.well) ?? [];
      items.push(point);
      byWell.set(point.well, items);
    }
    return [...byWell.entries()].slice(0, 8).map(([well, points]) => ({
      well,
      points: points.map((point) => ({ x: seriesAxis(series, point), y: point.value })).filter((point): point is { x: number; y: number } => point.x !== null).sort((a, b) => a.x - b.x),
    }));
  }, [series]);
  const all = groups.flatMap((group) => group.points);
  if (!all.length) return <div className="assay-chart-empty">当前步骤没有可绘制的数值。</div>;
  const minX = Math.min(...all.map((point) => point.x));
  const maxX = Math.max(...all.map((point) => point.x));
  const minY = Math.min(...all.map((point) => point.y));
  const maxY = Math.max(...all.map((point) => point.y));
  const width = 720;
  const height = 280;
  const margin = { left: 70, right: 20, top: 18, bottom: 48 };
  const x = (value: number) => margin.left + ((value - minX) / (maxX - minX || 1)) * (width - margin.left - margin.right);
  const y = (value: number) => height - margin.bottom - ((value - minY) / (maxY - minY || 1)) * (height - margin.top - margin.bottom);
  return <div className="assay-chart-wrap">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${series.name} preview`}>
      {[0, .25, .5, .75, 1].map((fraction) => {
        const py = margin.top + fraction * (height - margin.top - margin.bottom);
        const value = maxY - fraction * (maxY - minY);
        return <g key={fraction}><line x1={margin.left} x2={width - margin.right} y1={py} y2={py} className="assay-gridline" /><text x={margin.left - 9} y={py + 4} textAnchor="end">{number(value, 2)}</text></g>;
      })}
      <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} className="assay-axis" />
      <line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} className="assay-axis" />
      <text x={margin.left} y={height - 20}>{number(minX, 1)}</text><text x={width - margin.right} y={height - 20} textAnchor="end">{number(maxX, 1)}</text>
      <text x={(margin.left + width - margin.right) / 2} y={height - 5} textAnchor="middle" className="assay-axis-title">{axisLabel(series)}</text>
      {groups.map((group, index) => <g key={group.well}>
        <polyline points={group.points.map((point) => `${x(point.x)},${y(point.y)}`).join(" ")} fill="none" stroke={palette[index % palette.length]} strokeWidth="2" />
        {group.points.length < 40 ? group.points.map((point, pointIndex) => <circle key={pointIndex} cx={x(point.x)} cy={y(point.y)} r="2.2" fill={palette[index % palette.length]} />) : null}
      </g>)}
    </svg>
    <div className="assay-chart-legend">{groups.map((group, index) => <span key={group.well}><i style={{ background: palette[index % palette.length] }} />{group.well}</span>)}</div>
    {[...new Set(series.points.map((point) => point.well))].length > 8 ? <small>图中仅预览前 8 个孔；完整数值保留在下方表格和导出文件中。</small> : null}
  </div>;
}

function StandardCurvePanel({ curve }: { curve: StandardCurve }) {
  return <section className="panel assay-curve-panel">
    <div className="panel-head compact-panel-head"><div><h3>{curve.name}</h3><p>{curve.fitType} · X {curve.concentrationTransform} / Y {curve.signalTransform}</p></div><strong>R² {number(curve.rSquared, 5)}</strong></div>
    <div className="curve-equation">{curve.equation || (curve.slope !== null ? `y = ${number(curve.slope)}x ${curve.intercept !== null && curve.intercept >= 0 ? "+" : ""} ${number(curve.intercept)}` : "仪器未导出方程")}</div>
    <div className="table-scroll compact"><table><thead><tr><th>标准品</th><th>浓度</th><th>信号</th><th>CV %</th><th>拟合值</th><th>残差</th></tr></thead><tbody>{curve.points.map((point, index) => <tr key={`${point.sampleName}-${index}`}><td>{point.sampleName || `Standard ${index + 1}`}</td><td>{number(point.concentration)} {point.concentrationUnit}</td><td>{number(point.signal)}</td><td>{number(point.cvPercent)}</td><td>{number(point.fittedSignal)}</td><td>{number(point.residual)}</td></tr>)}</tbody></table></div>
  </section>;
}

export function AssayDataExplorer({ dataset, onExport, onExportProject }: { dataset: AssayDataset; onExport: () => void; onExportProject?: () => void }) {
  const initialId = dataset.primaryMeasurementId || dataset.measurements[0]?.id || "";
  const [selectedId, setSelectedId] = useState(initialId);
  const selected = dataset.measurements.find((item) => item.id === selectedId) ?? dataset.measurements[0];
  const displayedPoints = selected?.points.filter((point) => !point.disabled).slice(0, 300) ?? [];
  const uniqueWells = new Set(selected?.points.map((point) => point.well) ?? []).size;
  if (!selected) return <div className="empty-state">文件中没有可展示的测量结果。</div>;
  return <div className="assay-explorer">
    <div className="assay-capabilities">{dataset.capabilities.map((capability) => <span key={capability}>{capability}</span>)}</div>
    <section className="panel assay-step-panel">
      <div className="panel-head assay-step-head"><div><h3>测量与计算步骤</h3><p>Measured 为仪器原始读数；Calculated 为 SkanIt 计算结果。两者分别保留。</p></div><div className="assay-export-actions"><button type="button" className="secondary-button mini" onClick={onExport}>导出全部长表 CSV</button>{onExportProject ? <button type="button" className="secondary-button mini" onClick={onExportProject}>保存可复现项目</button> : null}</div></div>
      <div className="assay-step-controls"><label><span>当前步骤</span><select value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>{dataset.measurements.map((measurement) => <option key={measurement.id} value={measurement.id}>{measurement.source === "measured" ? "Measured" : "Calculated"} · {measurement.name}</option>)}</select></label><div><span>{selected.kind}</span><strong>{uniqueWells} wells · {selected.points.length} points</strong><small>{selected.signalUnit}{selected.formula ? ` · ${selected.formula}` : ""}</small></div></div>
    </section>
    <div className="assay-result-grid">
      <section className="panel assay-preview-panel"><div className="panel-head compact-panel-head"><div><h3>{selected.name}</h3><p>{selected.source === "measured" ? "仪器测量" : "仪器计算"} · {selected.detectionMode} · {selected.signalUnit}</p></div></div><LinePreview series={selected} /></section>
      <section className="panel assay-data-panel"><div className="panel-head compact-panel-head"><div><h3>结果明细</h3><p>当前步骤最多预览 300 行；导出文件包含全部结果。</p></div></div><div className="table-scroll"><table><thead><tr><th>Well</th><th>Sample</th><th>Group</th><th>Conc.</th><th>Time s</th><th>λ nm</th><th>Value</th><th>Type</th></tr></thead><tbody>{displayedPoints.map((point, index) => <tr key={`${point.well}-${index}`}><td>{point.well}</td><td>{point.sampleName || "未记录"}</td><td>{point.group || "未记录"}</td><td>{point.concentration === null ? "未记录" : `${number(point.concentration)} ${point.concentrationUnit}`}</td><td>{number(point.timeSeconds, 2)}</td><td>{number(point.wavelengthNm ?? point.emissionWavelengthNm ?? point.excitationWavelengthNm, 1)}</td><td>{number(point.value)}</td><td>{point.valueType}</td></tr>)}</tbody></table></div></section>
    </div>
    {dataset.standardCurves.map((curve) => <StandardCurvePanel key={curve.id} curve={curve} />)}
    <div className="method-note assay-provenance-note"><strong>结果解释边界</strong><p>标准曲线、浓度、峰值、背景扣除和通道比值均优先展示 SkanIt 已导出的结果与公式；本工具不在缺少原始协议参数时擅自替换仪器算法。若要进行组间显著性检验，需补充真实独立的生物学重复；同一板可以包含多个独立 Bio，但每个 Bio 内的技术复孔不能作为独立 n。</p>{onExportProject ? <small>“可复现项目”用于以后恢复原始读数、注释、模块确认和参数；常规结果交换请优先使用 CSV。</small> : null}</div>
  </div>;
}

import type { WellRecord } from "../core/types";

function mixColor(start: string, end: string, ratio: number): string {
  const startRgb = start.match(/\w\w/g)?.map((part) => Number.parseInt(part, 16)) ?? [255, 255, 255];
  const endRgb = end.match(/\w\w/g)?.map((part) => Number.parseInt(part, 16)) ?? [255, 255, 255];
  const mixed = startRgb.map((channel, index) => Math.round(channel + (endRgb[index] - channel) * ratio));
  return `rgb(${mixed[0]} ${mixed[1]} ${mixed[2]})`;
}

function valueColor(value: number, minimum: number, maximum: number): string {
  const ratio = maximum === minimum ? 0.5 : Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  if (ratio < 0.55) return mixColor("#f7f2ed", "#d7e8df", ratio / 0.55);
  return mixColor("#d7e8df", "#dda278", (ratio - 0.55) / 0.45);
}

export function PlateMap({ wells, selected, onToggle, plateRows, plateColumns, signalLabel = "原始读数" }: {
  wells: WellRecord[];
  selected: Set<string>;
  onToggle: (well: string, mode: "single" | "toggle" | "range") => void;
  plateRows?: number;
  plateColumns?: number;
  signalLabel?: string;
}) {
  const rowLabels = plateRows
    ? Array.from({ length: plateRows }, (_, index) => String.fromCharCode(65 + index))
    : [...new Set(wells.map((well) => well.row))];
  const columns = plateColumns
    ? Array.from({ length: plateColumns }, (_, index) => index + 1)
    : [...new Set(wells.map((well) => well.column))].sort((a, b) => a - b);
  const values = wells.map((well) => well.rawValue);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const byWell = new Map(wells.map((well) => [well.well, well]));
  return <div className="plate-scroll">
    <div className="plate-grid" style={{ gridTemplateColumns: `32px repeat(${columns.length}, minmax(var(--ln-plate-cell-min-width), 1fr))` }}>
      <span />
      {columns.map((column) => <span className="plate-column" key={column}>{column}</span>)}
      {rowLabels.flatMap((row) => [
        <span className="plate-row" key={`${row}-label`}>{row}</span>,
        ...columns.map((column) => {
          const well = byWell.get(`${row}${column}`);
          if (!well) return <span key={`${row}${column}`} />;
          const isSelected = selected.has(well.well);
          return <button
            type="button"
            key={well.well}
            className={`well well-${well.role}${isSelected ? " selected" : ""}${well.excluded ? " excluded" : ""}`}
            style={{ backgroundColor: valueColor(well.rawValue, minimum, maximum) }}
            aria-pressed={isSelected}
            aria-label={`${well.well}, ${well.rawValue.toFixed(4)}, ${well.role}, ${well.group || "未分组"}`}
            title={`${well.well} · ${signalLabel} ${well.rawValue.toLocaleString(undefined, { maximumFractionDigits: 4 })} · ${well.instrumentLabel || "无标签"}`}
            onClick={(event) => onToggle(well.well, event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "single")}
          >
            <strong>{Math.abs(well.rawValue) >= 100 ? well.rawValue.toFixed(0) : well.rawValue.toFixed(3)}</strong>
            <small>{well.group || well.instrumentLabel || "—"}</small>
          </button>;
        }),
      ])}
    </div>
  </div>;
}

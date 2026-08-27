import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { WellRecord } from "../core/types";

type SelectionBox = { left: number; top: number; width: number; height: number };
type PointerSession = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWell: string | null;
  originalSelection: Set<string>;
  additive: boolean;
  shiftKey: boolean;
  dragging: boolean;
};

const dragThresholdPx = 5;

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

function intersects(rect: DOMRect, left: number, top: number, right: number, bottom: number): boolean {
  return rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom;
}

function rectangularSelection(wells: WellRecord[], anchor: string, target: string): Set<string> {
  const rowOrder = [...new Set(wells.map((record) => record.row))];
  const rowIndex = new Map(rowOrder.map((row, index) => [row, index]));
  const anchorWell = wells.find((record) => record.well === anchor);
  const targetWell = wells.find((record) => record.well === target);
  if (!anchorWell || !targetWell) return new Set([target]);
  const startRow = Math.min(rowIndex.get(anchorWell.row) ?? 0, rowIndex.get(targetWell.row) ?? 0);
  const endRow = Math.max(rowIndex.get(anchorWell.row) ?? 0, rowIndex.get(targetWell.row) ?? 0);
  const startColumn = Math.min(anchorWell.column, targetWell.column);
  const endColumn = Math.max(anchorWell.column, targetWell.column);
  return new Set(wells.filter((record) => {
    const currentRow = rowIndex.get(record.row) ?? -1;
    return currentRow >= startRow && currentRow <= endRow && record.column >= startColumn && record.column <= endColumn;
  }).map((record) => record.well));
}

function lastSelectedWell(wells: WellRecord[], selected: ReadonlySet<string>): string | null {
  for (let index = wells.length - 1; index >= 0; index -= 1) {
    if (selected.has(wells[index].well)) return wells[index].well;
  }
  return null;
}

export function PlateMap({
  wells,
  selected,
  selectionAnchor,
  onSelectionChange,
  plateRows,
  plateColumns,
  signalLabel = "原始读数",
  zoom,
  autoFitEnabled,
  onAutoFit,
}: {
  wells: WellRecord[];
  selected: ReadonlySet<string>;
  selectionAnchor: string | null;
  onSelectionChange: (next: Set<string>, anchor: string | null) => void;
  plateRows?: number;
  plateColumns?: number;
  signalLabel?: string;
  zoom: number;
  autoFitEnabled: boolean;
  onAutoFit: (zoom: number) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const pointerSessionRef = useRef<PointerSession | null>(null);
  const lastPointerTypeRef = useRef("");
  const previousZoomRef = useRef(zoom);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const rowLabels = plateRows
    ? Array.from({ length: plateRows }, (_, index) => String.fromCharCode(65 + index))
    : [...new Set(wells.map((well) => well.row))];
  const columns = plateColumns
    ? Array.from({ length: plateColumns }, (_, index) => index + 1)
    : [...new Set(wells.map((well) => well.column))].sort((a, b) => a - b);
  const values = wells.map((well) => well.rawValue);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const byWell = useMemo(() => new Map(wells.map((well) => [well.well, well])), [wells]);
  const scaledWidth = canvasSize.width * zoom;
  const scaledHeight = canvasSize.height * zoom;
  const stageWidth = Math.max(viewportSize.width, scaledWidth);
  const stageHeight = Math.max(viewportSize.height, scaledHeight);
  const canvasLeft = Math.max(0, (stageWidth - scaledWidth) / 2);
  const canvasTop = Math.max(0, (stageHeight - scaledHeight) / 2);

  useEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return;
    const updateSize = () => {
      setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
      setCanvasSize({ width: canvas.offsetWidth, height: canvas.offsetHeight });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [columns.length, rowLabels.length]);

  useEffect(() => {
    if (!autoFitEnabled || !canvasSize.width || !viewportSize.width) return;
    const fit = Math.max(0.5, Math.min(1, Math.floor((viewportSize.width / canvasSize.width) * 10) / 10));
    if (Math.abs(fit - zoom) >= 0.01) onAutoFit(fit);
  }, [autoFitEnabled, canvasSize.width, onAutoFit, viewportSize.width, zoom]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const previousZoom = previousZoomRef.current;
    if (!viewport || previousZoom === zoom || !canvasSize.width || !canvasSize.height) return;
    const previousScaledWidth = canvasSize.width * previousZoom;
    const previousScaledHeight = canvasSize.height * previousZoom;
    const previousStageWidth = Math.max(viewportSize.width, previousScaledWidth);
    const previousStageHeight = Math.max(viewportSize.height, previousScaledHeight);
    const previousLeft = Math.max(0, (previousStageWidth - previousScaledWidth) / 2);
    const previousTop = Math.max(0, (previousStageHeight - previousScaledHeight) / 2);
    const centerX = (viewport.scrollLeft + viewport.clientWidth / 2 - previousLeft) / previousZoom;
    const centerY = (viewport.scrollTop + viewport.clientHeight / 2 - previousTop) / previousZoom;
    viewport.scrollLeft = Math.max(0, canvasLeft + centerX * zoom - viewport.clientWidth / 2);
    viewport.scrollTop = Math.max(0, canvasTop + centerY * zoom - viewport.clientHeight / 2);
    previousZoomRef.current = zoom;
  }, [canvasLeft, canvasSize.height, canvasSize.width, canvasTop, viewportSize.height, viewportSize.width, zoom]);

  function selectionFromDrag(clientX: number, clientY: number, session: PointerSession): Set<string> {
    const canvas = canvasRef.current;
    if (!canvas) return session.originalSelection;
    const left = Math.min(session.startClientX, clientX);
    const right = Math.max(session.startClientX, clientX);
    const top = Math.min(session.startClientY, clientY);
    const bottom = Math.max(session.startClientY, clientY);
    const next = session.additive ? new Set(session.originalSelection) : new Set<string>();
    canvas.querySelectorAll<HTMLElement>(".well[data-well]").forEach((element) => {
      if (intersects(element.getBoundingClientRect(), left, top, right, bottom)) next.add(element.dataset.well ?? "");
    });
    next.delete("");
    return next;
  }

  function updateSelectionBox(clientX: number, clientY: number, session: PointerSession) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    setSelectionBox({
      left: (Math.min(session.startClientX, clientX) - canvasRect.left) / zoom,
      top: (Math.min(session.startClientY, clientY) - canvasRect.top) / zoom,
      width: Math.abs(clientX - session.startClientX) / zoom,
      height: Math.abs(clientY - session.startClientY) / zoom,
    });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    lastPointerTypeRef.current = event.pointerType;
    if (event.button !== 0 || event.pointerType === "touch") return;
    const target = event.target as HTMLElement;
    const startWell = target.closest<HTMLElement>(".well[data-well]")?.dataset.well ?? null;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerSessionRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWell,
      originalSelection: new Set(selected),
      additive: event.metaKey || event.ctrlKey,
      shiftKey: event.shiftKey,
      dragging: false,
    };
  }

  function selectOneWell(well: string, baseSelection: ReadonlySet<string>, additive: boolean, shiftKey: boolean) {
    if (shiftKey) {
      const anchor = selectionAnchor && wells.some((record) => record.well === selectionAnchor) ? selectionAnchor : well;
      onSelectionChange(rectangularSelection(wells, anchor, well), selectionAnchor ?? well);
    } else if (additive) {
      const next = new Set(baseSelection);
      if (next.has(well)) next.delete(well);
      else next.add(well);
      onSelectionChange(next, next.size ? well : null);
    } else {
      const shouldClear = baseSelection.size === 1 && baseSelection.has(well);
      onSelectionChange(shouldClear ? new Set() : new Set([well]), shouldClear ? null : well);
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const session = pointerSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - session.startClientX, event.clientY - session.startClientY);
    if (!session.dragging && distance < dragThresholdPx) return;
    session.dragging = true;
    updateSelectionBox(event.clientX, event.clientY, session);
    const next = selectionFromDrag(event.clientX, event.clientY, session);
    const anchor = lastSelectedWell(wells, next);
    onSelectionChange(next, anchor);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const session = pointerSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (session.dragging) {
      const next = selectionFromDrag(event.clientX, event.clientY, session);
      const anchor = lastSelectedWell(wells, next);
      onSelectionChange(next, anchor);
    } else if (session.startWell) {
      const well = session.startWell;
      selectOneWell(well, session.originalSelection, session.additive, session.shiftKey);
      canvasRef.current?.querySelector<HTMLElement>(`.well[data-well="${well}"]`)?.focus();
    } else {
      onSelectionChange(new Set(), null);
    }
    setSelectionBox(null);
    pointerSessionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const session = pointerSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    onSelectionChange(session.originalSelection, selectionAnchor);
    setSelectionBox(null);
    pointerSessionRef.current = null;
  }

  return <div className="plate-scroll" ref={viewportRef} data-zoom={Math.round(zoom * 100)}>
    <div
      className={`plate-stage${selectionBox ? " selecting" : ""}`}
      style={{ width: stageWidth || undefined, height: stageHeight || undefined }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div
        className={`plate-canvas${zoom <= 0.7 ? " low-detail" : ""}`}
        ref={canvasRef}
        style={{ left: canvasLeft, top: canvasTop, transform: `scale(${zoom})` }}
      >
        <div className="plate-grid" role="grid" aria-label={`${plateRows ?? rowLabels.length} 行 ${plateColumns ?? columns.length} 列孔板`} style={{ gridTemplateColumns: `32px repeat(${columns.length}, var(--ln-plate-cell-min-width))` }}>
          <span />
          {columns.map((column) => <span className="plate-column" key={column}>{column}</span>)}
          {rowLabels.flatMap((row) => [
            <span className="plate-row" key={`${row}-label`}>{row}</span>,
            ...columns.map((column) => {
              const well = byWell.get(`${row}${column}`);
              if (!well) return <span className="well-placeholder" key={`${row}${column}`} />;
              const isSelected = selected.has(well.well);
              return <button
                type="button"
                key={well.well}
                data-well={well.well}
                className={`well well-${well.role}${isSelected ? " selected" : ""}${well.excluded ? " excluded" : ""}`}
                style={{ backgroundColor: valueColor(well.rawValue, minimum, maximum) }}
                aria-pressed={isSelected}
                aria-label={`${well.well}, ${well.rawValue.toFixed(4)}, ${well.role}, ${well.group || "未分组"}`}
                title={`${well.well} · ${signalLabel} ${well.rawValue.toLocaleString(undefined, { maximumFractionDigits: 4 })} · ${well.instrumentLabel || "无标签"}`}
                onClick={(event) => {
                  if (event.detail !== 0 && lastPointerTypeRef.current !== "touch") return;
                  selectOneWell(well.well, selected, event.metaKey || event.ctrlKey, event.shiftKey);
                  lastPointerTypeRef.current = "";
                }}
              >
                <strong>{Math.abs(well.rawValue) >= 100 ? well.rawValue.toFixed(0) : well.rawValue.toFixed(3)}</strong>
                <small>{well.group || well.instrumentLabel || "未指定"}</small>
              </button>;
            }),
          ])}
        </div>
        {selectionBox ? <span className="plate-selection-box" aria-hidden="true" style={selectionBox} /> : null}
      </div>
    </div>
  </div>;
}

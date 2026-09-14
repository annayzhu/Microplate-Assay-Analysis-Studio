import type { ParsedPlate } from "../core/types";

function sourceStem(plate: ParsedPlate): string {
  return plate.metadata.sourceFileName.replace(/\.[^.]+$/, "");
}

export function plateSwitcherLabel(plate: ParsedPlate, index: number, plates: ParsedPlate[]): string {
  const duplicateName = plates.filter((candidate) => candidate.metadata.plateName === plate.metadata.plateName).length > 1;
  const source = sourceStem(plate);
  return `${index + 1}. ${plate.metadata.plateName}${duplicateName && source !== plate.metadata.plateName ? ` · ${source}` : ""}`;
}

export function PlateContextTabs({ plates, activePlateIndex, onSelect, context }: {
  plates: ParsedPlate[];
  activePlateIndex: number;
  onSelect: (index: number) => void;
  context: "layout" | "analysis";
}) {
  const active = plates[activePlateIndex];
  if (!active) return null;
  const contextLabel = context === "analysis" ? "当前分析板" : "当前板";
  return <section className={`plate-context-switcher ${context}-plate-context`} aria-label={`${contextLabel}与项目孔板`}>
    <div className="active-plate-identity">
      <span>{contextLabel} {activePlateIndex + 1} / {plates.length}</span>
      <strong>{active.metadata.plateName}</strong>
      <small title={active.metadata.sourceFileName}>{active.metadata.sourceFileName}</small>
    </div>
    {plates.length > 1 ? <nav className="plate-context-tabs" aria-label={context === "analysis" ? "切换分析孔板" : "切换项目孔板"}>
      {plates.map((item, index) => {
        const label = plateSwitcherLabel(item, index, plates);
        return <button
          type="button"
          key={item.plateId ?? `${item.metadata.plateName}-${index}`}
          className={index === activePlateIndex ? "active" : ""}
          aria-current={index === activePlateIndex ? "page" : undefined}
          aria-label={`切换到 ${label}`}
          title={`${label} · ${item.metadata.sourceFileName}`}
          onClick={() => onSelect(index)}
        >
          <strong>{index + 1}. {item.metadata.plateName}</strong>
          <small>{sourceStem(item)}</small>
        </button>;
      })}
    </nav> : null}
  </section>;
}

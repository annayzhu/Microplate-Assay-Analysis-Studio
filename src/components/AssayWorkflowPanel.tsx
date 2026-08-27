import { assayWorkflowFacts } from "../core/assay-workflows";
import type { AssayModuleDefinition, ParsedPlate } from "../core/types";

export function assayStatusLabel(status: AssayModuleDefinition["status"]): string {
  return status === "complete" ? "完整分析可用" : status === "preview" ? "数据导入与预览可用" : "计划中";
}

export function AssayWorkflowPanel({ module, plate }: { module: AssayModuleDefinition; plate?: ParsedPlate | null }) {
  const facts = plate ? assayWorkflowFacts(plate, module.id) : [];
  return <section className="assay-workflow-panel" aria-label={`${module.name}工作流说明`}>
    <div className="assay-workflow-header">
      <div><span className={`capability-status ${module.status}`}>{assayStatusLabel(module.status)}</span><h3>{module.name}</h3><p>{module.description}</p></div>
      <div className="mode-pills">{module.detectionModes.map((mode) => <span key={mode}>{mode}</span>)}</div>
    </div>
    <div className="assay-workflow-columns">
      <div><strong>导入后需要确认</strong><ul>{module.requiredInformation.map((item) => <li key={item}>{item}</li>)}</ul></div>
      <div><strong>当前可以完成</strong>{module.availableAnalyses.length ? <ul>{module.availableAnalyses.map((item) => <li key={item}>{item}</li>)}</ul> : <p>尚未开放分析。</p>}</div>
      <div><strong>尚未由本系统计算</strong>{module.deferredAnalyses.length ? <ul>{module.deferredAnalyses.map((item) => <li key={item}>{item}</li>)}</ul> : <p>无</p>}</div>
    </div>
    {facts.length ? <div className="assay-workflow-facts">{facts.map((fact) => <div key={fact.label}><span>{fact.label}</span><strong>{fact.value}</strong><small className={fact.evidence}>{fact.evidence === "instrument" ? "仪器提供" : fact.evidence === "user" ? "用户填写" : "需要补充"}</small></div>)}</div> : null}
    <p className="annotation-guidance"><strong>注释建议：</strong>{module.annotationGuidance}</p>
  </section>;
}

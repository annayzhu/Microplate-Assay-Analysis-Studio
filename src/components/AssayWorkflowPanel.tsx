import { assayWorkflowFacts } from "../core/assay-workflows";
import type { AssayModuleDefinition, ParsedPlate } from "../core/types";

export function assayStatusLabel(status: AssayModuleDefinition["status"]): string {
  return status === "complete" ? "完整分析可用" : status === "preview" ? "数据导入与预览可用" : "计划中";
}

type AssayWorkflowPanelProps = {
  module: AssayModuleDefinition;
  plate?: ParsedPlate | null;
  variant?: "expanded" | "disclosure";
};

function WorkflowDetails({ module, facts }: { module: AssayModuleDefinition; facts: ReturnType<typeof assayWorkflowFacts> }) {
  return <div className="assay-workflow-details">
    <div className="assay-workflow-columns">
      <div><strong>需要确认</strong><p>{module.requiredInformation.join("、")}</p></div>
      <div><strong>本系统可完成</strong><p>{module.availableAnalyses.length ? module.availableAnalyses.join("、") : "尚未开放分析"}</p></div>
      {module.deferredAnalyses.length ? <div><strong>暂不计算</strong><p>{module.deferredAnalyses.join("、")}</p></div> : null}
    </div>
    {facts.length ? <div className="assay-workflow-facts">{facts.map((fact) => <div key={fact.label}><span>{fact.label}</span><strong>{fact.value}</strong><small className={fact.evidence}>{fact.evidence === "instrument" ? "仪器提供" : fact.evidence === "user" ? "用户填写" : "需要补充"}</small></div>)}</div> : null}
    <p className="annotation-guidance"><strong>板图注释：</strong>{module.annotationGuidance}</p>
  </div>;
}

export function AssayWorkflowPanel({ module, plate, variant = "expanded" }: AssayWorkflowPanelProps) {
  const facts = plate ? assayWorkflowFacts(plate, module.id) : [];

  if (variant === "disclosure") {
    return <details className="assay-workflow-panel compact-workflow" aria-label={`${module.name}分析说明`}>
      <summary>
        <span className="workflow-summary-copy"><strong>分析说明</strong><span>{module.name}：{module.description}</span></span>
        <span className="workflow-summary-meta"><span className={`capability-status ${module.status}`}>{assayStatusLabel(module.status)}</span><span className="workflow-detection-modes">{module.detectionModes.join(" / ")}</span><span className="workflow-disclosure-action">查看</span></span>
      </summary>
      <WorkflowDetails module={module} facts={facts} />
    </details>;
  }

  return <section className="assay-workflow-panel" aria-label={`${module.name}工作流说明`}>
    <div className="assay-workflow-header">
      <div><span className={`capability-status ${module.status}`}>{assayStatusLabel(module.status)}</span><h3>{module.name}</h3><p>{module.description}</p></div>
      <div className="mode-pills">{module.detectionModes.map((mode) => <span key={mode}>{mode}</span>)}</div>
    </div>
    <WorkflowDetails module={module} facts={facts} />
  </section>;
}

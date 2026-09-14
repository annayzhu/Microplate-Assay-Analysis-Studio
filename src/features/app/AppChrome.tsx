import type { AssayModuleDefinition, AssayModuleId } from "../../core/types";
import { assayStatusLabel } from "../../components/AssayWorkflowPanel";

export type WorkspaceViewName = "import" | "layout" | "analysis";

export function AppHeader({ version, hasPlate, workflowReady, previewOnly, onHome }: {
  version: string;
  hasPlate: boolean;
  workflowReady: boolean;
  previewOnly: boolean;
  onHome: () => void;
}) {
  return <header className="topbar">
    <div className="page-frame topbar-inner">
      <button className="brand" type="button" onClick={onHome}>
        <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
        <span><strong>Microplate Assay Studio</strong><small>酶标实验分析工作台 · v{version}</small></span>
      </button>
      <div className="topbar-actions">
        <span className="privacy-pill"><i />Browser-local</span>
        {hasPlate ? <span className={`status-pill ${workflowReady ? "ready" : "review"}`}>{workflowReady ? (previewOnly ? "数据预览就绪" : "分析就绪") : "需要补充信息"}</span> : null}
      </div>
    </div>
  </header>;
}

export function AssaySelector({ modules, selectedId, onSelect }: {
  modules: AssayModuleDefinition[];
  selectedId: AssayModuleId;
  onSelect: (id: AssayModuleId, name: string) => void;
}) {
  return <section className="assay-strip">
    <div className="page-frame assay-strip-inner">
      <h1>酶标数据入口，选择实验类型进行分析</h1>
      <div className="assay-cards">
        {modules.map((module) => <button
          key={module.id}
          type="button"
          disabled={module.status === "planned"}
          aria-pressed={selectedId === module.id}
          onClick={() => onSelect(module.id, module.name)}
          className={`assay-card ${module.status} ${selectedId === module.id ? "active" : ""}`}
        >
          <span>{module.shortName}</span>
          <strong>{module.name}</strong>
          <small>{module.measurementTarget}</small>
          <em>{assayStatusLabel(module.status)}</em>
        </button>)}
      </div>
    </div>
  </section>;
}

const workspaceViews: WorkspaceViewName[] = ["import", "layout", "analysis"];
const workspaceLabels: Record<WorkspaceViewName, string> = { import: "数据导入", layout: "板图与注释", analysis: "分析与导出" };

export function WorkspaceNavigation({ active, onSelect }: { active: WorkspaceViewName; onSelect: (view: WorkspaceViewName) => void }) {
  return <nav className="workspace-nav" aria-label="工作区视图">
    {workspaceViews.map((item, index) => <button type="button" key={item} className={active === item ? "active" : ""} onClick={() => onSelect(item)}>
      <span>{index + 1}</span>{workspaceLabels[item]}
    </button>)}
  </nav>;
}

export function FeedbackNotices({ notice, error, onDismissError }: { notice: string; error: string; onDismissError: () => void }) {
  return <>
    {notice ? <div className="notice success" role="status">{notice}</div> : null}
    {error ? <div className="notice warning" role="alert">{error}<button type="button" aria-label="关闭错误提示" onClick={onDismissError}>关闭</button></div> : null}
  </>;
}

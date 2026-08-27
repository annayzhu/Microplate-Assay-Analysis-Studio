import type {
  AssayAssignmentDecision,
  AssayModuleDefinition,
  AssayModuleId,
  ParsedPlate,
} from "./types";

export const assayModules: AssayModuleDefinition[] = [
  {
    id: "cell-viability",
    shortName: "CCK-8 · MTT · alamarBlue",
    name: "细胞活性 / 细胞增殖",
    measurementTarget: "细胞代谢活性与相对存活/增殖",
    description: "支持吸光、荧光和发光型细胞活性读数，并按具体方法处理空白、重复与对照归一化。",
    detectionModes: ["absorbance", "fluorescence", "luminescence"],
    status: "complete",
    supportedMethods: ["CCK-8 / WST-8", "MTT", "Resazurin / alamarBlue"],
    requiredInformation: ["具体检测方法", "空白孔与对照组", "生物学重复和技术重复", "适用时的检测波长或荧光通道"],
    availableAnalyses: ["空白扣除", "技术复孔 QC", "对照归一化", "生物学重复汇总", "组间显著性"],
    deferredAnalyses: ["连续多时间点混合效应模型"],
    annotationGuidance: "先标记空白、对照和样本，再在每个独立 Bio 内设置技术复孔。",
  },
  {
    id: "protein-quant",
    shortName: "BSA · BCA · Bradford",
    name: "蛋白定量",
    measurementTarget: "总蛋白浓度与蛋白吸收特征",
    description: "保留标准曲线、未知样本和稀释信息；当前核查并导出仪器提供的曲线与浓度结果。",
    detectionModes: ["absorbance"],
    status: "preview",
    supportedMethods: ["BSA spectrum", "BCA", "Bradford"],
    requiredInformation: ["定量方法与待测物", "标准品浓度和单位", "标准/未知/QC 孔角色", "稀释倍数与检测波长"],
    availableAnalyses: ["测量步骤浏览", "吸收光谱预览", "仪器标准曲线核查", "仪器浓度结果导出"],
    deferredAnalyses: ["本系统标准曲线复算", "未知样本反算", "范围外结果判定"],
    annotationGuidance: "使用标准品、样本和 QC 角色；浓度字段记录标准品浓度或已知样本浓度。",
  },
  {
    id: "atp-quant",
    shortName: "ATP",
    name: "ATP 发光定量",
    measurementTarget: "ATP 含量与样本能量状态",
    description: "保留完整动力学、终点归约和 log-log 标准曲线；明确区分仪器结果与系统复算。",
    detectionModes: ["luminescence"],
    status: "preview",
    supportedMethods: ["ATP luminescence endpoint", "ATP luminescence kinetic"],
    requiredInformation: ["试剂或方法", "终点/动力学模式", "积分或选取时间窗", "标准品、背景与稀释倍数"],
    availableAnalyses: ["动力学预览", "终点/归约步骤核查", "仪器标准曲线核查", "完整长表导出"],
    deferredAnalyses: ["本系统峰值窗口计算", "ATP 浓度复算", "范围外结果判定"],
    annotationGuidance: "标记标准品、样本和背景孔；时间窗口与浓度单位必须由协议或用户确认。",
  },
  {
    id: "elisa",
    shortName: "ELISA",
    name: "免疫分析",
    measurementTarget: "抗原或抗体等目标物的特异性定量",
    description: "计划支持标准曲线、未知样本反算和质控品判定。",
    detectionModes: ["absorbance", "fluorescence", "luminescence"],
    status: "planned",
    supportedMethods: ["ELISA / TMB"],
    requiredInformation: ["标准品", "质控品", "检测通道", "曲线模型"],
    availableAnalyses: [],
    deferredAnalyses: ["4PL / 5PL 标准曲线", "浓度反算", "质控判定"],
    annotationGuidance: "模块尚未开放分析。",
  },
  {
    id: "luciferase",
    shortName: "Luciferase",
    name: "单 / 双荧光素酶",
    measurementTarget: "报告基因活性与细胞通路响应",
    description: "保留 Firefly、Renilla 和仪器归一化步骤；通道含义必须由用户确认。",
    detectionModes: ["luminescence"],
    status: "preview",
    supportedMethods: ["Single-Luciferase", "Dual-Luciferase"],
    requiredInformation: ["单/双报告类型", "Firefly 与 Renilla 步骤映射", "背景孔", "归一化分母和对照"],
    availableAnalyses: ["Firefly/Renilla 步骤核查", "仪器比值结果核查", "标准曲线预览", "完整长表导出"],
    deferredAnalyses: ["本系统比值复算", "fold change", "组间推断统计"],
    annotationGuidance: "先确认 Firefly/Renilla 映射，再补充背景、对照和独立生物学重复。",
  },
  {
    id: "microbial-growth",
    shortName: "OD600",
    name: "微生物生长动力学",
    measurementTarget: "微生物生长与药物抑制动力学",
    description: "计划支持生长曲线、lag 期、最大生长速率和 AUC。",
    detectionModes: ["absorbance"],
    status: "planned",
    supportedMethods: ["OD600 kinetic"],
    requiredInformation: ["菌株", "培养条件", "时间序列", "空白与处理"],
    availableAnalyses: [],
    deferredAnalyses: ["生长曲线", "lag 期", "最大生长速率", "AUC", "抑菌曲线"],
    annotationGuidance: "模块尚未开放分析。",
  },
  {
    id: "advanced-binding",
    shortName: "TR-FRET / Alpha",
    name: "高级结合与通路实验",
    measurementTarget: "分子互作与细胞信号通路活性",
    description: "计划支持多通道比值、结合实验和筛选质控。",
    detectionModes: ["fluorescence", "trf", "alpha"],
    status: "planned",
    supportedMethods: ["TR-FRET", "AlphaScreen", "AlphaLISA"],
    requiredInformation: ["检测技术", "通道映射", "阴阳性对照", "筛选布局"],
    availableAnalyses: [],
    deferredAnalyses: ["多通道比值", "结合曲线", "Z′ 与筛选质控"],
    annotationGuidance: "模块尚未开放分析。",
  },
];

const genericPreviewWorkflow: AssayModuleDefinition = {
  id: "unknown",
  shortName: "Generic preview",
  name: "通用酶标数据预览",
  measurementTarget: "尚未归类的微孔板测量信号",
  description: "保留原始读数、测量步骤和采集信息；在实验类型确认前不执行实验特异计算。",
  detectionModes: ["absorbance", "fluorescence", "luminescence", "trf", "alpha"],
  status: "preview",
  supportedMethods: [],
  requiredInformation: ["实验类型", "检测模式与通道", "孔位角色和实验设计"],
  availableAnalyses: ["原始读数预览", "测量步骤浏览", "孔位注释", "溯源导出"],
  deferredAnalyses: ["所有实验特异计算"],
  annotationGuidance: "先核对测量步骤并选择正确实验模块，再进入实验特异分析。",
};

export function getAssayWorkflow(id: AssayModuleId): AssayModuleDefinition {
  return assayModules.find((module) => module.id === id) ?? genericPreviewWorkflow;
}

export function detectedAssayModule(plate: ParsedPlate): AssayModuleId {
  return plate.metadata.detectedAssayModuleId
    ?? plate.metadata.assayModuleId
    ?? plate.assayData?.moduleId
    ?? "unknown";
}

export function assignmentDecision(
  sourceKind: ParsedPlate["metadata"]["sourceKind"],
  selected: AssayModuleId,
  detected: AssayModuleId,
  selectionWasExplicit: boolean,
): AssayAssignmentDecision {
  if (sourceKind === "project-file") return "project-restored";
  if (sourceKind === "manual-paste" || sourceKind === "reading-template") return "manual";
  if (!selectionWasExplicit && detected !== "unknown") return "system-detected";
  return selected === detected || detected === "unknown" ? "matched" : "user-confirmed";
}

export type WorkflowFact = { label: string; value: string; evidence: "instrument" | "user" | "missing" };

function countSeries(plate: ParsedPlate, predicate: (name: string) => boolean): number {
  return plate.assayData?.measurements.filter((series) => predicate(series.name)).length ?? 0;
}

export function assayWorkflowFacts(plate: ParsedPlate, moduleId: AssayModuleId): WorkflowFact[] {
  const dataset = plate.assayData;
  const missing = (label: string): WorkflowFact => ({ label, value: "未确认", evidence: "missing" });
  if (moduleId === "protein-quant") {
    const curves = dataset?.standardCurves.length ?? 0;
    const calculated = dataset?.measurements.filter((series) => series.source === "instrument-calculated").length ?? 0;
    return [
      { label: "定量方法", value: plate.metadata.assayMethodLabel || "未确认", evidence: plate.metadata.assayMethodEvidence === "user-reported" ? "user" : "instrument" },
      { label: "标准曲线", value: curves ? `${curves} 条仪器曲线` : "未提供", evidence: curves ? "instrument" : "missing" },
      { label: "仪器计算步骤", value: calculated ? `${calculated} 个` : "未提供", evidence: calculated ? "instrument" : "missing" },
      missing("稀释倍数"),
    ];
  }
  if (moduleId === "atp-quant") {
    const kinetics = dataset?.measurements.filter((series) => series.kind === "kinetic") ?? [];
    const maxTime = Math.max(0, ...kinetics.flatMap((series) => series.points.map((point) => point.timeSeconds ?? 0)));
    return [
      { label: "读取模式", value: kinetics.length ? `动力学 · ${kinetics.length} 个步骤` : "终点/归约步骤", evidence: "instrument" },
      { label: "时间范围", value: maxTime ? `0-${maxTime.toLocaleString()} s` : "未确认", evidence: maxTime ? "instrument" : "missing" },
      { label: "标准曲线", value: dataset?.standardCurves.length ? `${dataset.standardCurves.length} 条仪器曲线` : "未提供", evidence: dataset?.standardCurves.length ? "instrument" : "missing" },
      missing("积分/选取窗口"),
    ];
  }
  if (moduleId === "luciferase") {
    const firefly = countSeries(plate, (name) => /firefly/i.test(name));
    const renilla = countSeries(plate, (name) => /renilla/i.test(name));
    const normalized = countSeries(plate, (name) => /normalization|ratio/i.test(name));
    return [
      { label: "实验类型", value: firefly && renilla ? "Dual-Luciferase" : "Single/未确认", evidence: firefly && renilla ? "instrument" : "missing" },
      { label: "Firefly 步骤", value: firefly ? `${firefly} 个候选` : "未确认", evidence: firefly ? "instrument" : "missing" },
      { label: "Renilla 步骤", value: renilla ? `${renilla} 个候选` : "未确认", evidence: renilla ? "instrument" : "missing" },
      { label: "仪器归一化", value: normalized ? `${normalized} 个结果` : "未提供", evidence: normalized ? "instrument" : "missing" },
    ];
  }
  return [
    { label: "具体方法", value: plate.metadata.assayMethodLabel || "未确认", evidence: plate.metadata.assayMethodEvidence === "user-reported" ? "user" : plate.metadata.assayMethodEvidence === "unknown" ? "missing" : "instrument" },
    { label: "检测模式", value: plate.metadata.detectionMode, evidence: plate.metadata.assayMethodEvidence === "user-reported" ? "user" : "instrument" },
    { label: "测量步骤", value: dataset?.measurements.length ? `${dataset.measurements.length} 个` : "单一原始读数", evidence: dataset ? "instrument" : "user" },
  ];
}

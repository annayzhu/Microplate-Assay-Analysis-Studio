import type { WellRecord, WellRole } from "./types";

export type LayoutPatch = Partial<Pick<WellRecord,
  | "role"
  | "sampleId"
  | "group"
  | "treatment"
  | "concentration"
  | "timepoint"
  | "biologicalReplicate"
  | "technicalReplicate"
  | "excluded"
  | "notes"
>>;

const headerAliases: Record<string, keyof LayoutPatch | "well"> = {
  well: "well",
  孔位: "well",
  孔: "well",
  role: "role",
  类型: "role",
  類型: "role",
  sampleid: "sampleId",
  sample: "sampleId",
  样本: "sampleId",
  樣本: "sampleId",
  group: "group",
  分组: "group",
  分組: "group",
  treatment: "treatment",
  处理: "treatment",
  處理: "treatment",
  concentration: "concentration",
  dose: "concentration",
  浓度: "concentration",
  濃度: "concentration",
  timepoint: "timepoint",
  time: "timepoint",
  时间点: "timepoint",
  時間點: "timepoint",
  biologicalreplicate: "biologicalReplicate",
  biorep: "biologicalReplicate",
  生物学重复: "biologicalReplicate",
  生物學重複: "biologicalReplicate",
  technicalreplicate: "technicalReplicate",
  techrep: "technicalReplicate",
  技术重复: "technicalReplicate",
  技術重複: "technicalReplicate",
  excluded: "excluded",
  exclude: "excluded",
  排除: "excluded",
  notes: "notes",
  note: "notes",
  备注: "notes",
  備註: "notes",
};

export type PlateTemplateDefinition = {
  id: string;
  label: string;
  rows: number;
  columns: number;
};

export const plateLayoutSchemaVersion = 1;

export type LayoutImportOptions = {
  biologicalReplicateMode?: "preserve" | "clear";
  targetRows?: number;
  targetColumns?: number;
};

export type LayoutFileMetadata = {
  schemaVersion: number | null;
  mode: "patch" | "snapshot";
  plateRows: number | null;
  plateColumns: number | null;
  plateName: string;
};

export type LayoutImportPreview = {
  wells: WellRecord[];
  warnings: string[];
  matched: number;
  sourceWellCount: number;
  outOfPlateWells: string[];
  affectedFields: Array<keyof LayoutPatch>;
  metadata: LayoutFileMetadata;
  plateShapeMismatch: boolean;
};

export const plateTemplateDefinitions: PlateTemplateDefinition[] = [
  { id: "6", label: "6孔板 (2 x 3)", rows: 2, columns: 3 },
  { id: "12", label: "12孔板 (3 x 4)", rows: 3, columns: 4 },
  { id: "24", label: "24孔板 (4 x 6)", rows: 4, columns: 6 },
  { id: "48", label: "48孔板 (6 x 8)", rows: 6, columns: 8 },
  { id: "96", label: "96孔板 (8 x 12)", rows: 8, columns: 12 },
  { id: "384", label: "384孔板 (16 x 24)", rows: 16, columns: 24 },
];

function normalizeHeader(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_\-\/()（）]+/g, "");
}

function normalizeWell(value: string): string {
  const match = value.trim().toUpperCase().match(/^([A-Z]+)0*(\d+)$/);
  return match ? `${match[1]}${Number(match[2])}` : "";
}

function normalizeRole(value: string): WellRole | undefined {
  const normalized = value.trim().toLocaleLowerCase();
  if (["unassigned", "未指定", "未分配"].includes(normalized)) return "unassigned";
  if (["blank", "空白"].includes(normalized)) return "blank";
  if (["qc", "质控", "質控"].includes(normalized)) return "qc";
  if (["control", "对照", "對照"].includes(normalized)) return "control";
  if (["sample", "样本", "樣本"].includes(normalized)) return "sample";
  if (["standard", "标准品", "標準品"].includes(normalized)) return "standard";
  return undefined;
}

function parseBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLocaleLowerCase();
  if (["true", "yes", "1", "是", "y"].includes(normalized)) return true;
  if (["false", "no", "0", "否", "n"].includes(normalized)) return false;
  return undefined;
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseMetadata(lines: Array<{ trimmed: string }>): LayoutFileMetadata {
  const values = new Map<string, string>();
  for (const line of lines) {
    const match = line.trimmed.match(/^#\s*([a-z_]+)\s*=\s*(.*)$/i);
    if (match) values.set(match[1].toLocaleLowerCase(), match[2].trim());
  }
  const numeric = (key: string): number | null => {
    const value = Number(values.get(key));
    return Number.isInteger(value) && value > 0 ? value : null;
  };
  return {
    schemaVersion: numeric("microplate_layout_schema_version"),
    mode: values.get("layout_mode") === "snapshot" ? "snapshot" : "patch",
    plateRows: numeric("plate_rows"),
    plateColumns: numeric("plate_columns"),
    plateName: values.get("plate_name") ?? "",
  };
}

export function previewLayoutText(wells: WellRecord[], rawText: string, options: LayoutImportOptions = {}): LayoutImportPreview {
  const lines = rawText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line, index) => ({ text: line, lineNumber: index + 1, trimmed: line.trim() }))
    .filter((line) => line.trimmed);
  const headerLine = lines.find((line) => {
    if (line.trimmed.startsWith("#")) return false;
    const delimiter = line.text.includes("\t") ? "\t" : ",";
    return parseDelimitedLine(line.text, delimiter).some((header) => headerAliases[normalizeHeader(header)] === "well");
  });
  const metadata = parseMetadata(lines);
  const emptyResult = (warning: string): LayoutImportPreview => ({
    wells, warnings: [warning], matched: 0, sourceWellCount: 0, outOfPlateWells: [], affectedFields: [], metadata, plateShapeMismatch: false,
  });
  if (!headerLine) return emptyResult("板图缺少 well / 孔位列。");
  const delimiter = headerLine.text.includes("\t") ? "\t" : ",";
  const headers = parseDelimitedLine(headerLine.text, delimiter).map((header) => headerAliases[normalizeHeader(header)]);
  const wellIndex = headers.indexOf("well");
  if (wellIndex < 0) return emptyResult("板图缺少 well / 孔位列。");
  const dataLines = lines.filter((line) => line.lineNumber > headerLine.lineNumber && !line.trimmed.startsWith("#"));
  if (!dataLines.length) return emptyResult("板图文件至少需要表头和一行数据。");

  const patches = new Map<string, LayoutPatch>();
  const warnings: string[] = [];
  const affectedFields = new Set<keyof LayoutPatch>();
  for (const line of dataLines) {
    const cells = parseDelimitedLine(line.text, delimiter);
    const well = normalizeWell(cells[wellIndex] ?? "");
    if (!well) {
      warnings.push(`第 ${line.lineNumber} 行孔位无效。`);
      continue;
    }
    const patch: LayoutPatch = {};
    headers.forEach((key, index) => {
      if (!key || key === "well" || cells[index] === undefined) return;
      const value = cells[index];
      if (value === "" && metadata.mode !== "snapshot") return;
      if (key === "role") {
        const role = normalizeRole(value);
        if (role) patch.role = role;
        else if (metadata.mode === "snapshot") patch.role = "unassigned";
        else warnings.push(`第 ${line.lineNumber} 行 role 无法识别：${value}`);
      } else if (key === "excluded") {
        const excluded = parseBoolean(value);
        if (excluded !== undefined) patch.excluded = excluded;
        else if (metadata.mode === "snapshot") patch.excluded = false;
      } else {
        patch[key] = value as never;
      }
      affectedFields.add(key);
    });
    if (options.biologicalReplicateMode === "clear") {
      patch.biologicalReplicate = "";
      affectedFields.add("biologicalReplicate");
    }
    patches.set(well, patch);
  }

  let matched = 0;
  const nextWells = wells.map((well) => {
    const patch = patches.get(well.well);
    if (!patch) return well;
    matched += 1;
    return { ...well, ...patch };
  });
  const outOfPlateWells: string[] = [];
  for (const well of patches.keys()) {
    if (!wells.some((item) => item.well === well)) {
      outOfPlateWells.push(well);
      warnings.push(`板图中的 ${well} 不在当前数据板中。`);
    }
  }
  const plateShapeMismatch = Boolean(
    metadata.plateRows && metadata.plateColumns && options.targetRows && options.targetColumns
    && (metadata.plateRows !== options.targetRows || metadata.plateColumns !== options.targetColumns),
  );
  if (metadata.schemaVersion && metadata.schemaVersion > plateLayoutSchemaVersion) {
    warnings.unshift(`板布局格式版本 ${metadata.schemaVersion} 高于当前支持的版本 ${plateLayoutSchemaVersion}，请谨慎核对。`);
  }
  if (plateShapeMismatch) {
    warnings.unshift(`布局板型为 ${metadata.plateRows} × ${metadata.plateColumns}，当前数据板为 ${options.targetRows} × ${options.targetColumns}。`);
  }
  return {
    wells: nextWells,
    warnings,
    matched,
    sourceWellCount: patches.size,
    outOfPlateWells,
    affectedFields: [...affectedFields],
    metadata,
    plateShapeMismatch,
  };
}

export function applyLayoutText(wells: WellRecord[], rawText: string, options: LayoutImportOptions = {}): { wells: WellRecord[]; warnings: string[]; applied: number } {
  const preview = previewLayoutText(wells, rawText, options);
  return { wells: preview.wells, warnings: preview.warnings, applied: preview.matched };
}

function rowLabel(index: number): string {
  let label = "";
  let current = index;
  do {
    label = String.fromCharCode(65 + (current % 26)) + label;
    current = Math.floor(current / 26) - 1;
  } while (current >= 0);
  return label;
}

export function layoutTemplateCsv(template: PlateTemplateDefinition): string {
  const header = "well,role,sample_id,group,treatment,concentration,timepoint,biological_replicate,technical_replicate,excluded,notes";
  const instructions = [
    "# LabNest / Microplate Assay Studio 板图模板",
    "# 填写说明：",
    "# 1. 正式导入只读取下面 well 表头后的真实孔位行；所有以 # 开头的说明和示例都会被忽略。",
    "# 2. well 必填；孔位已按 A1,B1,C1...A2,B2,C2 的列优先顺序预置。",
    "# 3. role 可填 sample/control/qc/blank，或中文：样本/对照/质控/空白。",
    "# 4. group 是正式分析分组；sample_id 是样本或细胞处理组合编号，可按实验习惯填写。",
    "# 5. biological_replicate 填独立实验/独立铺板编号，例如 B1、B2；technical_replicate 填同一生物学重复内的复孔编号，例如 T1、T2。",
    "# 6. excluded 可填 true/false、yes/no、1/0、是/否；空着表示不改当前排除状态。",
    "# 7. 空白孔通常只需要 role=blank，可在 notes 写明培养基空白、试剂空白等。",
    "# 示例行如下；复制到正式表格时请删除行首 #。",
    `# ${header}`,
    "# A1,control,A549_Mock_B1,Control,Mock,0 nM,Day0,B1,T1,false,对照技术复孔1",
    "# B1,control,A549_Mock_B1,Control,Mock,0 nM,Day0,B1,T2,false,对照技术复孔2",
    "# C1,sample,A549_siGENE_B1,siGENE,siRNA,10 nM,Day0,B1,T1,false,处理组技术复孔1",
    "# H12,blank,,,,,,,,false,培养基+CCK8空白",
  ];
  const rows: string[] = [];
  for (let column = 1; column <= template.columns; column += 1) {
    for (let row = 0; row < template.rows; row += 1) {
      rows.push(`${rowLabel(row)}${column},,,,,,,,,,`);
    }
  }
  return [...instructions, header, ...rows].join("\n");
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value).replace(/\r?\n/g, " ");
  return /[",]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function currentPlateLayoutCsv(input: { rows: number; columns: number; plateName: string; wells: WellRecord[] }): string {
  const header = ["well", "role", "sample_id", "group", "treatment", "concentration", "timepoint", "biological_replicate", "technical_replicate", "excluded", "notes"];
  const metadata = [
    `# microplate_layout_schema_version=${plateLayoutSchemaVersion}`,
    "# layout_mode=snapshot",
    `# plate_rows=${input.rows}`,
    `# plate_columns=${input.columns}`,
    `# plate_name=${input.plateName.replaceAll("\n", " ").replaceAll("\r", " ")}`,
    "# 该文件仅包含孔位注释，不包含原始读数、校正结果或统计结果。",
  ];
  const rows = input.wells.map((well) => [
    well.well, well.role, well.sampleId, well.group, well.treatment, well.concentration, well.timepoint,
    well.biologicalReplicate, well.technicalReplicate, well.excluded, well.notes,
  ].map(csvEscape).join(","));
  return [...metadata, header.join(","), ...rows].join("\n");
}

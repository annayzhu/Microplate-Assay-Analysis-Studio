# Microplate Assay Studio

面向酶标仪/多功能微孔板读数仪的一体化分析工作台。当前版本为 v0.5.0，使用真实 Thermo Scientific Varioskan LUX / SkanIt XML、XLSX 和旧版 VICTOR XLS 数据开发。

## 工具定位

- 独立完成酶标仪数据导入、孔板注释、质量控制、实验特异分析、结果浏览与文件导出。
- 所有数据均在浏览器本地处理，不依赖服务器、用户账户或网络连接。
- 各实验模块复用统一的仪器适配层、孔板数据模型和编辑方式，同时保留各自的实验信息、计算方法与统计边界。
- 标准 CSV 用于结果查看和后续处理；版本化的可复现项目文件用于恢复原始读值、注释、模块决策及分析参数。

工具围绕“原始读值 → 导入核对 → 孔板注释 → 质量控制 → 实验特异分析 → 可追溯导出”组织完整流程。原始测量保持只读，用户注释与派生结果分层保存，避免后续编辑覆盖仪器观测值。

## 当前能力

1. 所有已开放实验类型共用同一套输入路径：仪器结果、Excel 粘贴/模板、可复现项目文件；导入后统一经过多板预览与逐板确认。
2. 识别 Varioskan LUX SkanIt XML/XLSX 中的运行元数据、孔位身份、测量步骤、计算步骤和标准曲线。
3. 实验模块明确区分“完整分析可用”“数据导入与预览可用”“计划中”；切换模块时同步展示本模块所需信息、当前可用分析与尚未实现的计算，不再只更换卡片名称。
4. 系统识别类型与用户确认类型分别保存；不一致时必须在预览页确认，原始读值与通用孔注释不会因模块切换被改写。
5. 支持终点读数、动力学、多波长光谱、仪器公式结果、多通道比值和线性/log-log 标准曲线。
6. 支持 CCK-8/MTT/Resazurin/alamarBlue、BSA 蛋白定量与光谱、ATP 发光定量和 Dual-Luciferase demo 流程。
7. 对 CCK-8 类组间实验，区分技术复孔与生物学重复，完成空白扣除、QC、对照归一化及显著性分析；同一块板允许存在多个独立的生物学重复，但技术复孔仍先在各自生物学重复内汇总。
8. 对 ATP、BSA、alamarBlue 标准曲线和 Dual-Luciferase，逐步展示 SkanIt 原始测量与仪器计算结果，不擅自替换仪器算法。
9. 导出包含当前孔注释、模块确认、选择决策、来源适配器、测量步骤和全部数据点的 tidy long-table CSV；CCK-8 流程另可导出孔级、技术复孔和生物学汇总结果。
10. 可保存并重新打开浏览器本地的可复现项目文件，恢复原始读值、当前注释、实验基本信息、模块识别/确认和分析配置。
11. 无仪器原始文件时，可直接粘贴 Excel 中的固定孔板矩阵，或下载并填写 6/12/24/48/96/384 孔读数模板后导入。
12. 同一次粘贴或模板导入可识别多块板；每块板保留独立名称、注释和分析状态，不会自动合并为生物学重复。
13. 板图支持拖动框选、Ctrl/Command 追加或逐孔增减、Shift 头尾矩形选择，以及 50%–130% 按板记忆缩放；注释草稿在选择变化时保留，离开前会提示尚未应用的内容。
14. 当前板布局可导出为版本化的注释快照并应用到后续新检测；导入前显示孔位和板型匹配预览，可选择沿用或清空生物学重复。布局文件不会包含或覆盖原始读数和分析结果，应用后仍可逐孔或批量微调。

人工录入的数值只代表孔板读数：空单元格视为未测，数字 `0` 会作为真实读数保留。新导入的孔默认标记为“未指定”，必须由用户补充样本、对照、空白等实验角色后，才能进入实验特异计算，避免系统根据数值擅自推断实验设计。

> `.skax` 是 SkanIt 会话归档，数值存储在内部专用数据块中。定量分析请在 SkanIt 中将会话导出为 XML 或 XLSX；工具会给出明确提示，不会把协议文件误当结果文件。

## 运行

要求 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

默认地址：`http://127.0.0.1:4178`

首次运行浏览器验收测试前安装 Chromium：

```bash
npx playwright install chromium
```

### 生成离线单文件

```bash
npm run build:offline
```

生成文件位于 `release/Microplate-Assay-Studio-Offline.html`，无需服务器或网络，双击即可在现代浏览器中使用。所有数据处理均在浏览器本地完成。

## 验证

```bash
npm test
```

公开仓库中的默认测试包括合成数据单元测试、类型检查和生产构建：

- 中英文板图字段映射。
- 人工粘贴的固定孔板矩阵、空值与零值、多板识别及错误坐标提示。
- 6/12/24/48/96/384 孔读数模板生成与回读。
- 板图框选、追加选择、逐孔取消、缩放、批量草稿保留与离开保护。
- 当前板布局导出、CSV 引号回读、跨板型预警、生物学重复清空选项及原始读数只读保护。
- CCK-8 的空白扣除、技术复孔合并、生物学汇总与对照归一化。
- 同一块板多个生物学重复的统计层级，以及疑似把技术复孔误填为生物学重复时的提示。
- 模块能力状态、识别/确认决策、带来源信息的 CSV 导出和可复现项目文件往返恢复。
- TypeScript 类型检查和生产构建。

启动本地服务后，可在另一终端运行页面业务场景验收：

```bash
npm run test:browser
```

默认页面验收仅使用公开的合成数据，覆盖模块切换、人工多板导入、框选与缩放、注释草稿保护、分析 QC、项目导出和重新打开。若本机存在经授权的仪器文件，可通过环境变量增加 adapter 场景：

```bash
CCK8_XLS=/absolute/path/cck8.xlsx \
DUAL_LUC_XLS=/absolute/path/dual-luciferase.xlsx \
VICTOR_XLS=/absolute/path/resazurin.xls \
npm run test:browser
```

真实仪器文件和厂商 demo 不上传到公开仓库。将获授权的数据放入本地 `tests/fixtures/` 与 `酶标仪demo/` 后，可运行：

```bash
npm run test:real
npm run test:unit
```

对应回归覆盖 96 孔 Varioskan CCK-8 文件，以及 ATP kinetic、BSA spectrum/concentration/purity、alamarBlue standard curve 和 Firefly/Renilla ratio。缺少本地数据时，相关 Vitest suite 会明确标记为 skipped。

## 代码结构

项目采用“深 module + adapter”的结构，interface 同时作为测试表面：

- `src/core/plate-workspace.ts`：Plate workspace 的状态转换、分析范围和派生视图；React 不再拥有科研工作流策略。
- `src/core/plate-aggregate.ts`：原始读数与可编辑孔注释的 canonical aggregate；所有投影和同步规则集中在这一处。
- `src/core/import.ts`：统一导入 interface；浏览器 `File` 与测试内存文件都通过相同 seam。
- `src/core/instruments/registry.ts`：厂商格式 adapters、格式探测和结构化诊断。
- `src/core/artifacts.ts`：版本化 project、分析包及 CSV artifact 的单一 schema/version 来源。
- `src/adapters/browser-download.ts`：浏览器下载副作用，不包含科研计算。
- `scripts/acceptance-harness.mjs`：在线与离线页面测试共用的浏览器 adapter、fixture 和断言工具。
- `CONTEXT.md`：领域词汇；`docs/adr/`：需要长期保留的架构决策。

维护时优先从上述 interface 编写行为测试。实现被新 interface 测试覆盖后，应替换旧测试和旧路径，不在旁边长期叠加兼容 helper。

## 板图模板

最低必需字段：`well`、`group`、`biological_replicate`。推荐保留：

```csv
well,role,sample_id,group,treatment,concentration,timepoint,biological_replicate,technical_replicate,notes
A1,control,A549_NC_B1,NC,siNC,,Day0,B1,T1,
A2,control,A549_NC_B1,NC,siNC,,Day0,B1,T2,
```

`sample_id` 应在同一生物学重复的技术复孔之间保持一致。排除孔应明确记录 `excluded=true` 和原因，原始读值不会被覆盖。

“下载板图模板”用于从空白表开始填写；“导出当前板布局”用于复用系统中已经完成的注释。后者会记录格式版本、来源板型与孔位注释，但不会写入原始读数、空白校正值或统计结果。再次导入时，系统只按孔位更新当前数据板的注释层；重复一次独立实验时，建议在预览中选择清空生物学重复后重新编号。

## 扩展 interface

- 仪器格式：在 `src/core/instruments/` 增加 adapter，并在 `registry.ts` 注册，将文件统一规范化为 `ParsedPlate`。
- 实验类型：在 `src/core/assays/` 增加分析模块，将逐孔数据转换为实验特异结果。
- 模块工作流：在 `src/core/assay-workflows.ts` 集中声明检测方式、能力状态、必需信息、可用分析、延后分析和注释指引；UI 只消费这一处定义。

下一批建议在获得真实导出后实现 BCA/Bradford 与 ELISA 4PL/5PL 的实验特异反算和范围外 QC。每个模块必须自带真实或脱敏 fixture 和回归测试。

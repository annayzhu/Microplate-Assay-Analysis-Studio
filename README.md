# Microplate Assay Studio

面向酶标仪/多功能微孔板读数仪的一体化分析工作台。当前版本为 v0.4，使用真实 Thermo Scientific Varioskan LUX / SkanIt XML、XLSX 和旧版 VICTOR XLS 数据开发。

## 产品边界

- 独立工具，不嵌入 Visualization Studio 的数据导入层。
- 暂不写回 LabNest Result Template；分析包可先作为独立附件保存。
- 输出标准 tidy CSV，可继续送入 Visualization Studio 作图。
- 各实验模块复用统一仪器适配层和测量数据模型，但保留实验特异的计算与统计边界。

这能避免把 CCK-8 的空白扣除、复孔合并和对照归一化规则硬编码进通用可视化工具，也避免 Result Template 因不同实验类型增加大量必填字段。

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

人工录入的数值只代表孔板读数：空单元格视为未测，数字 `0` 会作为真实读数保留。新导入的孔默认标记为“未指定”，必须由用户补充样本、对照、空白等实验角色后，才能进入实验特异计算，避免系统根据数值擅自推断实验设计。

> `.skax` 是 SkanIt 会话归档，数值存储在内部专用数据块中。定量分析请在 SkanIt 中将会话导出为 XML 或 XLSX；工具会给出明确提示，不会把协议文件误当结果文件。

## 运行

要求 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

默认地址：`http://127.0.0.1:4178`

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
- CCK-8 的空白扣除、技术复孔合并、生物学汇总与对照归一化。
- 同一块板多个生物学重复的统计层级，以及疑似把技术复孔误填为生物学重复时的提示。
- 模块能力状态、识别/确认决策、带来源信息的 CSV 导出和可复现项目文件往返恢复。
- TypeScript 类型检查和生产构建。

真实仪器文件和厂商 demo 不上传到公开仓库。将获授权的数据放入本地 `tests/fixtures/` 与 `酶标仪demo/` 后，可运行：

```bash
npm run test:real
npm run test:unit
```

对应回归覆盖 96 孔 Varioskan CCK-8 文件，以及 ATP kinetic、BSA spectrum/concentration/purity、alamarBlue standard curve 和 Firefly/Renilla ratio。缺少本地数据时，相关 Vitest suite 会明确标记为 skipped。

## 板图模板

最低必需字段：`well`、`group`、`biological_replicate`。推荐保留：

```csv
well,role,sample_id,group,treatment,concentration,timepoint,biological_replicate,technical_replicate,notes
A1,control,A549_NC_B1,NC,siNC,,Day0,B1,T1,
A2,control,A549_NC_B1,NC,siNC,,Day0,B1,T2,
```

`sample_id` 应在同一生物学重复的技术复孔之间保持一致。排除孔应明确记录 `excluded=true` 和原因，原始读值不会被覆盖。

## 扩展接口

- 仪器格式：在 `src/core/instruments/` 增加 adapter，将文件统一解析为 `ParsedPlate`。
- 实验类型：在 `src/core/assays/` 增加分析模块，将逐孔数据转换为实验特异结果。
- 模块工作流：在 `src/core/assay-workflows.ts` 集中声明检测方式、能力状态、必需信息、可用分析、延后分析和注释指引；UI 只消费这一处定义。

下一批建议在获得真实导出后实现 BCA/Bradford 与 ELISA 4PL/5PL 的实验特异反算和范围外 QC。每个模块必须自带真实或脱敏 fixture 和回归测试。

# md2wechat Skill Spec

> 基于 Anthropic Skill 方法论（Context Engineering / Gotchas / Scripts / Description-as-Routing）驱动的结构化改进规格。
> 本文档约束所有后续对 md2wechat Skill 的改动。改 Skill 前先改 Spec，改完用验收条件验证。

---

## 1. 现状诊断

| # | 问题 | 对应 Anthropic 原则 |
|---|------|---------------------|
| 1 | SKILL.md 单文件 960 行，每次加载全量进入上下文 | #02 Context Engineering：上下文爆炸 |
| 2 | Gotchas（历史踩坑）散落在 SKILL.md 正文，未集中管理 | #01 隐性知识：Gotchas 是最有价值的部分 |
| 3 | preflight 检查逻辑让模型「读 Audit Log 判断」，可脚本化 | #03 尽量用脚本：重复劳动交给 Scripts |
| 4 | Description 是功能描述，非意图导向 | #04 Description 是路由规则 |
| 5 | 无明确的完成标准和验收条件 | 通用工程实践 |

---

## 2. 目标结构（渐进式暴露）

```
md2wechat/
├── SKILL.md                # 导航页（≤120 行），只描述管线和各步骤入口
├── .spec.md                # 本文档：结构规范 + 验收条件（不加载进上下文）
│
├── references/             # 详细说明、规则、历史踩坑
│   ├── gotchas.md         # 常踩的坑（Gotchas），按步骤分组
│   ├── audit-log.md       # Audit Log 解读规则 + 回检表格
│   ├── cover-prompts.md   # 封面提示词模板
│   └── writing-rules.md  # khazix-writer 规则摘要（替代读完整 SKILL.md）
│
├── scripts/                # 可执行脚本（重复劳动固化）
│   └── preflight-check.mjs  # 解析 Audit Log，自动判断是否通过
│
├── examples/               # 标准输出示例
│   └── sample-audit-log.md  # 标准 Audit Log 输出示例
│
└── assets/                 # 模板、固定素材
    └── lesssons-learned.md  # 活记忆器官（保持原位置，references/gotchas.md 是指向它的索引）
```

### 各文件职责

| 文件 | 加载时机 | 行数上限 | 职责 |
|------|---------|---------|------|
| `SKILL.md` | 每次加载 Skill | ≤ 120 行 | 管线概览 + 各步骤入口 + 触发词 |
| `references/gotchas.md` | 执行前、踩坑时 | ≤ 300 行 | 历史踩坑清单，按步骤分组 |
| `references/audit-log.md` | Step 4 回检时 | ≤ 200 行 | Audit Log 解读 + 回检表格 |
| `references/cover-prompts.md` | Step 2 生成封面时 | ≤ 100 行 | 封面提示词模板 |
| `references/writing-rules.md` | Step 0 改写时 | ≤ 150 行 | 写作规则摘要 |
| `scripts/preflight-check.mjs` | Step 3 推送前 | — | 自动解析 Audit Log，输出通过/不通过 |
| `examples/sample-audit-log.md` | 调试时 | ≤ 80 行 | 标准输出示例 |

---

## 3. Gotchas 覆盖标准

`references/gotchas.md` 必须覆盖以下场景（从历史教训中提取）：

### Step 0（改写）
- [ ] khazix-writer 尾部模板必须删除「投稿或爆料，请联系邮箱：xxx」整行
- [ ] 人格覆盖：替换「数字生命卡兹克」为用户的公众号身份
- [ ] 破折号 `——` 和中文双引号 `""` 必须在 Step 0 替换，不能等 lint 拦
- [ ] 插图检查：正文 > 800 字至少 1 张图，> 1500 字至少 2 张
- [ ] 参考资料连续 bullet 每条之间留空行，避免被段落长度检查合并误伤

### Step 1（渲染）
- [ ] 禁止绕路：不能用 inline import 替换 CLI 渲染
- [ ] `--env` 必须显式指定，否则 footer 不注入
- [ ] `--lint-report-out` 必须指定，否则 Audit Log 缺【渲染质检】区块
- [ ] `--footer-qr` 必须传绝对路径
- [ ] 手动 render 时，正文图片必须能从 HTML 输出目录解析；发布优先走 orchestrator

### Step 2（图片）
- [ ] 封面图必须 ≤ 2MB，超了用 `sips -Z` 压缩，覆盖原文件名
- [ ] 压缩后不要改名，改名会导致 HTML 中图片引用不匹配
- [ ] IMAGE_GEN_CLI 沙箱权限错误必须向用户申请授权，不能跳过或用旧图

### Step 2.5（Bundle）
- [ ] `.env` 是隐藏文件，`scp *` 不会复制，必须单独上传
- [ ] bundle 目录是 single source of truth，推送时只传这个目录里的文件

### Step 3（推送）
- [ ] 裁剪参数必须从 preflight 输出中复制，不能猜测
- [ ] 标题 ≤ 21 个中文字（微信 64 字节限制）
- [ ] digest（summary）≤ 120 字（微信 digest 限制）
- [ ] 正式推送默认走 relay，除非确认本机出口 IP 已在微信白名单
- [ ] relay 远端命令必须显式传 `--digest`；orchestrator 应从 `--digest` 或 frontmatter `summary` 取值

### Step 4（回检）
- [ ] `errcode: 0` ≠ 完成，必须逐行核对 Audit Log
- [ ] 缺少【渲染质检】区块 = lint report 没生成，回到 Step 1 补

### Step 5（完成前核查）
- [ ] skill-compliance-harness 不得跳过
- [ ] 输出自查结果格式：`[回检] img: N✅ / CDN: N✅ / ...`

---

## 4. Description 规范

### 现状
```
description: 从 Markdown 文件出发，改写→排版→发布三位一体的公众号文章管线。触发词：推公众号、发公众号、微信草稿箱、公众号排版、推送草稿、写公众号文章。
```

### 改进目标
Description 必须描述**用户意图和触发场景**，而非功能列表。改写方向：

```
description: >
  用户想把文章内容推送到微信公众号草稿箱时使用。
  触发场景包括：用户说"推一篇公众号""发到草稿箱""这篇文章排个版""帮我推微信公众号""文章内容写成公众号稿子"。
  如果用户只是想生成 Markdown 或预览排版效果，不需要加载本 Skill。
```

### 自查方法（Anthropic 原话）
> 写完 Description 后，把整个 Skill 删掉，只保留这一行 Description，然后问自己——模型看到用户的问题后，能不能知道什么时候该加载这个 Skill。如果做不到，就需要继续修改。

---

## 5. Scripts 与 Instructions 分工

| 职责 | 放在哪里 | 示例 |
|------|---------|------|
| 经验、判断、Gotchas | `SKILL.md` 或 `references/gotchas.md`（Instructions） | "staging 返回 200 不代表成功，需进一步检查" |
| 固定流程、可验证的检查 | `scripts/` 下的脚本（Scripts） | `preflight-check.mjs` 解析 Audit Log |
| 参数说明、命令模板 | `SKILL.md` 管线步骤中 inline | orchestrator 命令模板 |

### `scripts/preflight-check.mjs` 职责
- 输入：Audit Log 文本（stdin 或文件）
- 输出：JSON `{ passed: boolean, failures: string[] }`
- 检查项：img/CDN/h2/卡片/引用块/style/position/filter 是否全部通过

---

## 6. 评估集（Eval Suite）

> **评估集是 Skill 开发的第一步**，比写内容还重要。
> 存放路径：`evals/positive.txt`、`evals/negative.txt`、`evals/failure-cases.txt`

### 正例（positive.txt）

覆盖所有应该触发本 Skill 的真实用户 query，当前已添加 9 条。

验收标准：路由精确率 ≥ 95%。

### 负例（negative.txt）

覆盖不应该触发本 Skill 但场景接近的 query，当前已添加 9 条。

验收标准：路由召回率 ≥ 95%，误触发率 ≤ 5%。

### 失败案例（failure-cases.txt）

覆盖没有该 Skill 时模型出错的场景，当前已添加 6 条（Gotcha #G01/#G03/#G22/#G11/#G15/#G25）。

验收标准：加入 Gotcha 后，对应失败案例不再复现。

### 运行要求

- [ ] 覆盖不同模型（GPT/Claude Opus/Claude Sonnet）
- [ ] 修改 Description 后必须重新跑评估集
- [ ] 新增 Gotcha 后补充对应失败案例

---

## 7. 验收条件

改完 Skill 后，必须全部打勾才能宣布完成。

### 结构验收
- [ ] `SKILL.md` ≤ 120 行（不含 frontmatter）
- [ ] `references/` 下至少有 `gotchas.md`、`audit-log.md`、`cover-prompts.md`
- [ ] `scripts/preflight-check.mjs` 存在且可运行
- [ ] `.spec.md` 存在且与改进后的结构一致

### Gotchas 验收
- [ ] `references/gotchas.md` 覆盖第 3 节列出的所有 Gotchas
- [ ] 每条 Gotcha 格式：`> **Gotcha #NN**: 描述 — 解决方案`
- [ ] 新增 Gotcha 时必须同步更新 `references/gotchas.md`（不能只改 SKILL.md）

### Description 验收
- [ ] Description 描述用户意图，而非功能列表
- [ ] 通过「只留 Description 让模型判断加载」测试

### 功能验收
- [ ] 用一篇测试文章完整走完 Step 0–5，所有步骤正常
- [ ] Audit Log 解析脚本输出与手动核对结果一致
- [ ] skill-compliance-harness 能正确加载并核验

### 回归验收
- [ ] 不改 `references/khazix-writer/` 下的第三方内容（MIT License）
- [ ] `.env` 不被提交到 git（已有 `.gitignore`，改完检查）

---

## 7. 改不动时的降级策略

如果拆文件后发现某些信息「放 references 里模型经常找不到」，允许：
1. 在 `SKILL.md` 的对应步骤里加一行：`⚠️ 详细规则见 references/xxx.md`，并说明什么时候去读
2. 不做「为了拆而拆」的事——渐进式暴露的目的是**减少无效上下文**，不是强行分散信息

---

## Changelog

| 版本 | 日期 | 变更 |
|------|------|------|
| 0.1 | 2026-06-08 | 初版，基于 Anthropic Skill 方法论起草 |
| 0.2 | 2026-06-08 | 执行改进：拆出 references/（gotchas/audit-log/cover-prompts/writing-rules）；新写 scripts/preflight-check.mjs；重写 SKILL.md 至 118 行；创建 examples/sample-audit-log.md |
| 0.3 | 2026-06-08 | 补齐 Perplexity 原文差距：Description 改为 Load when 开头 + 英文；frontmatter 加入 depends:/eval-suite；创建 evals/ 评估集（positive/negative/failure-cases）；.spec.md 加入第 6 节评估集规范 |

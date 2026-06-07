# Changelog

所有 notable changes 都记录在此文件。

格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，
本项目遵守 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

## [0.4.0] - 2026-06-07

### Added

- **Orchestrator 一键调度**：`scripts/orchestrator.mjs` 把 render → preflight → bundle → push 压缩成单个命令，含 `--auto-fix` 自动修复和 `--dry-run` 流程验证
- **自动推送（--auto-push）**：orchestrator 支持自动通过系统 `ssh`/`scp` 完成远程目录创建、bundle 上传、远程执行 `create_wechat_draft.mjs`，无需手动复制命令
- **渲染前自动质检（pre-render lint）**：orchestrator 在调用渲染器前自动检查破折号/中文双引号/标题字数（≤21）/summary 字数（≤120）/正文>800字无插图
- **Preflight L3 检查**：
  - `narrative_perspective`：检测正文中 AI 视角表述（如"用户问我"），产出人工程序清单
  - `cover_placeholder_text`：强制要求人工确认封面图无占位文字
- **Relay 版本号自动递增**：orchestrator `--auto-push` 自动查询远程已有版本目录，递增生成 `v{N+1}`，避免手动指定
- **活记忆器官运行时加载**：`harness/memory-loader.mjs` 在渲染器启动时自动打印 `docs/LESSONS_LEARNED.md` 中的历史摩擦点风险提示
- **结构化 pipeline 日志**：每次运行写入 `.md2wechat-pipeline.jsonl`，作为 `self_report.mjs` 自动分析和 LESSONS_LEARNED 更新的输入源
- **Final Report Step 5 提醒**：orchestrator 在最终报告后强制输出 Harness 核查提醒，阻断"忘记调用 skill-compliance-harness"的摩擦点

### Changed

- **SKILL.md 流程升级**：新增 Step 0.5 Orchestrator 自动调度，明确 `--auto-push` 参数和典型使用流程
- **Preflight 规则版本**：`harness/push_rules.json` 升级到 `1.2.0`，新增 narrative_perspective 与 cover_placeholder_text 规则定义
- **版本号同步**：`package.json` 从 `0.2.0` 同步到 `0.4.0`（CHANGELOG 0.3.0 已发布但 package.json 未同步）

### Fixed

- **self_report YAML 解析 bug**：`_parseYaml()` 无法解析列表项内嵌套字段，导致摩擦点 description 被覆盖为 `undefined`；新增嵌套字段解析并跳过空 description
- **orchestrator 推送块替换残留**：修复字符串替换后残留旧代码片段导致的语法错误

## [0.3.0] - 2026-06-04

### Added

- **更新已有草稿**：`create_wechat_draft.mjs` 新增 `--update <media_id>` 和 `--update-index <number>` 参数，支持覆盖更新已有草稿而非新建（灵感来自 lurj 的 md2wechat 包）
- **SKILL.md 渲染前自检表**：Step 0 出口新增 5 项自检（破折号/双引号/标题≤21字/summary≤120字/插图占位），进 Step 1 前逐项确认，省一轮渲染往返
- **已知坑 #23–28**：基于 2026-06-04 管线执行复盘新增 6 条教训（渲染前自检、压缩覆盖原文件、crop 从 preflight 复制、Dreamina 沙箱、标题/digest 二次校验、文件名全管线一致性）
- **隐私门禁（P0 硬门禁）**：`scripts/privacy-check.sh` + `.github/workflows/privacy-check.yml`，CI 端强制扫描，命中 P0 直接拒绝推送
  - P0 阻断：API 密钥/私钥/JWT/凭据赋值/内网 IP
  - P1 警告：个人邮箱/手机号

### Changed

- **SKILL.md Step 2 图片压缩**：`--out cover-small.png` 改为 `--out cover.png`（覆盖原文件），杜绝文件名不匹配
- **SKILL.md Step 2 Dreamina CLI**：明确标注 `dangerouslyDisableSandbox: true`，避免被沙箱拦截后浪费时间
- **SKILL.md Step 3 推送**：补充 crop/title/digest 限制说明（裁剪参数从 preflight 复制、标题≤21字、summary≤120字）
- **README.md**：图片压缩示例同步覆盖原文件
- **CONTRIBUTING.md**：补充隐私门禁双防线说明和 pre-push hook 安装方法

### Fixed

- 隐私审查：移除 `wechat-draft-relay.mjs` 中的服务器用户名和目录结构泄露

## [0.2.0] - 2026-06-03

### Added

- **Step 5 完成前核查（skill-compliance-harness）**：管线最后一道门，加载独立的合规核查 skill 逐项核验 Audit Log 后才可汇报完成
- **skill-compliance-harness 依赖 skill**：`references/skill-compliance-harness/SKILL.md`，与 khazix-writer 并列作为必须安装的依赖
- **relay 持久目录 + 版本化历史**：推送目录改为按账号/日期/版本号组织（`<ACCOUNT>/<YYYYMMDD>_<TITLE>/v{N}/`），所有历史版本保留

### Changed

- **SKILL.md 全面升级**：
  - 完整流程加入 Step 5（Harness）
  - Step 0 插图检查从"必做"改为"不得跳过"
  - Step 1 增加禁止 inline import 替代 CLI 渲染的规则
  - Step 4 增加「逐行核验规程」
  - Step 3 relay 推送改为引用 `.env` 变量 + 版本化目录
  - 已知坑新增 #20（Harness 不可跳过）、#21（禁止 inline import）、#22（不推荐跳过 lint）
  - 依赖声明增加 `skill-compliance-harness`
- **relay 推送脚本路径改为占位符**：`wechat-draft-relay.mjs` 中的 `/home/admin/...` 硬编码路径替换为 `/path/to/your/relay/directory`

### Fixed

- 隐私审查：移除了 `wechat-draft-relay.mjs` 中的服务器用户名和目录结构泄露

## [0.1.0] - 2026-05-31

### Added

- **核心渲染引擎**：`render_wechat_editorial.mjs`，将 Markdown 转换为微信白名单合规的 HTML
  - 支持标准 Markdown（标题、段落、列表、引用块、代码块、表格）
  - 支持扩展指令：`:::wechat-card`（深浅两种 tone）、`:::wechat-alert`
  - 支持 Markdown 图片语法 `![alt](url)`，本地图片自动上传微信 CDN
  - 自动注入 footer（二维码 + CTA），支持通过 `.env` 或命令行参数配置
- **微信草稿箱推送**：`create_wechat_draft.mjs`，调用微信 API 将 HTML 推送到草稿箱
  - 支持 relay 跳板机模式（本地渲染 → SCP 到跳板机 → 跳板机推送）
  - 推送成功后自动调用 `draft/get` 回检，输出结构化 Audit Log
- **四层 lint 质检体系**：
  - **L1 写作质量 lint**：基于 khazix-writer 四层质控体系，检查禁用词、标点、结构套话、空泛工具名、超长段落
  - **L2 GEO 合规 lint**：检查摘要质量、结构化节点密度、H2 标题 SEO 友好度、标题搜索词覆盖
  - **L3 Markdown 指令 lint**：检查未知指令、非法 tone、缺少关闭标记
  - **L4 微信 HTML 合规 lint**：检查禁用 CSS 属性（position/filter/gradient）、禁用标签（`<style>`、`<script>`）
  - 渲染脚本新增 `--lint-report-out` 参数，输出结构化 JSON 供推送脚本合并到 Audit Log
  - 推送脚本新增 `--lint-report` 参数，读取 JSON 并在 Audit Log 中追加【渲染质检】区块
- **写作质量规则集**：`references/khazix-writer/rules.json`，从 khazix-writer 技能抽取，可自定义规则
- **示例文章**：`examples/` 目录包含完整的 Markdown 示例和渲染后的 HTML 预览
- **SKILL.md**：完整的 5 步发布流程指南（改写 → 渲染 → 封面 → 推送 → 回检），可直接作为 WorkBuddy Skill 使用
- **CONTRIBUTING.md**：贡献指南，包含 Conventional Commits 提交规范和开发须知

### Changed

- 项目从 wechat-publication-workflow 中抽离，去除所有硬编码和隐私信息，重新命名为 `md2wechat`
- README 顶部新增「一句话安装」引导，支持 AI Agent 自动安装
- Hero 模块改为图片+文字卡片上下布局（微信安全）
- 中文冒号 `：` 从 L1 硬性规则降级为 L2 建议规则

### Fixed

- `lintWechatHtml` 误报：重构为只检查 `style="..."` 属性值中的 CSS 属性，不再误报正文文字中出现的 CSS 属性名
- `:::wechat-card` 内部不支持表格渲染的问题已在文档中明确标注（表格必须放在卡片外部）
- 标题和 digest 的 GEO 优化：从纯悬念型改为「搜索词 + 悬念」双轨结构
- 渲染时 `--env` 参数缺失导致 footer 静默缺失的问题已在 SKILL.md 中强调

[Unreleased]: https://github.com/leether/md2wechat/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/leether/md2wechat/releases/tag/v0.4.0
[0.3.0]: https://github.com/leether/md2wechat/releases/tag/v0.3.0
[0.2.0]: https://github.com/leether/md2wechat/releases/tag/v0.2.0
[0.1.0]: https://github.com/leether/md2wechat/releases/tag/v0.1.0

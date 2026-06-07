---
name: md2wechat
description: 从 Markdown 文件出发，改写→排版→发布三位一体的公众号文章管线。触发词：推公众号、发公众号、微信草稿箱、公众号排版、推送草稿、写公众号文章。
agent_created: true
---

# 微信公众号文章管线（改写 → 排版 → 发布）

## 前置配置

本 skill 所有路径基于环境变量 `${PIPELINE_HOME}`（仓库根目录）和 `${NODE_PATH}`（Node 可执行文件路径）。

```bash
# 在 .env 或 shell 环境中设置（必须）
export PIPELINE_HOME=/path/to/md2wechat   # 本仓库根目录
export NODE_PATH=node                                     # 或 Node 完整路径
```

> **安装方式**：`git clone` 本仓库 → 复制 `.env.example` 为 `.env` → 填入凭据 → 设置 `PIPELINE_HOME`
>
> 仓库即 skill，skill 即仓库。所有脚本、规则、文档都在一个目录下。

## 完整流程

```
圆桌报告/素材 MD
  ↓ Step 0：风格改写（khazix-writer）
公众号文章 MD
  ↓ Step 1：渲染 HTML（render_wechat_editorial.mjs）
微信合规 HTML（含 CTA + 群二维码）
  ↓ Step 2：准备图片（封面图必须有，正文插图可选）
封面图 PNG
  ↓ Step 3：推送（relay 跳板机 → create_wechat_draft.mjs → 微信 API）
草稿箱
  ↓ Step 4：回检验证（Audit Log + 逐行核验）
已验证的草稿
  ↓ Step 5：完成前核查（skill-compliance-harness — 不得跳过）
✅ 确认发布
```

---

## Step 0：风格改写（必须使用 khazix-writer）

**这一步不能跳过。** 圆桌报告或研究素材是专业文本，需要改写成有"活人感"的公众号文章。

### 触发 khazix-writer

调用 `Skill` 工具，`skill: "khazix-writer"`，传入原始报告内容和改写要求。

> **khazix-writer 是外部 skill 依赖**。本仓库 `references/khazix-writer/` 包含其完整写作指南和规则文件（MIT License），供参考和 lint 使用。要触发风格改写，需确保 `khazix-writer` skill 已安装。

### ⚠️ 人格覆盖（必须执行）

khazix-writer 的 SKILL.md 以「数字生命卡兹克」为人格锚点写作，尾部固定带卡兹克署名和邮箱。**调用后必须覆盖以下内容**：

1. **身份替换**：忽略"你正在以数字生命卡兹克的身份写作"，替换为你自己的公众号身份
2. **尾部替换**：**完全删除** khazix-writer 的固定尾部模板（"作者：卡兹克" + "投稿或爆料，请联系邮箱：xxx"）。不要保留、不要替换为其他邮箱，直接整段删除。只保留你自己的公众号 CTA（如「点赞/在看/转发」）和署名
3. **口语化词组保留**：khazix-writer 推荐的口语化词组（"坦率的讲""说真的"等）是通用技巧，继续使用
4. **写作方法论保留**：四层自检、节奏感、开头必杀技、禁用词等是通用方法论，继续遵守

简单说：**方法论是工具，人格是品牌。工具拿过来，品牌换自己的。**

### 改写要点

0. **标题与摘要的 GEO 设计**
   - 标题：保持悬念/反常识风格（对人负责），但需埋入 1 个核心搜索词（对 AI 负责）。可用"悬念主标题 + 搜索词副标题"结构
   - digest（`summary: xxx`）：不要只概括大意，要写成"AI 可直接引用的答案片段"——包含核心结论 + 具体论据/数据/步骤
   - H2 标题：每个 H2 覆盖一个用户可能搜索的具体问题，不要纯叙事化

1. **保留核心论据和数据，关键数据标注来源**

2. **加入叙事弧，核心结论前置**
   - 从"现象/悬念"开头，按"观察→好奇→研究→洞察"推进
   - 每段首句放结论，后面展开论证——AI 提取摘要时读前 200 字，倒金字塔结构天然适配

3. **口语化转场，核心概念用多种自然表达覆盖**
   - 用"说到这个""回到xxx这块""坦率的讲"替代学术转场
   - 同一概念用不同说法表达（如"第一性原理"也讲"回到本质""从根上想"），既口语又覆盖语义空间

4. **排版信号（卡片/H2/引用块/列表）**
   - 改写时直接用 `:::wechat-card` / `## H2` / `>` / ``` 等渲染器支持的语法，省得二次改
   - 这些结构同时是 AI 理解内容的关键节点——卡片=信息块，H2=主题节点，列表=结构化提取
   - 每张卡片应是一个"可被 AI 独立引用的信息单元"（无需读卡片外上下文即可理解）
   - 每个引用块应包含一个完整、独立的核心观点

5. **作者信息**：按你的公众号填写作者名

6. **文章摘要**：MD 第一行加 `summary: xxx`，会渲染为 HTML comment 并被脚本自动提取为文章 digest
   - digest 是 AI 搜索决定是否引用你文章的第一依据
   - 涉及时效性内容标注时间戳（如"2026 年最新"）
   - 如果不加，digest 默认取正文前 54 字（可能包含 Markdown 标记）

### ⚠️ 插图检查（改写完成后必须执行，不得跳过）

纯文字长文在微信阅读场景中视觉单调、信息密度过高。**改写完必须按以下标准配图，不配图不得进入 Step 1**：

| 判断标准 | 建议 |
|---|---|
| 正文超过 800 字且无插图 | 至少加 1 张图，打断文字块 |
| 正文超过 1500 字 | 至少 2 张图，保持视觉节奏 |
| 内容涉及具体场景/人物/流程 | 配场景图、人物照或流程图，增强代入感 |
| 有数据/对比/时间线 | 考虑用信息图替代纯文字描述 |

**配图位置原则**：
- 放在概念引入之后、案例展开之前（帮助读者建立画面感）
- 放在长案例/故事之后（作为视觉停顿，让读者喘息）
- 避免连续两张图之间文字少于 300 字（太密）
- 避免 1000 字以上无图（太干）

**不需要配图的情况**：
- 短文案（<500 字）
- 纯观点/金句合集（信息密度本来就很低）
- 文章本身就是对视觉素材的评论/解读

> 插图生成建议：用 `IMAGE_GEN_CLI`（如即梦 Dreamina CLI）生成与文章主题匹配的场景图或概念图，比例建议 16:9 或 21:9，压缩至 2MB 以下后插入正文。

### ⚠️ 渲染前自检（Step 0 → Step 1 出口条件，不得跳过）

khazix-writer 产出天然包含破折号 `——` 和中文双引号，但这些会被 Step 1 的 L1 lint 挡下。**必须在进入 Step 1 之前逐项确认**：

| 检查项 | 判断标准 | 不通过怎么办 |
|--------|----------|-------------|
| 破折号 `——` | 0 处 | `Edit: replace_all("——", "，")` |
| 中文双引号 `""` | 0 处 | `replace_all` 替换为「」或直接删除 |
| 标题字数 | ≤ 21 个中文字（微信 64 字节限制） | 缩短标题，或在 `--title` 显式指定短标题 |
| `summary:` 字数 | ≤ 120 字（微信 digest 限制） | 精简 digest，只保留核心结论 + 关键数据 |
| 插图占位 | 正文 > 800 字时至少 1 张图 | 加 `![alt](placeholder-xxx.png)` 占位，Step 2 替换为真实图片 |

> **为什么破折号要在 Step 0 替换而非 Step 1 被 lint 拦下**：如果等 lint 阻拦再修，修完 MD 又要重跑渲染，白白浪费一轮。出口自检 = 省一轮。

### MD 中的排版语法（改写时直接嵌入）

渲染器支持的扩展语法——**改写时就要用上**，不要写完纯文本再返工加格式：

#### H2 章节标记
```markdown
## 章节标题
```
→ 渲染为橙色圆角区块（background:#d0784a，白色大字）

#### 深色卡片
```markdown
:::wechat-card
title: 卡片标题
tone: dark
- 列表项1
- 列表项2
:::
```
→ 深色背景 #3a3333，白色文字，蓝色边框

#### 浅色卡片
```markdown
:::wechat-card
title: 卡片标题
tone: light
- 列表项1
:::
```
→ 浅橙背景 #fff8f1，深色文字，橙色细边框

#### ⚠️ 卡片语法铁律
- **推荐写法**：`:::wechat-card` + `title:` + `tone:` 键值对（title 渲染为独立加粗标题行）
- **简写写法**：`:::wechat-card dark` / `:::wechat-card light`（tone 映射正确，但无独立标题行）
- **绝对禁止**：`:::wechat-card` 后跟非法 tone 值（如 red / blue），会被 lint 警告
- **必须关闭**：每个 `:::wechat-card` 必须有对应的 `:::`，否则整个块解析失败
- **⚠️ 卡片内部不支持表格**：`:::wechat-card` 里的 `|...|` 表格语法不会被解析，会被当成普通文本。表格必须放在卡片外部，由顶层 `parseMarkdown` 正确渲染

#### 正文插图（两种语法）

**方式一：标准 Markdown 图片语法**（简洁，推荐无 caption 时使用）

```markdown
![图片描述](/path/to/image.png)
```

→ 渲染为居中圆角图片，本地路径图片会被自动上传微信 CDN

**方式二：`:::wechat-image` 指令语法**（支持 caption 说明文字）

```markdown
:::wechat-image
src: /path/to/image.png
alt: 图片描述
caption: 图片说明
:::
```

→ 渲染为居中图片 + 下方说明文字，图片会被自动上传微信 CDN

> 两种语法效果相同，`:::wechat-image` 多一个 caption 功能。按需选择。

#### 引用块
```markdown
> 引用文字
>
> 支持多行，空行分隔段落
>
> - 内部列表项1
> - 内部列表项2
```
→ 左侧 3px 深色竖线，支持内部嵌套列表、代码块、段落

#### 围栏代码块
````markdown
```bash
cd ~/.workbuddy
npm install @cnbcool/cnb-cli
```
````
→ 深色背景 `#1b1e23` 代码块，等宽字体，适合展示命令行、架构图等

**注意**：微信公众号不支持 mermaid / PlantUML（需要 `<script>` JS 引擎）。流程图建议用深色卡片纵向排列，或放在代码块里用 ASCII 展示。

#### 数据表格
```markdown
| 列1 | 列2 | 列3 |
|-----|-----|-----|
| 值1 | 值2 | 值3 |
```
→ 圆角表格，橙色表头，交替行背景

---

## Step 1：渲染 HTML

```bash
${NODE_PATH} ${PIPELINE_HOME}/scripts/render_wechat_editorial.mjs \
  --input <markdown文件> \
  --output <输出html路径> \
  --env ${PIPELINE_HOME}/.env \
  --lint-report-out <lint报告json路径>
# ⚠️ --env 必须显式指定，否则 footer（二维码+CTA）不会注入
# ⚠️ --lint-report-out 必须指定，否则 lint 报告不生成、Audit Log 缺少【渲染质检】区块
# --lint-report-out 将四层 lint 结果（写作/GEO/MD指令/HTML合规）输出为结构化 JSON
#    供 create_wechat_draft.mjs 的 --lint-report 参数读取，合并到 Audit Log 的【渲染质检】区块
# footer 参数会自动从 .env 读取（FOOTER_QR_PATH / FOOTER_CTA / FOOTER_QR_TITLE / FOOTER_QR_HINT）
# 如需覆盖 .env 配置，可用命令行参数：
#   --footer-qr /path/to/qr.png --footer-cta "文案" --footer-qr-title "标题" --footer-qr-hint "提示"
# 如文章确实不需要 CTA，加 --no-footer 跳过 CTA 护栏检查
# 如 .env 中未配置 FOOTER_QR_PATH 且 MD 中有 CTA 信号，渲染会输出警告但不会阻止
```

⚠️ **禁止绕路**：不要用 inline import 替换 CLI 渲染。CLI 跑不通就修 CLI（检查 PIPELINE_HOME、Node 路径），不要写 `renderWechatEditorial(md, {})` 绕过 — 那样 footer 不会注入、`--env` 读不到、lint 报告不生成。

### 渲染后三重校验

渲染引擎自动运行三层 lint：

1. **`lintWritingQuality()`**（内容级）：L1 硬性规则（禁用词/标点/结构套话）+ L2 风格一致性（口语化/情绪标点/句长节奏）
2. **`lintGeoCompliance()`**（GEO 级）：L1 硬性规则（summary 缺失/零结构化）+ L2 建议（摘要无数据/H2 模糊/零引用块/零卡片）
3. **`lintMarkdownDirectives()`**（源码级）：未知指令、非法 tone 值、缺少关闭 `:::`、hero/image 不支持简写
4. **`lintWechatHtml()`**（输出级）：position/filter/gradient/!important/id=/事件属性等微信会过滤的属性

**若出现致命错误，修复 MD 源码后重新渲染。不要只修 HTML 不修 MD——HTML 是 MD 的派生产物。**

### 微信 HTML 合规规则

| 级别 | 禁止项 | 后果 |
|------|--------|------|
| 致命 | `position: absolute/fixed/sticky`、`<style>`、`<script>`、事件属性、`<iframe>`/`<form>`/`<input>` | 被微信直接删除 |
| 高风险 | `position: relative`、`filter:`、`linear-gradient`、`!important`、`font-family` 自定义、`transform`/`animation`/`calc()` | 兼容性不稳定，Dark Mode 下可能异常 |
| 安全 | 内联 `style="..."`、inline-block + margin（卡片圆点）、图片+文字卡片上下布局（Hero）、微信默认字体栈 | ✅ |

### 写作质量质检

渲染前自动扫描 Markdown 写作质量（基于 khazix-writer 四层质控体系）：

- **L1 硬性规则**（违规阻止渲染）：禁用词、禁用标点（破折号 `——`、中文双引号 `""`）、结构套话、空泛工具名、超长段落
- **L2 风格一致性**（违规输出警告）：宏大叙事开头、口语化不足、句长节奏单一、情绪标点缺失、过度加粗、建议替代标点（中文冒号 `：` 建议用逗号，但"标题：内容"短标题结构可保留）

```bash
# 跳过写作质检（不推荐）
--no-writing-lint

# 使用自定义规则文件
--writing-rules /path/to/my-rules.json

# L2 警告也视为错误
--strict-writing

# 跳过 GEO 合规检查（不推荐）
--no-geo-lint

# GEO L2 警告也视为错误
--strict-geo
```

规则文件默认位置：`${PIPELINE_HOME}/references/khazix-writer/rules.json`

---

## Step 2：准备图片

### 封面图（推送时必须，无图会自动生成占位图）

**优先级**：命令行 `--thumb-image` > `IMAGE_GEN_CLI` 自动生成 > 手动准备 > 纯色占位图

| 模式 | 触发条件 | 行为 |
|------|----------|------|
| **自动生成** | `.env` 中配了 `IMAGE_GEN_CLI` | 调用 CLI 生成封面图（如 Dreamina） |
| **手动准备** | 未配 `IMAGE_GEN_CLI`，但提供了 `--thumb-image` | 用你准备的任意图片 |
| **占位图 fallback** | 都没提供 | 自动生成 900×383 纯色 PNG（`#1a1a2e`），建议在微信后台替换 |

**自动生成模式**（`IMAGE_GEN_CLI` 已配置）：

Dreamina CLI 示例（`IMAGE_GEN_TOOL=dreamina`）：

```bash
# ⚠️ Dreamina CLI 在 WorkBuddy 沙箱中执行需要 dangerouslyDisableSandbox: true
#    遇权限拒绝时向用户申请授权后重试，不要自作主张跳过或用旧图
${IMAGE_GEN_CLI} text2image \
  --prompt="<封面描述>" \
  --model_version=${IMAGE_GEN_MODEL:-5.0} \
  --ratio=${IMAGE_GEN_RATIO:-21:9} \
  --poll=${IMAGE_GEN_POLL:-120}
# 如果被沙箱拒绝，加 dangerouslyDisableSandbox: true 重试
curl -L -o <输出路径>/cover.png "<返回的 image_url>"
```

自定义 CLI（`IMAGE_GEN_TOOL=custom`）：根据你的 CLI 文档自行调用，只要最终拿到 PNG/JPG 即可。

**手动准备模式**（`IMAGE_GEN_CLI` 未配置）：

推荐比例 2.35:1 或 21:9，用任何工具都行——Midjourney / DALL-E / Canva / 截图。

### 正文插图（可选，无图就不插）

用 `:::wechat-image` 在文章中嵌入插图。**不需要 fallback**——没有插图的文章一样正常渲染和推送。

```markdown
:::wechat-image
src: /path/to/image.png
alt: 图片描述
caption: 图片说明
:::
```

如果配了 `IMAGE_GEN_CLI`，正文插图也可以自动生成（跟封面图同一个 CLI）。
渲染时脚本会自动将本地图片上传至微信 CDN，替换为 `mmbiz.qpic.cn` URL。

### ⚠️ 图片大小限制

微信 API 对图片有大小限制（2MB）。AI 生成的高清图（Dreamina 通常 5–10MB）必须压缩：

```bash
# macOS — 压缩后覆盖原文件（⚠️ 不要改名，改名会导致 HTML 中的图片引用不匹配）
sips -Z 2000 /tmp/cover.png --out /tmp/cover.png

# 如果压缩后仍超 2MB，继续缩小尺寸：
sips -Z 1600 /tmp/cover.png --out /tmp/cover.png

# Linux（需安装 ImageMagick）
convert /tmp/cover.png -resize 2000x /tmp/cover.png
```

> **文件名一致性铁律**：压缩用 `--out` 覆盖原文件，不要生成 `cover-small.png` / `cover-compressed.png` 之类的新文件名。HTML 中引用的是原文件名，改名后要用 `mv` 恢复匹配——多一步可省的事就别多。

### ⚠️ 沙箱权限处理

如果 AI 图像工具报沙箱权限错误：

1. **必须向用户申请授权** — 使用 `dangerouslyDisableSandbox: true` 重新执行
2. **绝不自作主张跳过或用旧封面凑合** — 封面是文章门面，用错比没有还糟

---

## Step 3：推送到草稿箱

### 方式 A：通过 relay 跳板机推送（推荐）

适用于本地 IP 不在微信白名单的场景。

**relay 目录结构（已部署，后续无需重复上传脚本）：**
```
$WECHAT_RELAY_PUBLISH_ROOT/<ACCOUNT>/
├── shared/                          ← 所有日期共享
│   ├── .env                         ← 凭据
│   ├── qr.png                       ← 群二维码
│   └── scripts/
│       ├── create_wechat_draft.mjs
│       └── lib/
│
├── <YYYYMMDD>_<TITLE>/              ← 同一篇文章的所有版本
│   ├── v1/                          ← 首次推送
│   │   ├── article.html
│   │   ├── cover.png
│   │   ├── lint.json
│   │   ├── qr.png
│   │   └── 插图.png
│   ├── v2/                          ← 第一次修改重推
│   │   └── ...
│   └── v3/                          ← 第二次修改重推
│       └── ...
│
└── ...（后续新文章按此模式追加）
```

**版本规则：**
- 目录名 = `日期_TITLE`，不携带时间戳，同一篇文章的多次修改共享同一个目录
- `v1/` = 首次推送，`v2/` = 第一次修改，`v3/` = 第二次修改...
- 每次重推时查一下已有最大版本号，`v{N+1}` 递增
- 永不覆盖已有版本，所有历史完整保留

**路径配置（在 .env 中维护）：**
```bash
WECHAT_RELAY_HOST=ruoyu-ali                    # SSH 主机别名
WECHAT_RELAY_PUBLISH_ROOT=/home/admin/wechat-publish  # relay 根目录
WECHAT_RELAY_SHARED_DIR=/home/admin/wechat-publish/XINZHE/shared   # 共享目录
WECHAT_RELAY_SCRIPTS_DIR=/home/admin/wechat-publish/XINZHE/shared/scripts  # 脚本目录
```

```bash
# 1. 确定版本号：查 relay 上该文章目录下已有几版
ARTICLE_DIR="${WECHAT_RELAY_PUBLISH_ROOT}/<ACCOUNT>/<YYYYMMDD>_<TITLE>"
NEXT_VER=$(ssh ${WECHAT_RELAY_HOST} "ls -d ${ARTICLE_DIR}/v* 2>/dev/null | wc -l | tr -d ' '")
NEXT_VER=$((NEXT_VER + 1))
REMOTE_DIR="${ARTICLE_DIR}/v${NEXT_VER}"

# 2. 准备本地文件包
BUNDLE=/tmp/wechat-${TIMESTAMP}
mkdir -p $BUNDLE

# 正式文章和图片（按需替换路径）
cp <渲染后的html> $BUNDLE/article.html
cp <lint报告json> $BUNDLE/lint.json
cp <封面图> $BUNDLE/cover.png
# 正文插图：每个插图文件单独 cp

# 3. 替换 HTML 中的本地图片路径为文件名
${NODE_PATH} -e "
const fs = require('fs');
let h = fs.readFileSync('${BUNDLE}/article.html', 'utf8');
h = h.replace(/src=\\\"\/Users\/lize\/[^\"]*\/([^\/\"]+)\\\"/g, 'src=\"\$1\"');
fs.writeFileSync('${BUNDLE}/article.html', h);
"

# 4. 在 relay 上创建版本目录
ssh ${WECHAT_RELAY_HOST} "mkdir -p ${REMOTE_DIR}"

# 5. 上传文章文件（不含脚本——它们在 shared 中）
scp $BUNDLE/article.html ${WECHAT_RELAY_HOST}:${REMOTE_DIR}/
scp $BUNDLE/cover.png ${WECHAT_RELAY_HOST}:${REMOTE_DIR}/
scp $BUNDLE/lint.json ${WECHAT_RELAY_HOST}:${REMOTE_DIR}/
# 正文插图各自 scp ...

# 6. 从 shared 复制 .env 和 qr.png
ssh ${WECHAT_RELAY_HOST} "cp ${WECHAT_RELAY_SHARED_DIR}/.env ${REMOTE_DIR}/"
ssh ${WECHAT_RELAY_HOST} "cp ${WECHAT_RELAY_SHARED_DIR}/qr.png ${REMOTE_DIR}/"

# 7. 在 relay 上执行推送
ssh ${WECHAT_RELAY_HOST} "cd ${REMOTE_DIR} && \
  /usr/bin/node ${WECHAT_RELAY_SCRIPTS_DIR}/create_wechat_draft.mjs \
  --html article.html \
  --thumb-image cover.png \
  --lint-report lint.json \
  --title '<文章标题>' \
  --author '<作者名>' \
  --account <ACCOUNT> \
  --open-comment 1 \
  --crop-235-1 <裁剪参数>"
# --thumb-image 可省略，省略时自动生成纯色占位封面
# --lint-report 将渲染质检结果合并到 Audit Log，不传时 Audit Log 不含【渲染质检】区块
#
# ⚠️ 裁剪参数必须从推送脚本的 preflight 输出中获取（格式如 "0_0.0033_1_0.9967"），不可猜测。
#    错误的裁剪值会被微信 API 拒绝（preflight 会给出推荐值，直接复制使用）。
# ⚠️ 标题超 64 字节也会被微信拒绝——推送前确认标题 ≤ 21 个中文字。
# ⚠️ digest（summary）超限也会被拒——推送前确认 summary ≤ 120 字。
```

**确认脚本正确性：** 执行前检查 `NEXT_VER` 的值是否正确——如果文章目录下已有 `v1/` 和 `v2/`，则 `NEXT_VER` 应为 `3`。

# 2. 自动提取 HTML 中引用的本地图片（正文插图 + 二维码）
# 从 article.html 中提取所有 src="..." 指向本地路径的图片，复制到 bundle 并替换路径
${NODE_PATH} -e "
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync('$BUNDLE/article.html', 'utf8');
const localSrcs = [...html.matchAll(/src=\"((?:\\/tmp\\/|\\/Users\\/|\\/home\\/)[^\"]+)\"/g)].map(m => m[1]);
const seen = new Set();
for (const src of localSrcs) {
  if (seen.has(src)) continue;
  seen.add(src);
  if (fs.existsSync(src)) {
    const basename = path.basename(src);
    fs.copyFileSync(src, path.join('$BUNDLE', basename));
    console.log('Copied:', src, '->', basename);
  } else {
    console.warn('Missing:', src);
  }
}
"

# 3. 上传到跳板机
RELAY_HOST=<你的跳板机host>
ssh $RELAY_HOST "rm -rf /tmp/wechat-draft-bundle && mkdir -p /tmp/wechat-draft-bundle"
scp -r $BUNDLE/* $RELAY_HOST:/tmp/wechat-draft-bundle/
scp -r $BUNDLE/lib $RELAY_HOST:/tmp/wechat-draft-bundle/
# ⚠️ .env 是隐藏文件，* 通配符匹配不到，必须单独 scp
scp $BUNDLE/.env $RELAY_HOST:/tmp/wechat-draft-bundle/

# 4. 替换 HTML 中的本地绝对路径为文件名（通用 sed，适配所有本地路径）
ssh $RELAY_HOST "sed -i -E 's|src=\"((?:/tmp/|/Users/|/home/)[^\"]*/([^\"/]+))\"|src=\"\\2\"|g' /tmp/wechat-draft-bundle/article.html"

# 5. 在跳板机上推送
ssh $RELAY_HOST "cd /tmp/wechat-draft-bundle && node create_wechat_draft.mjs \
  --html article.html \
  --thumb-image cover.png \
  --lint-report lint.json \
  --title '<文章标题>' \
  --author '<作者名>' \
  --account <ACCOUNT> \
  --open-comment 1"
# --thumb-image 可省略，省略时自动生成纯色占位封面（建议在微信后台替换为正式封面）
# --lint-report 将渲染质检结果合并到 Audit Log，不传时 Audit Log 不含【渲染质检】区块
```

### 方式 B：本地直接推送

适用于本地 IP 在微信白名单的场景。

```bash
${NODE_PATH} ${PIPELINE_HOME}/scripts/create_wechat_draft.mjs \
  --html <渲染后的html> \
  --lint-report <lint报告json> \
  --title '<文章标题>' \
  --author '<作者名>' \
  --account <ACCOUNT> \
  --open-comment 1
# --thumb-image 可省略，省略时自动生成纯色占位封面（900x383，2.35:1）
# --lint-report 将渲染质检结果合并到 Audit Log，不传时 Audit Log 不含【渲染质检】区块
```

---

## Step 4：回检验证（自动输出 Audit Log）

推送成功后，`create_wechat_draft.mjs` **自动调用微信 API 拉回草稿并输出完整 Audit Log**。你不需要手动跑回检脚本——Audit Log 会直接在控制台输出：

```
━━━ md2wechat Audit Log ━━━
时间: 2026-05-31T10:49:48.123Z

【源文件】
MD: /tmp/elon-smart-requirements.md
HTML: /tmp/elon-smart-requirements-geo-v3.html
标题: 马斯克五步工作法：聪明人的需求最危险
作者: 新褶
账号: XINZHE

【资源清单】
  cover.png (1344.0KB)
  elon-img1-small.jpg (62.0KB)
  elon-img2-small.jpg (189.0KB)
  qr.png (127.0KB)

【推送结果】
  状态: ok
  media_id: a4juiPtSKGothnS6V3X9p...
  thumb_media_id: a4juiPtSKGothnS6V3X9p...

【微信回检】
  img标签: 3
  CDN图片: 3
  h2标题: 5
  卡片: 5 (深4 / 浅1)
  引用块: 1
  style属性: 136
  position: 0 ✅
  filter: 0 ✅

【渲染质检】          ← 当推送时传入 --lint-report 时显示
  写作质量: L1✅ (0处)  L2⚠️ (2处)
  GEO合规: L1✅ (0处)  L2⚠️ (1处)
  MD指令: ✅ (0处警告)
  HTML合规: ✅ (0处错误 / 0处警告)

━━━━━━━━━━━━━━━━━━━━━━━━━
```

如果 Audit Log 生成失败（如网络问题），会输出警告但不阻止流程，此时可手动回检：

```bash
# 手动回检（备用）
ssh $RELAY_HOST 'cd /tmp/wechat-draft-bundle && export $(grep -v "^#" .env | xargs) && node -e "
import {execFileSync} from \"node:child_process\";
const accountKey = \"<ACCOUNT>\";
const tokenResp = JSON.parse(execFileSync(\"curl\",[\"-L\",\"-sS\",\"https://api.weixin.qq.com/cgi-bin/stable_token\",\"-H\",\"Content-Type: application/json\",\"-d\",JSON.stringify({grant_type:\"client_credential\",appid:process.env[\"WECHAT_\"+accountKey+\"_APP_ID\"],secret:process.env[\"WECHAT_\"+accountKey+\"_APP_SECRET\"],force_refresh:false})],{encoding:\"utf8\"}));
const token = tokenResp.access_token;
const draftResp = JSON.parse(execFileSync(\"curl\",[\"-L\",\"-sS\",\"https://api.weixin.qq.com/cgi-bin/draft/get?access_token=\"+token,\"-H\",\"Content-Type: application/json\",\"-d\",JSON.stringify({media_id:\"<返回的media_id>\"})],{encoding:\"utf8\"}));
const content = draftResp.news_item[0].content;
console.log(\"img:\", (content.match(/<img/g)||[]).length);
console.log(\"CDN:\", (content.match(/mmbiz\\.qpic\\.cn/g)||[]).length);
console.log(\"h2:\", (content.match(/<h2/g)||[]).length);
console.log(\"cards:\", (content.match(/border-radius:22px/g)||[]).length);
"'
```

### 回检必须通过的检查项

| 检查项 | 期望值 | 含义 |
|--------|--------|------|
| `<img` | ≥ 1（封面+插图+二维码） | 所有图片已渲染 |
| `mmbiz.qpic.cn` | 与 `<img` 数量一致 | 图片全部上传微信 CDN |
| `style=` 属性 | > 50 | 内联样式完整保留 |
| `<h2` | > 0 | H2 章节块存在 |
| `border-radius:22px` | 与 MD 中卡片数一致 | 卡片全部渲染 |
| `background:#3a3333` | 与深色卡片数一致 | 深色卡片样式正确 |
| `background:#fff8f1` | 与浅色卡片数一致 | 浅色卡片样式正确 |
| `<table` | 与 MD 中表格数一致 | 表格正确渲染（卡片内表格=0 表示被静默忽略） |
| `background:#1b1e23` | 与 MD 中代码块数一致 | 围栏代码块正确渲染 |
| `padding:14px 16px;border-left:3px` | 与 MD 中引用块数一致 | 引用块合并渲染正确 |

**如果卡片数为 0 但 MD 中有 `:::wechat-card`：指令语法有问题，回到 Step 0 修复 MD 后重新走 Step 1-4。**

### ⚠️ 逐行核验规程（必须执行）

拿到 Audit Log 后，打开下面的"回检必须通过的检查项"表格，用 Audit Log 的每一行去对。**`errcode: 0` ≠ 完成**。

核验方法：
1. 打开 Audit Log 输出
2. 逐行比对期望值
3. 任何一项不满足 → **红灯**，返回上一步修复
4. 全部通过后才算回验完成

示例输出格式：
```
[回检] img: 4✅ / CDN: 4✅ / h2: 7✅ / 卡片: 1✅ / 引用块: 2✅ / style: 225✅ / position: 0✅ / filter: 0✅ / 渲染质检: ✅
各检查项均已通过。
```

---

## Step 5：完成前核查（事前 Harness，不得跳过）

**这是管线的最后一道门。** 在告知用户"完成"之前，必须先执行合规核查。

```bash
# 1. 加载 skill-compliance-harness
# 调用 Skill 工具：skill: "skill-compliance-harness"
# 不需要传参数，直接加载

# 2. harness 会自动定位本 SKILL.md 的 Verification 回检表格
# 3. 逐项核验 Audit Log 与输出产物
# 4. 输出核查报告
```

核查未通过不得汇报完成。返回修复后重新执行当前步骤，再次跑 harness。

---

## 关键配置

| 项目 | 路径/值 |
|------|--------|
| 渲染器 | `${PIPELINE_HOME}/scripts/render_wechat_editorial.mjs` |
| 草稿脚本 | `${PIPELINE_HOME}/scripts/create_wechat_draft.mjs` |
| 写作 lint | `${PIPELINE_HOME}/scripts/lint_writing_quality.mjs` |
| 写作规则 | `${PIPELINE_HOME}/references/khazix-writer/rules.json` |
| 凭据 | `${PIPELINE_HOME}/.env`（WECHAT\_\<ACCOUNT\>\_APP\_ID/SECRET） |
| 二维码 | `.env` 中 `FOOTER_QR_PATH` 指定的图片（本地放 `assets/qr.png`，开源用户可自行替换或不配） |
| 作者 | 按你的公众号填写 |
| 账号 | `--account <ACCOUNT>`，对应 .env 中的凭据 key |
| 写作风格 | `khazix-writer` Skill（必须安装） |
| Node 路径 | `${NODE_PATH}` |

---

## 依赖声明

### Skill 依赖
- **khazix-writer**（Step 0 风格改写必须使用）— 完整写作指南见 `references/khazix-writer/SKILL.md`
- **skill-compliance-harness**（Step 5 完成前核查必须使用）— 管线最后一道门，逐项核验通过后才可汇报完成

### 外部工具依赖
- **Node.js ≥ 18**（渲染器运行时）
- **curl**（微信 API 调用）
- **SSH/SCP**（relay 跳板机模式）
- **图片生成 CLI**（Step 2 封面图自动生成，可选配置。配了走自动，没配走手动或占位图 fallback。正文插图同理但无 fallback——没图就不插）

### 零 npm 依赖
本仓库所有脚本均为纯 Node.js，无需 `npm install`。

---

## 已知坑与教训

1. **必须使用 khazix-writer 改写**：圆桌报告是专业文本，直接渲染会像投研报告不像公众号文章。改写时就要嵌入 `:::wechat-card` / `## H2` 等排版语法，避免二次返工
2. **compactWechatHtml 不要自动剥 style**：HTML 超 2 万字符时，脚本曾自动剥所有 style 属性导致格式全丢。已修复为始终保留。微信 API 实际不严格执行 2 万字限制
3. **图片必须走微信 CDN**：HTML 中的本地图片路径会被脚本自动上传并替换为 mmbiz.qpic.cn URL
4. **跳板机上需替换本地路径**：HTML 中的本地绝对路径在跳板机上不存在，需 sed 替换为相对路径
5. **AI 图像工具沙箱权限 → 必须向用户申请授权**：不要自作主张跳过或用旧封面凑合。封面是门面，用错比没有还糟
6. **封面图自动 fallback**：推送脚本 `--thumb-image` 现在是可选参数。未提供时自动生成 900x383 纯色占位 PNG（`#1a1a2e`），保证草稿箱可用。建议在微信后台替换为正式封面
7. **:::wechat-card 语法必须正确**：
   - 推荐：`:::wechat-card` + `title:` + `tone:` 键值对（有独立标题样式）
   - 简写：`:::wechat-card dark` / `:::wechat-card light`（tone 映射正确，无独立标题行）
   - 渲染引擎有 `lintMarkdownDirectives()` 源码校验，会报告指令格式问题
8. **双重 lint 覆盖**：`lintMarkdownDirectives()` 检查源码指令 + `lintWechatHtml()` 检查输出 HTML。两者互补，缺一不可
9. **回检必须看卡片数**：不只看 style 属性数，还要确认 `border-radius:22px` 数量与 MD 中卡片数一致。卡片被静默忽略时 style 数看起来也正常
10. **封面图必须压缩**：AI 生成的封面图常超 2MB，微信 API 限制会报 45001。用 `sips -Z 2000`（macOS）或 `convert -resize`（Linux）压缩后再推送
11. **SCP .env 需单独处理**：`.env` 是隐藏文件，`scp *` 匹配不到，必须 `scp .env` 单独传
12. **卡片内部不支持表格**：`:::wechat-card` 里的 `|...|` 表格语法不会被解析，会被当成普通文本。表格必须放在卡片外部
13. **摘要元数据 `summary:`**：MD 第一行写 `summary: xxx`，脚本会自动提取为文章 digest。不加的话 digest 默认取正文前 54 字，可能包含 Markdown 反引号等标记
14. **CTA 护栏：检测到 CTA 信号但未配置 footer 时降级警告**：如果 Markdown 中包含 `## 总结/最后/结语` 或正文有"扫码/二维码/交流群"等 CTA 信号，但 `.env` 和命令行均未提供 footer 配置，脚本会输出警告（而非阻止渲染）。配置了 `.env` 的 `FOOTER_QR_PATH` 则自动附加 footer，用 `--no-footer` 显式跳过
15. **IP 护栏：推送脚本会拦截非白名单环境的本地推送**：在 `.env` 中配置 `WECHAT_PUBLISH_ALLOWED_HOSTS` 或 `WECHAT_PUBLISH_ALLOWED_IPS` 后，`create_wechat_draft.mjs` 会自动拒绝非白名单环境的推送请求，防止"本地直接跑 → ip_not_in_whitelist"的重复踩坑。临时本地调试可设 `WECHAT_PUBLISH_FORCE_LOCAL=1`
16. **写作质量质检（khazix-writer 规则）**：渲染前会自动扫描 Markdown 的写作质量。L1（禁用词/破折号/双引号/结构套话）违规阻止渲染，L2（风格一致性+中文冒号建议）输出警告。跳过用 `--no-writing-lint`，自定义规则用 `--writing-rules <path>`，L2 也视为错误用 `--strict-writing`。规则文件位于 `references/khazix-writer/rules.json`
17. **khazix-writer 人格覆盖**：khazix-writer 以「数字生命卡兹克」身份写作，尾部固定带卡兹克署名和邮箱。调用后必须覆盖人格和署名，只保留写作方法论。详见 Step 0「人格覆盖」
18. **渲染时必须用 --env 指定 .env 路径**：不传 `--env` 时，渲染器可能读不到 `.env`，导致 footer（二维码+CTA）静默缺失。命令示例已包含 `--env ${PIPELINE_HOME}/.env`，请勿省略
19. **Markdown 图片语法 `![alt](url)` 已支持**：渲染器支持标准 Markdown 图片语法，也可用 `:::wechat-image` 指令（多 caption 功能）。两种语法按需选择
20. **Step 5 完成前核查（Harness）不可跳过**：管线执行到最后一步、准备告知用户完成之前，必须先加载 `skill-compliance-harness` 逐项核查。不通过不得汇报完成
21. **禁止用 inline import 替代 CLI 渲染**：`renderWechatEditorial(md, {})` 不会读取 `.env`、不会注入 footer、不会生成 lint 报告。必须使用 CLI 命令传递 `--env` 和 `--lint-report-out`
22. **写作质检和 GEO 质检不推荐跳过**：`--no-writing-lint` 和 `--no-geo-lint` 仅在调试时使用，正式推送前必须恢复
23. **渲染前自检 = 省一轮渲染**：khazix-writer 产出天然包含破折号 `——`。如果在 Step 1 才被 lint 挡住，修完 MD 要重跑渲染。在 Step 0 出口就把破折号/双引号/标题长度/summary 长度全部自检一遍，Step 1 一遍过
24. **图片压缩覆盖原文件，不另存新名**：`sips -Z 2000 cover.png --out cover.png`（覆盖），不要用 `--out cover-small.png`（新文件）。HTML 中引用的是原文件名，新文件名会导致渲染时找不到图
25. **封面裁剪参数从 preflight 输出复制，不猜**：`create_wechat_draft.mjs` 的 preflight 阶段会输出推荐裁剪值（格式 `"0_0.0033_1_0.9967"`），直接复制到 `--crop-235-1`。猜测的值几乎必然被微信 API 拒绝
26. **Dreamina CLI 需要 dangerouslyDisableSandbox**：WorkBuddy 沙箱环境会拦截 Dreamina CLI 的执行。首次调用被拒后，向用户申请授权，加 `dangerouslyDisableSandbox: true` 重试
27. **标题和 digest 推送时也会被微信二次校验**：渲染时的 lint 挡不住标题/digest 超限，推送时微信 API 会直接拒。在 Step 0 出口自检标题 ≤21 字、summary ≤120 字，避免推到 relay 再报错返工
28. **文件名一致性贯穿全管线**：MD 占位图 → 生成真实图 → 压缩保持原名 → 更新 MD 引用路径 → HTML 路径替换。每一步都要对齐文件名，不要在不同阶段用不同后缀（`-compressed` / `-small` / `-v2`）
29. **符号链接会导致 CLI 入口判断失败**：`render_wechat_editorial.mjs` 末尾用 `path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)` 判断是否为主入口。当仓库通过符号链接访问时（如 `~/.workbuddy/skills/md2wechat -> ~/workspace/md2wechat`），`process.argv[1]` 是链接路径而 `import.meta.url` 解析为真实路径，导致 `main()` 不被调用、渲染无输出。修复方案是同时比较 `fs.realpathSync(process.argv[1])` 和 `fileURLToPath(import.meta.url)`

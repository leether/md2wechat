# md2wechat

> *每次渲染完贴到微信后台，排版不是崩了就是样式被吃了一半。后来自己写了个渲染器，终于不用再猜微信会过滤什么了。*

从 Markdown 文件出发，改写 → 排版 → 发布三位一体。渲染器只输出微信白名单合规的 HTML，双重 lint 确保不翻车，一条命令推到草稿箱。

## 适合 / 不适合

**适合你，如果：**
- 你用 Markdown 写公众号文章，受够了手动排版
- 你想让 AI（WorkBuddy / Claude Code / Codex）自动走完「写作→渲染→推送」全流程
- 你需要自定义排版风格，不想被第三方编辑器绑架
- 你在找一整套可以装进 AI skill 的公众号发布工作流

**不适合你，如果：**
- 你需要可视化拖拽编辑——这是命令行工具，没有 GUI
- 你只想美化纯文本，不涉及微信 API 推送——渲染器可以单独用，但它的价值在端到端
- 你需要复杂交互组件（轮播、SVG 动画）——微信会过滤 JS/CSS，这些根本不现实

## 一分钟跑起来

```bash
git clone https://github.com/leether/md2wechat.git
cd md2wechat
cp .env.example .env          # 填入你的公众号 AppID / AppSecret

# 渲染 + 推送，两步搞定
node scripts/render_wechat_editorial.mjs \
  --input examples/sample-article.md \
  --output /tmp/article.html
# footer 参数从 .env 自动读取（FOOTER_QR_PATH / FOOTER_CTA 等）
# 不配 .env 则文章无尾部 footer，CTA 护栏降级为警告

node scripts/create_wechat_draft.mjs \
  --html /tmp/article.html \
  --account YOUR_ACCOUNT \
  --author "你的名字"
# --thumb-image 可省略，省略时自动生成纯色占位封面
```

零 npm 依赖，纯 Node.js，不需要 `npm install`。

## 完整流程

```
素材 / 圆桌报告 MD
  ↓ Step 0：风格改写（khazix-writer，可选）
公众号文章 MD
  ↓ Step 1：渲染 HTML（render_wechat_editorial.mjs）
微信合规 HTML
  ↓ Step 2：准备图片（封面图必须有，正文插图可选）
封面 PNG
  ↓ Step 3：推送草稿箱（create_wechat_draft.mjs）
  ↓ Step 4：回检验证
✅
```

### Step 0：风格改写

**可选但推荐。** 如果你用 AI 写公众号，安装 [khazix-writer](https://github.com/KKKKhazix/Khazix-Skills) skill 可以让文章有"活人感"——口语化转场、节奏感、禁用 AI 味高频词。

> ⚠️ **人格覆盖**：khazix-writer 以「数字生命卡兹克」身份写作，尾部带卡兹克署名和邮箱。调用后必须替换为你自己的署名和 CTA。方法论是工具，人格是品牌。

### Step 1：渲染 HTML

```bash
node scripts/render_wechat_editorial.mjs \
  --input article.md \
  --output article.html
# footer 参数从 .env 自动读取，也可用命令行参数覆盖：
#   --footer-qr ./assets/qr.png --footer-qr-title "交流群" --footer-qr-hint "扫码加入" --footer-cta "和我们一起探索"
```

渲染器自动运行两层 lint：
- **源码级** `lintMarkdownDirectives()`：检查未知指令、缺少关闭标记、非法参数
- **输出级** `lintWechatHtml()`：检查 `position` / `filter` / `gradient` / `!important` 等微信会过滤的属性

**尾部 CTA + 二维码**：在 `.env` 中配置 `FOOTER_QR_PATH` / `FOOTER_CTA` / `FOOTER_QR_TITLE` / `FOOTER_QR_HINT`，渲染时自动附加。不配置则文章无 footer，CTA 护栏降级为警告（不阻止渲染）。如文章明确不需要，加 `--no-footer`。

渲染效果示例（真实二维码）：

<div align="center">

![二维码](assets/qr.png)

*文章尾部自动附加的 CTA + 二维码区块*

</div>

### Step 2：准备图片

**封面图**（推送时必须，无图会自动生成占位图）：

| 模式 | 触发条件 | 行为 |
|------|----------|------|
| 自动生成 | `.env` 配了 `IMAGE_GEN_CLI` | 调用 CLI 生成（如 Dreamina） |
| 手动准备 | 未配 CLI，但提供了 `--thumb-image` | 用你准备的任意图片 |
| 占位图 fallback | 都没提供 | 自动生成 900×383 纯色 PNG，建议微信后台替换 |

**正文插图**（可选，无图就不插）：

在 Markdown 中用 `:::wechat-image` 嵌入，本地图片会被自动上传至微信 CDN。不需要 fallback——没有插图的文章一样正常。

```markdown
:::wechat-image
src: /path/to/image.png
alt: 图片描述
caption: 图片说明
:::
```

微信对图片有 2MB 限制，高清图需压缩：

```bash
# macOS
sips -Z 2000 cover.png --out cover-small.png
```

### Step 3：推送草稿箱

**方式 A：本地直接推送**（本地 IP 在白名单时）

```bash
node scripts/create_wechat_draft.mjs \
  --html article.html \
  --thumb-image cover.png \
  --account YOUR_ACCOUNT \
  --author "作者名" \
  --open-comment 1
# --thumb-image 可省略，省略时自动生成纯色占位封面（建议在微信后台替换）
```

**方式 B：通过跳板机推送**（本地 IP 不在白名单时）

```bash
# 打包 → SCP 到跳板机 → SSH 远程执行推送
# 详见 SKILL.md Step 3
```

### Step 4：回检

推送后必须从微信 API 拉回草稿验证，确认卡片数、样式、图片 CDN 等指标正常。详见 SKILL.md Step 4。

## Markdown 扩展语法

渲染器在标准 Markdown 之上支持以下扩展，写文章时直接用：

### H2 章节标记

```markdown
## 章节标题
```

→ 橙色圆角区块，白色大字，文章分节用

### 深色 / 浅色卡片

```markdown
:::wechat-card
title: 核心洞察
tone: dark
- 要点1
- 要点2
:::
```

→ 深色背景 `#3a3333`，蓝色边框

```markdown
:::wechat-card
title: 温馨提示
tone: light
- 补充说明
:::
```

→ 浅橙背景 `#fff8f1`，橙色细边框

> ⚠️ 卡片内部**不支持表格**——表格放在卡片外部。
> 每个 `:::wechat-card` 必须有对应的 `:::` 关闭标记。

### 正文插图

```markdown
:::wechat-image
src: /path/to/image.png
alt: 图片描述
caption: 图片说明
:::
```

→ 居中图片 + 说明文字，本地图片自动上传微信 CDN

### 引用块

```markdown
> 金句或补充说明
>
> 支持空行分段和嵌套列表
> - 嵌套项
```

→ 左侧 3px 深色竖线

### 围栏代码块

````markdown
```bash
echo "hello"
```
````

→ 深色背景 `#1b1e23`，等宽字体

### 数据表格

```markdown
| 列1 | 列2 |
|-----|-----|
| 值1 | 值2 |
```

→ 圆角表格，橙色表头，交替行背景

### 文章摘要

MD 第一行写 `summary: xxx`，脚本自动提取为微信文章 digest。不写的话默认取正文前 54 字。

## 写作质量质检

渲染器内置了基于 [khazix-writer](https://github.com/KKKKhazix/Khazix-Skills) 四层质控体系的自动化扫描：

**L1 硬性规则**（违规 → 阻止渲染）：
- 禁用词："说白了""本质上""不可否认"等 AI 味高频词
- 禁用标点：中文冒号 `：`、破折号 `——`、中文双引号 `""`
- 结构套话："首先…其次…最后""在当今…的时代"
- 空泛工具名："AI工具""某个模型"
- 超长段落：超过 350 字

**L2 风格一致性**（违规 → 输出警告）：
- 宏大叙事开头、口语化词组不足、句长节奏单一、情绪标点缺失

```bash
# 跳过写作质检（不推荐）
--no-writing-lint

# 自定义规则文件
--writing-rules ./my-rules.json

# L2 警告也视为错误
--strict-writing
```

规则文件：`references/khazix-writer/rules.json`，可自行修改。

## 微信 HTML 合规规则

| 级别 | 禁止项 | 后果 |
|------|--------|------|
| 致命 | `position: absolute/fixed/sticky`、`<style>`、`<script>`、事件属性、`<iframe>` | 被微信直接删除 |
| 高风险 | `position: relative`、`filter:`、`linear-gradient`、`!important`、自定义 `font-family` | Dark Mode 下可能异常 |
| 安全 | 内联 `style="..."`、inline-block、图片+文字卡片 | ✅ |

详细规则见 [docs/wechat-html-compliance.md](docs/wechat-html-compliance.md)。

## 项目结构

```
md2wechat/                          # 仓库 = 可安装的 WorkBuddy Skill
├── SKILL.md                          # Skill 主文件（参数化，无绝对路径）
├── scripts/
│   ├── render_wechat_editorial.mjs   # Markdown → HTML 渲染器
│   ├── create_wechat_draft.mjs       # 推送草稿箱脚本
│   ├── lint_writing_quality.mjs      # 写作质量质检
│   └── lib/
│       ├── memory-lib.mjs            # 参数解析工具
│       └── wechat-draft-relay.mjs    # Relay 辅助工具
├── references/khazix-writer/         # 写作指南和规则（MIT License）
│   ├── SKILL.md                      # 原版写作指南
│   ├── rules.json                    # 可执行的 lint 规则
│   ├── style_examples.md             # 风格示例
│   ├── content_methodology.md        # 选题方法论
│   └── LICENSE
├── examples/
│   └── sample-article.md             # 示例文章
├── docs/
│   └── wechat-html-compliance.md     # 微信 HTML 合规详解
├── assets/                           # 放你的二维码等资源
├── .env.example                      # 环境变量模板
├── LICENSE
└── README.md
```

## 安装为 WorkBuddy Skill

```bash
# 1. 克隆到任意位置
git clone https://github.com/leether/md2wechat.git

# 2. 创建符号链接（skill 名称 = 仓库名称）
ln -s /path/to/md2wechat ~/.workbuddy/skills/md2wechat

# 3. 配置环境变量
cd md2wechat && cp .env.example .env
# 编辑 .env，填入公众号凭据和路径

# 4. 设置 PIPELINE_HOME
export PIPELINE_HOME=/path/to/md2wechat
```

之后在 WorkBuddy 中说"推公众号""发公众号"即可触发完整流程。

## 安全护栏

- **CTA 护栏**：文章含 CTA 信号（总结/结语/扫码关键词）但未配置 footer 时，输出警告（不阻止渲染）。配了 `.env` 的 `FOOTER_QR_PATH` 则自动附加
- **IP 环境护栏**：在 `.env` 中配置 `WECHAT_PUBLISH_ALLOWED_HOSTS` / `WECHAT_PUBLISH_ALLOWED_IPS`，非白名单环境阻止推送
- **写作质检护栏**：L1 规则违规阻止渲染，不会带着 AI 味文章上线

## 致谢

- 写作风格指南和质检规则衍生自 [KKKKhazix/Khazix-Skills](https://github.com/KKKKhazix/Khazix-Skills)（MIT License）
- 原始风格文档详见 `references/khazix-writer/` 目录

## 许可证

MIT License — 详见 [LICENSE](LICENSE)

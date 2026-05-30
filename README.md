# wechat-article-pipeline

微信公众号文章渲染与发布工具链 —— Markdown 转微信合规 HTML，推送草稿箱。

## 功能

- **自研渲染器**：Markdown → 微信白名单合规 HTML，无需依赖第三方排版工具
- **扩展排版语法**：深色/浅色卡片、H2 章节块、引用块、代码块、表格
- **双重校验**：源码级 lint + 输出级 lint，确保 HTML 在微信编辑器中不翻车
- **CTA 护栏**：自动检测文章中的 CTA 信号，漏传二维码参数时拦截
- **IP 环境护栏**：防止在非白名单环境误执行推送
- **草稿箱推送**：直接调用微信 API 创建草稿，支持封面图裁剪

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/<your-username>/wechat-article-pipeline.git
cd wechat-article-pipeline
```

### 2. 配置凭据

```bash
cp .env.example .env
# 编辑 .env，填入你的公众号 AppID 和 AppSecret
```

`.env` 格式：

```bash
# 公众号凭据，<ACCOUNT> 为大写英文名
WECHAT_MY_ACCOUNT_APP_ID=your_app_id
WECHAT_MY_ACCOUNT_APP_SECRET=your_app_secret
```

### 3. 渲染文章

```bash
node scripts/render_wechat_editorial.mjs \
  --input article.md \
  --output article.html \
  --footer-qr ./assets/qr.png \
  --footer-qr-title "交流群" \
  --footer-qr-hint "扫码加入" \
  --footer-cta "和我们一起探索"
```

如果文章不需要 CTA，加 `--no-footer` 跳过护栏检查。

### 4. 推送草稿箱

```bash
node scripts/create_wechat_draft.mjs \
  --html article.html \
  --thumb-image cover.png \
  --account MY_ACCOUNT \
  --author "作者名"
```

### 5. 验证

推送成功后，脚本会返回 `media_id`。前往 [微信公众号后台](https://mp.weixin.qq.com/) 草稿箱查看。

## Markdown 扩展语法

### H2 章节标记

```markdown
## 章节标题
```

渲染为橙色圆角区块（background:#d0784a，白色大字）。

### 深色卡片

```markdown
:::wechat-card
title: 卡片标题
tone: dark
- 列表项1
- 列表项2
:::
```

### 浅色卡片

```markdown
:::wechat-card
title: 卡片标题
tone: light
- 列表项1
:::
```

### 引用块

```markdown
> 引用文字
>
> 支持多行和嵌套列表
> - 嵌套项
```

### 围栏代码块

````markdown
```bash
echo "hello"
```
````

### 数据表格

```markdown
| 列1 | 列2 |
|-----|-----|
| 值1 | 值2 |
```

### 文章摘要

MD 第一行写 `summary: xxx`，脚本会自动提取为文章 digest。

## 微信 HTML 合规规则

| 级别 | 禁止项 | 后果 |
|------|--------|------|
| 致命 | `position: absolute/fixed/sticky`、`<style>`、`<script>`、事件属性、`<iframe>` | 被微信直接删除 |
| 高风险 | `position: relative`、`filter:`、`linear-gradient`、`!important`、自定义 `font-family` | Dark Mode 下可能异常 |
| 安全 | 内联 `style="..."`、inline-block、图片+文字卡片 | ✅ |

## 项目结构

```
wechat-article-pipeline/
├── scripts/
│   ├── render_wechat_editorial.mjs    # Markdown → HTML 渲染器
│   ├── create_wechat_draft.mjs        # 推送草稿箱脚本
│   └── lib/
│       ├── memory-lib.mjs             # 参数解析工具
│       └── wechat-draft-relay.mjs     # Relay 辅助工具
├── examples/
│   └── sample-article.md              # 示例文章
├── assets/                            # 放你的二维码、封面模板等
├── docs/                              # 文档
├── .env.example                       # 环境变量模板
├── .gitignore
├── LICENSE
├── package.json
└── README.md
```

## Relay 跳板机（可选）

如果你的本地 IP 不在微信白名单中，可以通过 SSH 跳板机推送：

```bash
# 1. 打包文件
BUNDLE=/tmp/wechat-draft-bundle
mkdir -p $BUNDLE
cp article.html $BUNDLE/
cp cover.png $BUNDLE/
cp .env $BUNDLE/

# 2. 上传到跳板机
scp -r $BUNDLE/* relay-host:/tmp/wechat-draft-bundle/
scp $BUNDLE/.env relay-host:/tmp/wechat-draft-bundle/  # 隐藏文件需单独传

# 3. 在跳板机上执行推送
ssh relay-host "cd /tmp/wechat-draft-bundle && node create_wechat_draft.mjs \
  --html article.html --thumb-image cover.png --account MY_ACCOUNT --author '作者名'"
```

## 已知限制

1. **卡片内部不支持表格**：`:::wechat-card` 里的表格语法不会被解析，需放在卡片外部
2. **不支持 Mermaid / PlantUML**：微信编辑器不支持 JS 引擎，流程图用 ASCII 或卡片代替
3. **封面图需自行准备**：渲染器不生成封面图，推荐使用 [Dreamina](https://dreamina.jianying.com/) 等 AI 工具
4. **图片需走微信 CDN**：脚本会自动上传本地图片并替换为 `mmbiz.qpic.cn` URL

## 写作质量质检

渲染器内置了基于 [khazix-writer](https://github.com/KKKKhazix/Khazix-Skills) 四层质控体系的自动化扫描：

### L1 硬性规则（违规阻止渲染）

- 禁用词扫描："说白了"、"本质上"、"不可否认"等 AI 味高频词
- 禁用标点扫描：中文冒号 `：`、破折号 `——`、中文双引号 `""`
- 结构套话扫描："首先…其次…最后"、"在当今…的时代"
- 空泛工具名扫描："AI工具"、"某个模型"等模糊表述
- 段落长度检查：超过 350 字的段落

### L2 风格一致性（违规输出警告）

- 开头检查：是否宏大叙事而非具体事件切入
- 口语化词组统计：全文至少 8 个不同的口语化表达
- 句长节奏分析：连续 3 句句长相近则警告
- 情绪标点检测：是否使用了 `。。。` `？？？` `= =`
- 过度格式化检测：连续加粗行过多

### 自定义规则

规则文件位于 `references/khazix-writer/rules.json`，可自行修改禁用词列表、段落长度阈值等。

```bash
# 跳过写作质检（不推荐）
node scripts/render_wechat_editorial.mjs --input article.md --output out.html --no-writing-lint

# 使用自定义规则文件
node scripts/render_wechat_editorial.mjs --input article.md --output out.html --writing-rules ./my-rules.json

# L2 警告也视为错误
node scripts/render_wechat_editorial.mjs --input article.md --output out.html --strict-writing
```

## 致谢

- 写作风格指南和质检规则衍生自 [KKKKhazix/Khazix-Skills](https://github.com/KKKKhazix/Khazix-Skills)（MIT License）
- 原始风格文档详见 `references/khazix-writer/` 目录

## 许可证

MIT License — 详见 [LICENSE](LICENSE)

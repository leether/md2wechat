# 贡献指南

感谢你对 md2wechat 的关注！以下是如何参与贡献的说明。

## 快速开始

```bash
git clone https://github.com/leether/md2wechat.git
cd md2wechat
cp .env.example .env   # 填入你的测试公众号凭据
```

零 npm 依赖，不需要 `npm install`，有 Node.js ≥ 18 即可运行。

## 如何贡献

### 报告问题

- 在 [Issues](../../issues) 中搜索是否已有相同问题
- 新建 Issue，包含：复现步骤、期望行为、实际行为、Node.js 版本
- 渲染相关的问题，请附上**原始 Markdown**和**渲染后的 HTML 截图**

### 提交代码

1. Fork 本仓库
2. 创建分支：`git checkout -b feat/your-feature` 或 `fix/your-fix`
3. 提交变更：`git commit -m "feat: 简短描述"`
4. 推送分支：`git push origin feat/your-feature`
5. 创建 Pull Request

### 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
feat: 新增 :::wechat-alert 指令支持
fix: 修复深色卡片内列表缩进丢失
docs: 补充 relay 跳板机配置说明
refactor: 抽离 lint 逻辑为独立脚本
chore: 更新 .env.example
```

## 开发须知

### 渲染器架构

```
Markdown 输入
  ↓ parseMarkdownDirectives()   解析扩展指令（:::wechat-card 等）
  ↓ parseMarkdown()             标准 Markdown → HTML
  ↓ lintMarkdownDirectives()    源码级校验
  ↓ lintWechatHtml()            输出级校验
  ↓ lintWritingQuality()        写作质量校验
HTML 输出
```

### 微信 HTML 白名单铁律

**只允许内联 `style="..."`**，以下会被微信直接删除或导致排版异常：

- ❌ `position: absolute/fixed/sticky`
- ❌ `<style>` / `<script>`
- ❌ 事件属性（onclick 等）
- ❌ `filter:` / `linear-gradient` / `!important`
- ❌ 自定义 `font-family`

提交 PR 前请确认渲染输出通过了 `lintWechatHtml()`。

### 测试

用示例文章验证渲染结果：

```bash
node scripts/render_wechat_editorial.mjs \
  --input examples/sample-article.md \
  --output /tmp/test.html
```

检查输出 HTML 中：
- `style=` 属性数量 > 50
- `position:` 出现次数 = 0
- `filter:` 出现次数 = 0
- 卡片数与 Markdown 中 `:::wechat-card` 数量一致

### 隐私门禁（硬门禁，提交前必过）

项目有两道防线：

| 防线 | 触发点 | 方式 |
|------|--------|------|
| **GitHub Actions** | push/PR 到 main | 服务端硬门禁，无法绕过 |
| **本地 pre-push** | `git push` | 本地第一道防线 |

**P0 阻断**（命中即拒绝推送）：
- API 密钥（OpenAI/GitHub/Slack/AWS 等已知格式）
- 私钥（PEM 头/SSH 私钥）
- JWT Token
- 通用凭据赋值（非占位值的 `SECRET=`/`TOKEN=`/`PASSWORD=` 等）
- 内网 IP（192.168 / 10.x / 172.16-31）

**P1 警告**（不阻断，但会提醒确认）：
- 个人邮箱
- 手机号码

**本地运行**：
```bash
./scripts/privacy-check.sh --full
```

**安装 pre-push hook**（可选，推荐）：
```bash
ln -sf ../../scripts/privacy-check.sh .git/hooks/pre-push
```

## 目录结构

```
scripts/
├── render_wechat_editorial.mjs    # 核心渲染器
├── create_wechat_draft.mjs        # 推送草稿箱
├── lint_writing_quality.mjs       # 写作质量质检
└── lib/
    ├── memory-lib.mjs             # 参数解析
    └── wechat-draft-relay.mjs     # Relay 辅助

references/khazix-writer/          # 写作指南（MIT License，上游仓库）
```

## 许可证

提交代码即表示你同意以 MIT License 授权你的贡献。

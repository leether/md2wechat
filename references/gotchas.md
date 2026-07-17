# Gotchas — md2wechat 常踩的坑

> 加载时机：执行对应 Step 前必读。新增 Gotcha 时同步更新此文件。
> 格式：`**Gotcha #NN**: 描述 — 解决方案`

---

## Step 0：风格改写（khazix-writer）

**Gotcha #G01**: khazix-writer 尾部模板含「投稿或爆料，请联系邮箱：xxx」整行 — 必须完全删除，不要保留、不要替换为其他邮箱。

**Gotcha #G02**: khazix-writer 以「数字生命卡兹克」为人格锚点 — 调用后必须覆盖身份：替换为你自己的公众号身份，删除卡兹克署名。

**Gotcha #G03**: 破折号 `——` 和中文双引号 `""` 会被 Step 1 的 L1 lint 拦下 — 必须在 Step 0 替换（`replace_all("——", "，")` / 替换为「」），不能等 lint 拦。

**Gotcha #G04**: 正文 > 800 字且无插图时不得进入 Step 1 — 至少加 1 张图打断文字块；> 1500 字至少 2 张。

**Gotcha #G05**: `summary:` 是 GEO 第一依据 — 必须写成「AI 可直接引用的答案片段」（含核心结论 + 具体论据），不能只概括大意；≤ 120 字。

**Gotcha #G34**: 连续参考资料 bullet 会被段落长度检查合并 — 「参考资料」这类连续 `- link` 列表，每条之间留一个空行；否则可能被 L1 超长段落误伤。

---

## Step 1：渲染 HTML

**Gotcha #G06**: 禁止绕路 — 不能用 inline import 替换 CLI 渲染。CLI 跑不通就修 CLI（检查 PIPELINE_HOME、Node 路径），不要写 `renderWechatEditorial(md, {})` 绕过 — 那样 footer 不会注入、`--env` 读不到、lint 报告不生成。

**Gotcha #G07**: `--env` 必须显式指定 — 省略时 footer（二维码 + CTA）不会注入。

**Gotcha #G08**: `--lint-report-out` 必须指定 — 省略时 lint 报告不生成，Audit Log 缺少【渲染质检】区块。

**Gotcha #G09**: HTML 是 MD 的派生产物 — 修复 lint 错误时必须改 MD 源码，不能只改 HTML。

**Gotcha #G10**: 卡片内部不支持表格 — `:::wechat-card` 里的 `|...|` 表格语法不会被解析，会被当成普通文本。表格必须放在卡片外部。

**Gotcha #G35**: `--footer-qr` 必须传绝对路径 — 相对路径会以 HTML 输出目录再次拼接，可能生成双重相对路径，导致 footer QR 在 preflight 或 relay 上找不到。

**Gotcha #G36**: 手动 render 时图片必须能从 HTML 输出目录解析 — 如果 HTML 输出到 `publish/v1/article.html`，正文 `assets/*.png` 需要在 `publish/v1/assets/` 存在；更推荐直接用 orchestrator，让 bundle 处理路径替换。

---

## Step 2：准备图片

**Gotcha #G11**: 封面图必须 ≤ 2MB — AI 或设计工具生成的高清图通常需要用 `sips -Z 2000` 压缩；压缩后仍超则继续缩小 `sips -Z 1600`。

**Gotcha #G12**: 压缩用 `--out` 覆盖原文件名 — 不要生成 `cover-small.png` 之类的新文件名，改名会导致 HTML 中图片引用不匹配。

**Gotcha #G13**: 图片生成 provider 不可用 — 必须停下来要求用户补图或确认替代方案，不能自作主张跳过或用旧封面凑合正式发布。

**Gotcha #G14**: 封面图残留模板文字 — AI 生成的封面图可能残留「【中文标题放置区】」等模板文字，推送前必须目视检查封面图。

---

## Step 2.5：Bundle

**Gotcha #G15**: `.env` 是隐藏文件 — `scp *` 不会复制，必须单独 `scp .env relay:.../`。

**Gotcha #G16**: bundle 目录是 single source of truth — 推送时只传 bundle 目录里的文件，不要从原始输出目录零散复制。

**Gotcha #G17**: 本地路径替换必须在 bundle 阶段完成 — HTML 中所有 `src="/Users/..."` 或 `src="/tmp/..."` 必须替换为纯文件名，否则微信 API 会失败。

---

## Step 3：推送到草稿箱

**Gotcha #G18**: 裁剪参数必须从 preflight 输出中复制 — 格式如 `"0_0.0033_1_0.9967"`，不可猜测；错误的裁剪值会被微信 API 拒绝。

**Gotcha #G19**: 标题 ≤ 21 个中文字（微信 64 字节限制）— 超长时必须在 `--title` 显式指定短标题。

**Gotcha #G20**: `summary:` / digest ≤ 120 字（微信 digest 限制）— 超限会被微信 API 拒绝。

**Gotcha #G21**: `orchestrator --auto-push` 会自动处理版本号递增 — 手动推送时才需要查已有最大版本号，`v{N+1}` 递增，永不覆盖已有版本。

**Gotcha #G37**: 正式推送默认走 relay — 本机 IP 未进入微信白名单时会触发 `40164 invalid ip`；除非确认当前出口 IP 已加入白名单，否则不要本机直推。

**Gotcha #G38**: relay 推送必须显式传 `--digest` — 不传时低层脚本会退回正文前 54 字，可能覆盖精心写好的摘要。Orchestrator 会从 `--digest` 或 frontmatter `summary` 读取并传到 relay。

**Gotcha #G39**: article bundle 上传不等于 relay 共享脚本部署 — `--auto-push` 只调用已安装的 writer。正式推送前必须让 `sync_relay_scripts.mjs --check` 通过；漂移时停止并单独申请 `--apply`，不要让普通文章推送隐式修改 relay runtime。

---

## Step 4：回检验证

**Gotcha #G22**: `errcode: 0` ≠ 完成 — 必须逐行核对 Audit Log 与回检表格，任何一项不匹配 = 红灯，回到上一步修复。

**Gotcha #G23**: 缺少【渲染质检】区块 = `--lint-report` 没传 — 回到 Step 1 补渲染并传出 lint report。

**Gotcha #G24**: 卡片数为 0 但 MD 中有 `:::wechat-card` — 指令语法有问题（tone 值非法或缺少关闭 `:::`），回到 Step 0 修复 MD 后重新走 Step 1–4。

---

## Step 5：完成前核查

**Gotcha #G25**: skill-compliance-harness 不得跳过 — 在告知用户「完成」之前，必须先加载并逐条核验。

**Gotcha #G26**: 自查结果输出格式必须规范 — `[回检] img: N✅ / CDN: N✅ / h2: N✅ / 卡片: N✅ / 引用块: N✅ / style: N✅ / position: 0✅ / filter: 0✅`

---

## Step 0.6：微信 API 预检（渲染前）

**Gotcha #G27**: 标题 > 64 字节触发截断 — 中文每个字 3 字节（UTF-8），实际只能放 ≤ 21 个中文字。在 Step 0 结束时检查：`node -e "if(process.argv[1].length>64)process.exit(1)" -- "$(python3 -c 'import sys;print(len(sys.argv[1].encode("utf-8")))' -- "")`，超长时缩短。

> `python3 -c "t='标题';print(len(t.encode('utf-8')))"` 预先算好再写 `--title`。

**Gotcha #G28**: digest > 128 字节触发微信 API 45004 错误 — frontmatter `summary:` 会被脚本作为 digest 传给微信。≤ 128 字节（约 42 个中文字）。**最安全的做法**：让 Orchestrator 从 `--digest` 或 frontmatter `summary` 读取后显式传给 relay，不要依赖低层脚本自动取正文前 54 字。

> 实在想自动截断可在 Step 0 末尾用 `node -e "const s='...';console.log(s.slice(0,40))"` 预检。

## Step 2.6：Bundle 完整性验证

**Gotcha #G29**: bundle 目录必须整体上传而非零散文件 — `bundle_wechat_article.mjs` 会打包所有资源（图片、HTML、lint.json），推送脚本只读 bundle/ 目录内的文件。孤立的文件不会出现在 bundle 中。

> 推送前在 relay 上用 `ls -la bundle/` 确认：HTML 存在 + 图片数量和本地一致 + lint.json 存在。

## Step 3.1：frontmatter author 清洗

**Gotcha #G30**: frontmatter `author:` 会泄漏到微信推送 — create_wechat_draft.mjs 读取 author 字段写入微信草稿。写个人名字会暴露身份，写公众号名称不符合微信规范。**强制规则**：`author:` 必须为空、`公众号名称`、或与账号 ID 一致——不允许写个人名字。

**Gotcha #G31**: stdout 不是发布证据 — 成功 push 必须在文章 `publish/vN/` 同时留下 `audit.log` 与 `push-result.json`；relay 推送必须把两份文件带回本地再报完整成功。

**Gotcha #G32**: 草稿消失不等于已发布 — `freepublish` 对无权限账号可返回 `48001`，因此对账只能标 `published-or-deleted`，等待人工或权威证据确认。

**Gotcha #G33**: 对账不得从未入白名单的本机直连微信 API — 使用 `reconcile_wechat_drafts.mjs` 经 `WECHAT_RELAY_*` 执行，`--write` 只修复唯一标题匹配的 stale id，封面空值单列。

## 新增 Gotcha 记录模板

```markdown
**Gotcha #GNN**: 描述 — 解决方案
```

> 新增后同步更新 `../.spec.md` 第 3 节（Gotchas 覆盖标准）。

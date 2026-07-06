# Audit Log 解读规则

> 加载时机：Step 4 回检时必读。拿到 Audit Log 输出后，逐行与此文档核对。

---

## Audit Log 标准格式

```
━━━ md2wechat Audit Log ━━━
时间: <ISO timestamp>

【源文件】
MD: <markdown路径>
HTML: <html路径>
标题: <文章标题>
作者: <作者名>
账号: <ACCOUNT>

【资源清单】
  <文件名> (<大小KB>)

【推送结果】
  状态: ok
  media_id: <微信media_id>
  thumb_media_id: <封面media_id>

【微信回检】
  img标签: <N>
  CDN图片: <N>
  h2标题: <N>
  卡片: <N> (深<N>/浅<N>)
  引用块: <N>
  style属性: <N>
  position: <N> ✅/❌
  filter: <N> ✅/❌

【渲染质检】          ← 当推送时传入 --lint-report 时显示
  写作质量: L1✅ (0处)  L2⚠️ (<N>处)
  GEO合规: L1✅ (0处)  L2⚠️ (<N>处)
  MD指令: ✅ (0处警告)
  HTML合规: ✅ (0处错误/0处警告)
━━━━━━━━━━━━━━━━━━━━━━━━━
```

> ⚠️ 缺少【渲染质检】区块 = `--lint-report` 没传或 lint.json 没生成 → 回到 Step 1 补。

---

## 回检必须通过的检查项

| 检查项 | 期望值 | 含义 | 不通过怎么办 |
|--------|--------|------|-------------|
| `<img` | ≥ 1（封面+插图+二维码） | 所有图片已渲染 | 回到 Step 1–2 检查图片语法 |
| `mmbiz.qpic.cn` | 与 `<img` 数量一致 | 图片全部上传微信 CDN | 检查图片是否 ≤ 2MB，重新上传 |
| `style=` 属性 | > 50 | 内联样式完整保留 | HTML 被微信过滤，检查 position/filter |
| `<h2` | > 0 | H2 章节块存在 | 回到 Step 0 确认 MD 中有 `## H2` |
| `border-radius:22px` | 与 MD 中卡片数一致 | 卡片全部渲染 | 检查 `:::wechat-card` 语法是否关闭 |
| `background:#3a3333` | 与深色卡片数一致 | 深色卡片样式正确 | 检查 tone: dark 是否拼写正确 |
| `background:#fff8f1` | 与浅色卡片数一致 | 浅色卡片样式正确 | 检查 tone: light 是否拼写正确 |
| `<table` | 与 MD 中表格数一致 | 表格正确渲染 | 注意：卡片内表格 = 0（被静默忽略） |
| `background:#1b1e23` | 与 MD 中代码块数一致 | 围栏代码块正确渲染 | 检查 `` ``` `` 语法是否正确关闭 |
| `padding:14px 16px;border-left:3px` | 与 MD 中引用块数一致 | 引用块渲染正确 | 检查 `>` 语法是否正确 |

---

## 逐行核验规程（必须执行）

1. 打开 Audit Log 输出
2. 逐行比对上表「期望值」
3. 任何一项不满足 → **红灯**，返回上一步修复
4. 全部通过后才算回检完成

### 自查结果输出格式

```
[回检] img: 4✅ / CDN: 4✅ / h2: 7✅ / 卡片: 1✅ / 引用块: 2✅ / style: 225✅ / position: 0✅ / filter: 0✅
各检查项均已通过。
```

---

## 常见问题排查

| 症状 | 原因 | 解决方案 |
|------|------|---------|
| `img: 0` | HTML 中无 `<img` 标签 | 检查 MD 中图片语法，确认 Step 2 已执行 |
| `CDN: 0` 但 `img: N` | 图片未上传微信 CDN | 检查图片是否 ≤ 2MB，本地路径是否已替换 |
| `h2: 0` | MD 中无 `## H2` | 回到 Step 0 补充 H2 章节标记 |
| `卡片: 0` 但 MD 中有 `:::wechat-card` | 指令语法错误（tone 值非法或缺少关闭 `:::`） | 回到 Step 0 修复 MD，重新走 Step 1–4 |
| `position: N`（N > 0） | HTML 含 `position:` 属性，会被微信过滤 | 回到 Step 1，检查 lint 报告，移除 position |
| `filter: N`（N > 0） | HTML 含 `filter:` 属性，兼容性不稳定 | 回到 Step 1，移除 filter |
| 缺少【渲染质检】区块 | `--lint-report` 没传或 lint.json 没生成 | 回到 Step 1，指定 `--lint-report-out`，重新渲染 |

---
name: md2wechat
description: >
  Load when user wants to push an article to WeChat official account draft box.
  Triggers include: "推公众号", "发到草稿箱", "公众号排版", "推送草稿".
  Do NOT load for Markdown preview or local rendering only.
agent_created: true
depends: [khazix-writer, skill-compliance-harness]
metadata:
  author: lize
  version: 2.0.0
  eval-suite: ./evals/
---

# 微信公众号文章管线

## 流程

```
素材 MD → Step 0：改写 → Step 0.5：Orchestrator（推荐）
  → Step 1：渲染 → Step 2：图片 → Step 2.5：Bundle
  → Step 3：推送 → Step 4：回检 → Step 5：核查
```

---

## Step 0：改写（khazix-writer）

`Skill: "khazix-writer"`。
⚠️ 删尾部模板「投稿或爆料…」整行，替换身份。正文 > 800 字至少 1 张图。
详细规则：`references/gotchas.md` #G01–#G05、#G34 + `references/writing-rules.md`。

---

## Step 0.5：Orchestrator（推荐）

```bash
node ${PIPELINE_HOME}/scripts/orchestrator.mjs \
  --input article.md --account YOUR_ACCOUNT \
  --title "标题" --digest "摘要" --author "公众号作者" \
  --qr /abs/path/to/footer-qr.png \
  --auto-fix --auto-push
```

⚠️ 发布优先用 Orchestrator，不要手动拆 render/bundle/push。`--digest` 不传时会读取 frontmatter `summary` 并传到 relay；`--qr` 必须传绝对路径，避免 footer QR 在 render/preflight 间被拼成错误相对路径。

---

## Step 1：渲染

```bash
node ${PIPELINE_HOME}/scripts/render_wechat_editorial.mjs \
  --input <md> --output <html> \
  --env ${PIPELINE_HOME}/.env \
  --footer-qr /abs/path/to/footer-qr.png \
  --lint-report-out <lint.json>
```
⚠️ `--env` 和 `--lint-report-out` 必须指定。`--footer-qr` 一律使用绝对路径。禁止绕路用 inline import 替换 CLI。
Gotchas：`references/gotchas.md` #G06–#G10、#G35–#G36。

---

## Step 2：图片

封面图必须有（≤ 2MB）。生成 → 压缩 → 覆盖原文件（不要改名）。
提示词模板：`references/cover-prompts.md`。
Gotchas：`references/gotchas.md` #G11–#G14。

---

## Step 2.5：Bundle

```bash
node ${PIPELINE_HOME}/scripts/bundle_wechat_article.mjs \
  --html <html> --out <dir> \
  --lint <lint.json> --qr <footer-qr.png>
```
⚠️ `.env` 是隐藏文件，必须单独 `scp`。
Gotchas：`references/gotchas.md` #G15–#G17。

---

## Step 3：推送

```bash
ssh relay "cd <dir> && node create_wechat_draft.mjs \
  --html article.html --thumb-image cover.png \
  --lint-report lint.json --title '标题' --digest '摘要' --account <ACCOUNT> \
  --audit-out audit.log --push-result-out push-result.json"
```
⚠️ 正式推送默认走 relay，并优先用 Orchestrator：它会显式传递 digest，把
relay 的 `audit.log` 和 `push-result.json` 带回文章 `publish/vN/`，并在可
唯一定位时回写 CATALOG。本机直推只有在确认当前 IP 已进微信白名单时才可用。
证据或 Backlink 不完整时即使微信已收稿也必须报非零。裁剪参数必须从
preflight 输出复制。标题 ≤ 21 中文字，digest ≤ 120 字。
Gotchas：`references/gotchas.md` #G18–#G21、#G31–#G33、#G37–#G38。

---

## Step 4：回检

推送成功后 Audit Log 自动落盘并可输出。逐行核对
`references/audit-log.md` 中的检查项；结构化结果见同目录
`push-result.json`。
```bash
node ${PIPELINE_HOME}/scripts/preflight-check.mjs --file <audit.log> --require-render-qa

node ${PIPELINE_HOME}/scripts/reconcile_wechat_drafts.mjs \
  --catalog <CATALOG.md> --account <ACCOUNT> --env ${PIPELINE_HOME}/.env
```
对账默认只读且经 relay；草稿消失只标 `published-or-deleted`，封面空值单列。
Gotchas：`references/gotchas.md` #G22–#G24、#G31–#G33。

---

## Step 5：核查（不得跳过）

```bash
Skill: "skill-compliance-harness"
```
输出自查结果：`[回检] img: N✅ / CDN: N✅ / ...`
Gotchas：`references/gotchas.md` #G25–#G26。

---


所有历史踩坑在 `references/gotchas.md`，按 Step 分组。
新增 Gotcha 必须同步更新 `references/gotchas.md` 和 `.spec.md` 第 3 节。

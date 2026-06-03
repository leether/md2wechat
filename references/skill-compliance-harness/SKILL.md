---
name: skill-compliance-harness
description: 在执行管线型/多步骤 skill 后、告知用户完成前，强制逐项核查 skill 自带的 Verification/回检章节，确认所有 check item 通过后才能汇报完成。触发词：无主动触发——当其他 skill 执行到"完成"前自动加载。
description_zh: Skill 执行合规核查
description_en: Skill execution compliance harness
disable: false
agent_created: true
---

# Skill 执行合规核查（事前 Harness）

## 触发条件

**自动触发**：在任何管线型/多步骤 skill（如 md2wechat、tdx-market-recap-to-wechat）执行到最后一步、准备告知用户"完成"之前，必须执行本 harness。

**手动触发**：用户说"检查一下"、"再确认一遍"、"跑一下 harness"、"事前检查"。

**原则**：宁可多走一遍核查，不可跳过查清单。

## 强制步骤

### Step 1：定位 Verification 章节

打开当前正在使用的 skill 的 SKILL.md，搜索以下关键词：
- `## Verification`
- `## 回检必须通过的检查项`
- `## Step 4`（如果有）
- `## 已知坑与教训`
- 以及 SKILL.md 中所有包含 `✅` / `❌` / `检查` 的章节

如果该 skill 的 Verification 章节为空或不存在，找 skill 中最接近的校验段落。

### Step 2：逐项列清单

把 Verification 章节中的每一项拆成一个独立的检查项。示例（md2wechat 的检查项）：

```
[  ] img ≥ 1（封面+插图+二维码）
[  ] CDN图片数 = img标签数
[  ] style= 属性 > 50
[  ] h2 > 0
[  ] 卡片数 = MD中 :::wechat-card 数
[  ] 引用块数 = MD中 > 引用块数
[  ] position/filter 违规为 0
[  ] 【渲染质检】区块存在
[  ] footer/CTA 已注入
[  ] 本地图片路径已替换为相对路径
[  ] .env 已单独 scp 到 relay
```

### Step 3：逐项核验

- 对每个检查项，直接检查实际的输出产物（HTML、Audit Log、推送响应等）
- 不要依赖记忆，必须回读真实文件
- 任何一项不通过 → **红灯，不得汇报完成**。回到前一步修复
- 修复后重新执行该步骤，再次跑本 harness

### Step 4：输出核查报告

全部通过后，输出结构化报告：

```
━━━ skill-compliance-harness 核查报告 ━━━
触发 skill: xxx
核查时间: xxxx

【核查结果】
[✅] 检查项1: xxx
[✅] 检查项2: xxx
...

全部通过 ✅
```

然后再告知用户完成。

## 已知坑

- **"看起来是对的"≠ 真的检查了**：必须打开文件/Audit Log 确认具体数值
- **单点验证不足**：某些项目的"通过"可能掩盖其他问题（如 style 属性数量够但实际样式丢失）
- **不要在脑子里检查**：必须写入文件或输出到对话中逐条勾选
- **先期投入 time cost**：一次完整核查大约消耗 3-5 分钟，但避免 3 轮返工（每次 15+ 分钟），净省时间

## Verification

本 skill 本身的 Verification：
- [ ] 是否按 Step 2 拆出了完整检查清单？
- [ ] 是否逐项核验了产物？
- [ ] 是否有检查项不通过但汇报了完成？
- [ ] 是否输出了核查报告？

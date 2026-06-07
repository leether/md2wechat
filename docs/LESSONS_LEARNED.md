---
autopoiesis: true
memory_type: "living"
last_updated: "2026-06-07"
evolution_count: 33
friction_points:
  - id: "f001"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f002"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f003"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f004"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f005"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f006"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f007"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f008"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f009"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f010"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f011"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f012"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f013"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f014"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f015"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f016"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f017"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f018"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f019"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f020"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f021"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f022"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f023"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f024"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f025"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f026"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f027"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f028"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f029"
    category: "undefined"
    description: ""
    timestamp: ""
  - id: "f030"
    category: "路径处理"
    description: "bundle 残留旧文件导致推送旧版 HTML"
    resolution: "bundle_wechat_article.mjs 自动清理输出目录后再复制"
    rule_id: "local_path_absence"
    timestamp: "2026-06-07T05:38:48.306Z"
  - id: "f031"
    category: "流程自动化"
    description: "preflight 依赖 SKILL.md 人工提醒才能被调用，经常忘记跑导致 relay 上才发现问题"
    resolution: "render_wechat_editorial.mjs 渲染完成后自动 spawn preflight.mjs，--no-preflight 可跳过"
    rule_id: "preflight_auto_invoke"
    timestamp: "2026-06-07T06:00:00.000Z"
  - id: "f032"
    category: "知识管理"
    description: "历史教训记在静态文档里，运行时无法感知，同样的坑反复踩"
    resolution: "创建 memory-loader.mjs，渲染器和 preflight 运行时自动加载 LESSONS_LEARNED.md，打印风险提示并附加到 L3 清单"
    rule_id: "living_memory_loader"
    timestamp: "2026-06-07T06:00:00.000Z"
  - id: "f033"
    category: "质检自动化"
    description: "L3 检查全部为人工清单，CTA 完整性和图片数匹配容易遗漏"
    resolution: "CTA 完整性改为自动检测关键词和 qr.png；图片数匹配改为比较 MD 和 HTML 中的图片数量；原文核对保持人工"
    rule_id: "cta_integrity"
    timestamp: "2026-06-07T06:00:00.000Z"
---

# LESSONS_LEARNED — md2wechat 活记忆器官
> 本文档是 md2wechat SKILL 的「活记忆器官」。每次 pipeline 运行产生摩擦时，SelfReport 会自动更新此文档。摩擦点与 `harness/push_rules.json` 中的规则通过 `rule_id` 形成闭环。

## 摩擦点类别：未分类

### f001
- **描述**：undefined
- **时间**：unknown

### f002
- **描述**：undefined
- **时间**：unknown

### f003
- **描述**：undefined
- **时间**：unknown

### f004
- **描述**：undefined
- **时间**：unknown

### f005
- **描述**：undefined
- **时间**：unknown

### f006
- **描述**：undefined
- **时间**：unknown

### f007
- **描述**：undefined
- **时间**：unknown

### f008
- **描述**：undefined
- **时间**：unknown

### f009
- **描述**：undefined
- **时间**：unknown

### f010
- **描述**：undefined
- **时间**：unknown

### f011
- **描述**：undefined
- **时间**：unknown

### f012
- **描述**：undefined
- **时间**：unknown

### f013
- **描述**：undefined
- **时间**：unknown

### f014
- **描述**：undefined
- **时间**：unknown

### f015
- **描述**：undefined
- **时间**：unknown

### f016
- **描述**：undefined
- **时间**：unknown

### f017
- **描述**：undefined
- **时间**：unknown

### f018
- **描述**：undefined
- **时间**：unknown

### f019
- **描述**：undefined
- **时间**：unknown

### f020
- **描述**：undefined
- **时间**：unknown

### f021
- **描述**：undefined
- **时间**：unknown

### f022
- **描述**：undefined
- **时间**：unknown

### f023
- **描述**：undefined
- **时间**：unknown

### f024
- **描述**：undefined
- **时间**：unknown

### f025
- **描述**：undefined
- **时间**：unknown

### f026
- **描述**：undefined
- **时间**：unknown

### f027
- **描述**：undefined
- **时间**：unknown

### f028
- **描述**：undefined
- **时间**：unknown

### f029
- **描述**：undefined
- **时间**：unknown

## 摩擦点类别：路径处理

### f030
- **描述**：bundle 残留旧文件导致推送旧版 HTML
- **解决**：bundle_wechat_article.mjs 自动清理输出目录后再复制
- **关联规则**：`local_path_absence`
- **时间**：2026-06-07T05:38:48.306Z

### f031
- **描述**：preflight 依赖 SKILL.md 人工提醒才能被调用，经常忘记跑导致 relay 上才发现问题
- **解决**：render_wechat_editorial.mjs 渲染完成后自动 spawn preflight.mjs，`--no-preflight` 可跳过
- **关联规则**：`preflight_auto_invoke`
- **时间**：2026-06-07T06:00:00.000Z

### f032
- **描述**：历史教训记在静态文档里，运行时无法感知，同样的坑反复踩
- **解决**：创建 memory-loader.mjs，渲染器和 preflight 运行时自动加载 LESSONS_LEARNED.md，打印风险提示并附加到 L3 清单
- **关联规则**：`living_memory_loader`
- **时间**：2026-06-07T06:00:00.000Z

### f033
- **描述**：L3 检查全部为人工清单，CTA 完整性和图片数匹配容易遗漏
- **解决**：CTA 完整性改为自动检测关键词和 qr.png；图片数匹配改为比较 MD 和 HTML 中的图片数量；原文核对保持人工
- **关联规则**：`cta_integrity`
- **时间**：2026-06-07T06:00:00.000Z

---

*本文件由 `harness/self_report.mjs` 自动维护。手动修改请在 frontmatter 后添加自定义章节。*

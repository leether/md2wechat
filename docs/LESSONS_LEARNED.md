---
autopoiesis: true
memory_type: "living"
last_updated: "2026-07-05"
evolution_count: 9
friction_points:
  - id: "f027"
    category: "内容合规"
    description: "digest 超过 128 字符被微信 API 拒绝"
    resolution: "Step 0 严格控制 summary ≤120 字；orchestrator --auto-fix 自动截断"
    rule_id: "digest_length"
    timestamp: "2026-06-07T05:00:00.000Z"
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
  - id: "f034"
    category: "内容质量"
    description: "文章主语「我」在 AI Agent 视角和用户视角之间漂移，导致读者困惑"
    resolution: "新增 narrative_perspective L1 检查：检测「用户问我」/「我想了想」等 AI 视角表述"
    rule_id: "narrative_perspective"
    timestamp: "2026-06-07T07:09:00.000Z"
  - id: "f035"
    category: "图片质量"
    description: "AI 生成的封面图携带模板占位文字（如「【中文标题放置区】」），推送后暴露未处理的草稿痕迹"
    resolution: "新增 cover_placeholder_text L1 检查：tesseract OCR 扫描封面图，检测常见占位符关键词"
    rule_id: "cover_placeholder_text"
    timestamp: "2026-06-07T07:09:00.000Z"
  - id: "f036"
    category: "部署传输"
    description: "bundle 目录中的 .env 隐藏文件无法通过 scp * 批量上传到 relay，导致 relay 上凭据缺失推送失败"
    resolution: "orchestrator --auto-push 自动执行 .env 单独 scp 上传"
    rule_id: "env_relay_transfer"
    timestamp: "2026-06-07T07:11:00.000Z"
  - id: "f038"
    category: "图片处理"
    description: "preflight 检测到封面图或正文插图缺失/占位，跳过了图片生成步骤"
    resolution: "新增 pre_image_missing L1 检查：强制检测封面图和正文插图存在性；支持 --skip-image-check 或 frontmatter no_image:true 逃逸"
    rule_id: "pre_image_missing"
    timestamp: "2026-06-07T09:52:00.000Z"
---

# LESSONS_LEARNED — md2wechat 活记忆器官
> 本文档是 md2wechat SKILL 的「活记忆器官」。每次 pipeline 运行产生摩擦时，SelfReport 会自动更新此文档。摩擦点与 `harness/push_rules.json` 中的规则通过 `rule_id` 形成闭环。

## 摩擦点类别：内容合规

### f027
- **描述**：digest 超过 128 字符被微信 API 拒绝
- **解决**：Step 0 严格控制 summary ≤120 字；orchestrator --auto-fix 自动截断
- **关联规则**：`digest_length`
- **时间**：2026-06-07T05:00:00.000Z

## 摩擦点类别：内容质量

### f034
- **描述**：文章主语「我」在 AI Agent 视角和用户视角之间漂移，导致读者困惑
- **解决**：新增 narrative_perspective L1 检查：检测「用户问我」/「我想了想」等 AI 视角表述
- **关联规则**：`narrative_perspective`
- **时间**：2026-06-07T07:09:00.000Z

## 摩擦点类别：图片处理

### f038
- **描述**：preflight 检测到封面图或正文插图缺失/占位，跳过了图片生成步骤
- **解决**：新增 pre_image_missing L1 检查：强制检测封面图和正文插图存在性；支持 --skip-image-check 或 frontmatter no_image:true 逃逸
- **关联规则**：`pre_image_missing`
- **时间**：2026-06-07T09:52:00.000Z

## 摩擦点类别：图片质量

### f035
- **描述**：AI 生成的封面图携带模板占位文字（如「【中文标题放置区】」），推送后暴露未处理的草稿痕迹
- **解决**：新增 cover_placeholder_text L1 检查：tesseract OCR 扫描封面图，检测常见占位符关键词
- **关联规则**：`cover_placeholder_text`
- **时间**：2026-06-07T07:09:00.000Z

## 摩擦点类别：流程自动化

### f031
- **描述**：preflight 依赖 SKILL.md 人工提醒才能被调用，经常忘记跑导致 relay 上才发现问题
- **解决**：render_wechat_editorial.mjs 渲染完成后自动 spawn preflight.mjs，--no-preflight 可跳过
- **关联规则**：`preflight_auto_invoke`
- **时间**：2026-06-07T06:00:00.000Z

## 摩擦点类别：知识管理

### f032
- **描述**：历史教训记在静态文档里，运行时无法感知，同样的坑反复踩
- **解决**：创建 memory-loader.mjs，渲染器和 preflight 运行时自动加载 LESSONS_LEARNED.md，打印风险提示并附加到 L3 清单
- **关联规则**：`living_memory_loader`
- **时间**：2026-06-07T06:00:00.000Z

## 摩擦点类别：质检自动化

### f033
- **描述**：L3 检查全部为人工清单，CTA 完整性和图片数匹配容易遗漏
- **解决**：CTA 完整性改为自动检测关键词和 qr.png；图片数匹配改为比较 MD 和 HTML 中的图片数量；原文核对保持人工
- **关联规则**：`cta_integrity`
- **时间**：2026-06-07T06:00:00.000Z

## 摩擦点类别：路径处理

### f030
- **描述**：bundle 残留旧文件导致推送旧版 HTML
- **解决**：bundle_wechat_article.mjs 自动清理输出目录后再复制
- **关联规则**：`local_path_absence`
- **时间**：2026-06-07T05:38:48.306Z

## 摩擦点类别：部署传输

### f036
- **描述**：bundle 目录中的 .env 隐藏文件无法通过 scp * 批量上传到 relay，导致 relay 上凭据缺失推送失败
- **解决**：orchestrator --auto-push 自动执行 .env 单独 scp 上传
- **关联规则**：`env_relay_transfer`
- **时间**：2026-06-07T07:11:00.000Z

---

*本文件由 `harness/self_report.mjs` 自动维护。手动修改请在 frontmatter 后添加自定义章节。*

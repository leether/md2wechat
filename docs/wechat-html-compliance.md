# 微信公众号 HTML 合规规范

微信公众号编辑器对 HTML 内容有严格限制，以下是根据实测整理的合规规则。

## 白名单原则

微信只允许**内联 style**，其他一切样式机制都会被过滤。

## 禁止项清单

### 致命级（直接删除）

| 项目 | 说明 |
|------|------|
| `<style>` 标签 | 全部删除 |
| `<script>` 标签 | 全部删除 |
| `position: absolute/fixed/sticky` | 被过滤 |
| 事件属性 `onclick`/`onload` 等 | 被过滤 |
| `<iframe>`/`<form>`/`<input>` | 被删除 |
| `id="..."` 属性 | 被删除 |

### 高风险级（兼容性不稳定）

| 项目 | 说明 |
|------|------|
| `position: relative` | 部分版本被过滤 |
| `filter:` | Dark Mode 下可能异常 |
| `linear-gradient` / `radial-gradient` | 被替换或删除 |
| `!important` | 部分被删除 |
| 自定义 `font-family` | 被替换为默认字体 |
| `transform` / `animation` / `calc()` | 不稳定 |

### 安全级

| 项目 | 说明 |
|------|------|
| 内联 `style="..."` | ✅ 完整保留 |
| `display: inline-block` + `margin` | ✅ 安全的布局方式 |
| 图片 + 文字卡片上下布局 | ✅ 微信安全 |
| 微信默认字体栈 | ✅ 不设 font-family 最安全 |

## 渲染器的设计决策

基于以上限制，本渲染器做了以下设计选择：

1. **纯内联样式**：所有样式通过 `style="..."` 属性注入，不依赖 `<style>` 或 class
2. **卡片用 inline-block**：不使用 `position`、`float` 或 `flex`（微信不兼容）
3. **不设 font-family**：使用微信默认字体栈，避免被替换
4. **圆点用 inline-block + margin**：不使用 `::before` 伪元素
5. **Hero 模块用图片+文字上下布局**：不使用 position 或 gradient

## 校验工具

渲染器内置两层 lint：

1. `lintMarkdownDirectives()`：源码级，检查指令格式、tone 值、关闭标记
2. `lintWechatHtml()`：输出级，检查 position/filter/gradient/!important/id=/事件属性

如果 `lintWechatHtml()` 发现致命问题，渲染会中断并报告具体错误。

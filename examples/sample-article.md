summary: 这是一篇示例文章，展示 md2wechat 的渲染器支持的完整排版语法

# 示例文章：微信公众号排版语法全览

> 这篇文章展示了 md2wechat 渲染器支持的所有扩展语法。
> 从 H2 章节到卡片、引用块、代码块、表格，一网打尽。

## 第一个章节：H2 章节标记

H2 会被渲染为醒目的橙色圆角区块，适合作为文章的分节标记。

## 第二个章节：深色卡片

![示例插图](/tmp/sample-image.png)

:::wechat-card
title: 核心洞察
tone: dark
- 第一条关键信息
- 第二条关键信息
- 支持多行列表项
:::

## 第三个章节：浅色卡片

:::wechat-card
title: 温馨提示
tone: light
- 这是一个浅色卡片
- 适合辅助说明和补充信息
:::

简写语法也支持：`:::wechat-card dark` 或 `:::wechat-card light`

:::wechat-image
src: /tmp/sample-image.png
alt: 指令语法插图
caption: 这张图使用 :::wechat-image 指令语法，支持 caption 说明
:::

## 第四个章节：引用块

> 引用块适合放比喻、金句、或对正文的补充说明。
>
> 支持空行分段，也支持内部嵌套：
> - 嵌套列表项 1
> - 嵌套列表项 2

## 第五个章节：代码块

```bash
# 安装依赖
npm install

# 渲染文章
node scripts/render_wechat_editorial.mjs \
  --input article.md \
  --output article.html \
  --footer-qr ./assets/footer-qr.png
```

## 第六个章节：数据表格

| 语法 | 渲染效果 | 注意事项 |
|------|----------|----------|
| `## H2` | 橙色圆角区块 | 文章分节 |
| `:::wechat-card` | 深色/浅色卡片 | 必须关闭 `:::` |
| `>` 引用 | 左侧竖线 | 支持嵌套 |
| ``` 代码 | 深色代码块 | 支持语法高亮标记 |
| `表格` | 圆角橙色表头 | 卡片内不支持 |

> **注意**：卡片内部不支持表格语法，表格必须放在卡片外部。

## 总结

渲染器支持的完整语法清单：

:::wechat-card
title: 语法速查
tone: dark
- `## H2` → 橙色章节块
- `![alt](url)` → 正文插图（简洁写法）
- `:::wechat-image` → 正文插图 + caption
- `:::wechat-card dark/light` → 深色/浅色卡片
- `> 引用` → 左侧竖线引用块
- ``` 围栏代码 → 深色代码块
- `| 表格 |` → 圆角表格
- `summary: xxx` → 文章摘要（MD 第一行）
:::

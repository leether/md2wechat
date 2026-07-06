# 封面图提示词模板

> 加载时机：Step 2 生成封面图时参考。
> 封面图比例：2.35:1 或 21:9；输出 PNG；≤ 2MB。

---

## Image Provider 调用模板

`md2wechat` 不绑定任何固定生图服务。优先使用当前 Agent 环境已经可用的作图能力；如果没有可用作图能力，就停下来要求用户补图，不要用旧图或占位图凑合正式发布。

```bash
# 示例：当项目自行配置了图片生成 provider 时才使用。
${IMAGE_GEN_CLI} text2image --prompt="<封面描述>" --ratio=21:9

curl -L -o <输出路径>/cover.png "<返回的 image_url>"

# 压缩（必须）
sips -Z 2000 <输出路径>/cover.png --out <输出路径>/cover.png
```

---

## 提示词结构模板

```
<视觉主体>, <构图视角>, <色调氛围>,
<公众号名称> 风格, 极简, 高质量, 8K,
--ar 21:9
```

### 示例

| 文章主题 | 提示词示例 |
|---------|-------------|
| AI Agent 竞品分析 | `两个机器人对话的剪影，深色背景，橙色光晕，极简风格，科技感，--ar 21:9` |
| 品牌策略框架 | `白色背景，橙色几何图形，极简线条，品牌设计感，--ar 21:9` |
| 技术教程 | `代码编辑器界面，深色主题，橙色高亮，科技感，--ar 21:9` |

---

## 压缩规范

```bash
# macOS — 压缩后覆盖原文件（⚠️ 不要改名）
sips -Z 2000 /path/to/cover.png --out /path/to/cover.png

# 如果压缩后仍超 2MB，继续缩小尺寸：
sips -Z 1600 /path/to/cover.png --out /path/to/cover.png

# Linux（需安装 ImageMagick）
convert /path/to/cover.png -resize 2000x /path/to/cover.png
```

> **文件名一致性铁律**：压缩用 `--out` 覆盖原文件，不要生成 `cover-small.png` 之类的新文件名。

---

## 手动准备模式

未配置图片生成 provider 时，用任意工具准备封面图：
- Codex / OpenAI image generation
- Midjourney / DALL-E / Stable Diffusion
- Canva / Figma 设计
- 截图 / 摄影作品

要求：比例 2.35:1 或 21:9，≥ 900×383 px，≤ 2MB。

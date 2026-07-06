# 示例：标准 Audit Log 输出

> 本文档供 `scripts/preflight-check.mjs` 测试和人工核对参考。
> 来自真实推送结果（脱敏处理）。

---

## 示例 1：全部通过

```
━━━ md2wechat Audit Log ━━━
时间: 2026-06-07T06:42:20.123Z

【源文件】
MD: /tmp/my-article.md
HTML: /tmp/my-article.html
标题: Anthropic Skill 方法论实战
作者: 公众号作者
账号: YOUR_ACCOUNT

【资源清单】
  cover.png (512.0KB)
  img1.png (189.0KB)
  footer-qr.png (127.0KB)

【推送结果】
  状态: ok
  media_id: a4juiPtSKGothnS6V3X9p...
  thumb_media_id: a4juiPtSKGothnS6V3X9p...

【微信回检】
  img标签: 3
  CDN图片: 3
  h2标题: 5
  卡片: 2 (深1 / 浅1)
  引用块: 1
  style属性: 98
  position: 0 ✅
  filter: 0 ✅

【渲染质检】
  写作质量: L1✅ (0处)  L2⚠️ (1处)
  GEO合规: L1✅ (0处)  L2⚠️ (0处)
  MD指令: ✅ (0处警告)
  HTML合规: ✅ (0处错误 / 0处警告)

━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 逐项核对

| 检查项 | 实际值 | 期望值 | 结果 |
|--------|---------|--------|------|
| img | 3 | ≥ 1 | ✅ |
| CDN | 3 | = img (3) | ✅ |
| h2 | 5 | > 0 | ✅ |
| 卡片 | 2 | ≥ 0 | ✅ |
| 引用块 | 1 | ≥ 0 | ✅ |
| style | 98 | > 50 | ✅ |
| position | 0 | = 0 | ✅ |
| filter | 0 | = 0 | ✅ |
| 渲染质检 | 存在 | 必须存在 | ✅ |

**结论：✅ 所有检查项通过。**

---

## 示例 2：有失败项

```
━━━ md2wechat Audit Log ━━━
时间: 2026-06-06T10:30:15.456Z

【源文件】
MD: /tmp/bad-article.md
HTML: /tmp/bad-article.html
标题: 测试文章
作者: 测试
账号: YOUR_ACCOUNT

【资源清单】
  cover.png (2048.0KB)
  img1.png (95.0KB)

【推送结果】
  状态: ok
  media_id: xxxx...
  thumb_media_id: xxxx...

【微信回检】
  img标签: 2
  CDN图片: 1
  h2标题: 0
  卡片: 0
  引用块: 0
  style属性: 12
  position: 2 ❌
  filter: 0 ✅

━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 逐项核对

| 检查项 | 实际值 | 期望值 | 结果 |
|--------|---------|--------|------|
| img | 2 | ≥ 1 | ✅ |
| CDN | 1 | = img (2) | ❌ 不匹配 |
| h2 | 0 | > 0 | ❌ |
| 卡片 | 0 | ≥ 0 | ✅ |
| 引用块 | 0 | ≥ 0 | ✅ |
| style | 12 | > 50 | ❌ |
| position | 2 | = 0 | ❌ |
| filter | 0 | = 0 | ✅ |
| 渲染质检 | 缺失 | 必须存在 | ❌ |

**结论：❌ 5 项未通过，回到 Step 1–2 修复。**

失败原因：
- `CDN: 1` ≠ `img: 2` → `img1.png` 超过 2MB，未上传微信 CDN
- `h2: 0` → MD 中缺少 `## H2` 章节标记
- `style: 12` < 50 → HTML 被微信过滤严重，可能含 `position`/`filter`
- `position: 2` → HTML 含 `position:` 属性，被微信过滤
- 【渲染质检】缺失 → 推送时未传 `--lint-report` 参数

---

## 使用方式

```bash
# 测试 preflight-check.mjs
node scripts/preflight-check.mjs --file examples/sample-audit-log.md --require-render-qa

# JSON 输出（供程序调用）
node scripts/preflight-check.mjs --file examples/sample-audit-log.md --json
```

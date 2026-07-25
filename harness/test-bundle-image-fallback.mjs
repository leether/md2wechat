#!/usr/bin/env node
// 验证 bundle 的 extractImagePaths 在 publish/vN/assets/ 找不到图时 fallback 到源 assets/
// 治理 D12 的回归测试：篇11/篇13 踩过的顺序 bug
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractImagePaths } from "../scripts/bundle_wechat_article.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "md2wechat-bundle-fallback-"));

try {
  // 模拟文章目录结构：
  //   <tmp>/article.md
  //   <tmp>/assets/body-img.png   ← 源 assets（图真实位置）
  //   <tmp>/publish/v1/article.html  ← render 输出位置
  //   <tmp>/publish/v1/assets/       ← 空（bundle 还没拷图）
  const articleDir = tmpRoot;
  const sourceAssetsDir = path.join(articleDir, "assets");
  const publishV1Dir = path.join(articleDir, "publish", "v1");
  const publishAssetsDir = path.join(publishV1Dir, "assets");

  fs.mkdirSync(sourceAssetsDir, { recursive: true });
  fs.mkdirSync(publishAssetsDir, { recursive: true });
  fs.writeFileSync(path.join(sourceAssetsDir, "body-img.png"), "fake-png");
  fs.writeFileSync(path.join(articleDir, "article.md"), "# test\n![body](assets/body-img.png)\n");

  // render 输出的 HTML 引用相对路径 assets/body-img.png
  // 在 publish/v1/assets/ 里找不到（bundle 还没拷）
  const html = '<img src="assets/body-img.png" alt="body">';
  const htmlDir = publishV1Dir;

  // ① 不传 sourceAssetsDir（旧行为）：resolved 指向 publish/v1/assets/body-img.png，找不到
  const oldResult = extractImagePaths(html, htmlDir);
  assert.equal(oldResult.length, 1, "old: should find 1 image reference");
  assert.equal(fs.existsSync(oldResult[0].resolved), false, "old: resolved path should not exist (bug)");

  // ② 传 sourceAssetsDir（新行为）：fallback 到源 assets/body-img.png，找到
  const newResult = extractImagePaths(html, htmlDir, sourceAssetsDir);
  assert.equal(newResult.length, 1, "new: should find 1 image reference");
  assert.equal(fs.existsSync(newResult[0].resolved), true, "new: resolved should fallback to source assets and exist");
  assert.equal(newResult[0].basename, "body-img.png", "new: basename preserved");

  // ③ publish/v1/assets/ 已有图（bundle 后状态）：不 fallback，用 publish 路径
  fs.copyFileSync(path.join(sourceAssetsDir, "body-img.png"), path.join(publishAssetsDir, "body-img.png"));
  const postBundleResult = extractImagePaths(html, htmlDir, sourceAssetsDir);
  assert.equal(postBundleResult[0].resolved, path.join(publishAssetsDir, "body-img.png"), "post-bundle: should use publish path when exists, not source fallback");

  // ④ 绝对路径不走 fallback（只对相对路径 fallback）
  const absHtml = `<img src="${path.join(sourceAssetsDir, "body-img.png")}" alt="body">`;
  const absResult = extractImagePaths(absHtml, htmlDir, sourceAssetsDir);
  assert.equal(absResult.length, 1, "abs: absolute path still resolved");
  assert.equal(fs.existsSync(absResult[0].resolved), true, "abs: absolute path exists");

  // ⑤ http(s) / data URI 跳过
  const remoteHtml = '<img src="https://example.com/x.png"><img src="data:image/png;base64,abc">';
  const remoteResult = extractImagePaths(remoteHtml, htmlDir, sourceAssetsDir);
  assert.equal(remoteResult.length, 0, "remote: http/data URIs should be skipped");

  console.log("test-bundle-image-fallback: ok");
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

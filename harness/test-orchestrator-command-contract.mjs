#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildManualRelayCommand, resolvePipelinePaths } from "../scripts/orchestrator.mjs";

const result = buildManualRelayCommand({
  relayHost: "relay-host",
  relayRoot: "/tmp/wechat-publish",
  account: "MY_ACCOUNT",
  remoteDir: "/tmp/wechat-publish/MY_ACCOUNT/20260607_slug/v1",
  outDir: "/tmp/wechat bundle",
  renderOut: "/tmp/article.html",
  lintOut: "/tmp/article-lint.json",
  title: "Title With Spaces",
  slug: "slug",
  author: "公众号作者",
  openComment: "1",
  thumbImage: "/tmp/cover.png",
  cropSpec: "0_0.0035_1_0.9965",
  envInBundle: true,
});

assert.equal(result.envReminder, true);
assert.match(result.command, /ssh 'relay-host'/);
assert.match(result.command, /scp '\/tmp\/wechat bundle'\/\*/);
assert.match(result.command, /scp '\/tmp\/wechat bundle\/\.env'/);
assert.match(result.remoteDraftCmd, /--thumb-image 'cover\.png'/);
assert.match(result.remoteDraftCmd, /--crop-235-1 '0_0\.0035_1_0\.9965'/);
assert.match(result.remoteDraftCmd, /--title 'Title With Spaces'/);
assert.doesNotMatch(result.command, /\\scp|\\ssh|\\  node/);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "md2wechat-orchestrator-"));
try {
  const articleDir = path.join(tmpRoot, "article");
  const articlePath = path.join(articleDir, "enterprise-ai-carrier.md");
  fs.mkdirSync(articleDir, { recursive: true });
  fs.writeFileSync(articlePath, "# Enterprise AI Carrier\n", "utf8");

  const first = resolvePipelinePaths({ inputPath: articlePath });
  assert.equal(first.archiveDir, path.join(articleDir, "publish", "v1"));
  assert.equal(first.outDir, path.join(articleDir, "publish", "v1", "bundle"));
  assert.equal(first.renderOut, path.join(articleDir, "publish", "v1", "enterprise-ai-carrier.html"));
  assert.equal(first.lintOut, path.join(articleDir, "publish", "v1", "enterprise-ai-carrier-lint.json"));

  fs.mkdirSync(path.join(articleDir, "publish", "v1"), { recursive: true });
  const second = resolvePipelinePaths({ inputPath: articlePath });
  assert.equal(second.archiveDir, path.join(articleDir, "publish", "v2"));
  assert.equal(second.outDir, path.join(articleDir, "publish", "v2", "bundle"));

  const explicitBundle = path.join(articleDir, "publish", "v9", "bundle");
  const explicit = resolvePipelinePaths({ inputPath: articlePath, outDirArg: explicitBundle });
  assert.equal(explicit.archiveDir, path.join(articleDir, "publish", "v9"));
  assert.equal(explicit.outDir, explicitBundle);
  assert.equal(explicit.renderOut, path.join(articleDir, "publish", "v9", "enterprise-ai-carrier.html"));

  const explicitPlain = path.join(articleDir, "custom-bundle");
  const plain = resolvePipelinePaths({ inputPath: articlePath, outDirArg: explicitPlain });
  assert.equal(plain.archiveDir, articleDir);
  assert.equal(plain.outDir, explicitPlain);
  assert.equal(plain.renderOut, path.join(articleDir, "enterprise-ai-carrier.html"));
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log("Orchestrator command contract passed.");

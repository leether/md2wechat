#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildManualRelayCommand,
  buildRelayDeploymentCheckCommand,
  extractSummaryFromMarkdown,
  findDuplicateFooterQrReferences,
  resolvePipelinePaths,
  runRelayDeploymentCheck,
  runPublishDoctor,
} from "../scripts/orchestrator.mjs";

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
  digest: "短摘要：必须原样传到 relay。",
  sourcePath: "/tmp/article source.md",
  archiveDir: "/tmp/article-publish/v1",
  catalogPath: "/tmp/article repo/CATALOG.md",
  catalogSlug: "enterprise-ai-carrier",
  thumbImage: "/tmp/cover.png",
  cropSpec: "0_0.0035_1_0.9965",
  envInBundle: true,
  envPath: "/tmp/md2wechat config/.env",
});

assert.equal(result.envReminder, true);
assert.equal(
  result.relayDeploymentCheck,
  buildRelayDeploymentCheckCommand({ envPath: "/tmp/md2wechat config/.env" }),
);
assert.match(result.command, /^node .*sync_relay_scripts\.mjs.*--check.*--env.*--json && \\\nssh/);
assert.match(result.command, /ssh 'relay-host'/);
assert.match(result.command, /scp '\/tmp\/wechat bundle'\/\*/);
assert.match(result.command, /scp '\/tmp\/wechat bundle\/\.env'/);
assert.match(result.remoteDraftCmd, /--thumb-image 'cover\.png'/);
assert.match(result.remoteDraftCmd, /--crop-235-1 '0_0\.0035_1_0\.9965'/);
assert.match(result.remoteDraftCmd, /--title 'Title With Spaces'/);
assert.match(result.remoteDraftCmd, /--digest '短摘要：必须原样传到 relay。'/);
assert.match(result.remoteDraftCmd, /--audit-out 'audit\.log'/);
assert.match(result.remoteDraftCmd, /--push-result-out 'push-result\.json'/);
assert.match(result.remoteDraftCmd, /--source-path '\/tmp\/article source\.md'/);
assert.match(result.command, /push-result\.json/);
assert.match(result.command, /audit\.log/);
assert.match(result.command, /update_wechat_catalog\.mjs/);
assert.doesNotMatch(result.command, /\\scp|\\ssh|\\  node/);

let admissionCall = null;
const blockedAdmission = runRelayDeploymentCheck({
  envPath: "/tmp/md2wechat config/.env",
  spawn(command, args, options) {
    admissionCall = { command, args, options };
    return { status: 2, stdout: '{"ok":false,"completion_status":"relay-scripts-drift"}' };
  },
});
assert.equal(blockedAdmission.ok, false);
assert.equal(blockedAdmission.exitCode, 2);
assert.match(blockedAdmission.resultPreview, /relay-scripts-drift/);
assert.ok(admissionCall.args.includes("--check"));
assert.ok(admissionCall.args.includes("--json"));
assert.ok(admissionCall.args.includes("/tmp/md2wechat config/.env"));

assert.equal(
  extractSummaryFromMarkdown("---\ntitle: Test\nsummary: \"frontmatter 摘要\"\n---\n# H1\n"),
  "frontmatter 摘要",
);
assert.equal(
  extractSummaryFromMarkdown("summary: legacy 摘要\n\n# H1\n"),
  "legacy 摘要",
);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "md2wechat-orchestrator-"));
try {
  const articleDir = path.join(tmpRoot, "article");
  const articlePath = path.join(articleDir, "enterprise-ai-carrier.md");
  const assetDir = path.join(articleDir, "assets");
  fs.mkdirSync(articleDir, { recursive: true });
  fs.writeFileSync(articlePath, "# Enterprise AI Carrier\n", "utf8");

  const first = resolvePipelinePaths({ inputPath: articlePath });
  assert.equal(first.archiveDir, path.join(articleDir, "publish", "v1"));
  assert.equal(first.outDir, path.join(articleDir, "publish", "v1", "bundle"));
  assert.equal(first.renderOut, path.join(articleDir, "publish", "v1", "enterprise-ai-carrier.html"));
  assert.equal(first.lintOut, path.join(articleDir, "publish", "v1", "enterprise-ai-carrier-lint.json"));
  assert.equal(first.auditOut, path.join(articleDir, "publish", "v1", "audit.log"));
  assert.equal(first.pushResultOut, path.join(articleDir, "publish", "v1", "push-result.json"));

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

  fs.mkdirSync(assetDir, { recursive: true });
  const qrPath = path.join(assetDir, "ai-world-qr.jpg");
  fs.writeFileSync(qrPath, "qr", "utf8");
  fs.writeFileSync(articlePath, "![AI 大世界](assets/ai-world-qr.jpg)\n", "utf8");
  assert.deepEqual(
    findDuplicateFooterQrReferences({
      inputPath: articlePath,
      envPath: path.join(tmpRoot, ".env"),
      footerQrPath: qrPath,
    }).map(({ source }) => source),
    ["assets/ai-world-qr.jpg"],
  );

  fs.writeFileSync(articlePath, "![外部二维码](https://example.com/ai-world-qr.jpg)\n", "utf8");
  assert.deepEqual(
    findDuplicateFooterQrReferences({
      inputPath: articlePath,
      envPath: path.join(tmpRoot, ".env"),
      footerQrPath: qrPath,
    }),
    [],
  );

  fs.writeFileSync(articlePath, "![AI 大世界](assets/ai-world-qr.jpg)\n", "utf8");
  const envPath = path.join(tmpRoot, ".env");
  fs.writeFileSync(envPath, "WECHAT_TEST_APP_ID=test-id\nWECHAT_TEST_APP_SECRET=test-secret\n", "utf8");
  const doctor = runPublishDoctor({
    inputPath: articlePath,
    envPath,
    account: "test",
    autoPush: false,
    dryRun: true,
    thumbImage: "",
    qrPath,
  });
  assert.ok(doctor.errors.some((error) => error.startsWith("footer QR would be inserted twice:")));
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log("Orchestrator command contract passed.");

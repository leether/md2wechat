#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildManualRelayCommand } from "../scripts/orchestrator.mjs";

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

console.log("Orchestrator command contract passed.");

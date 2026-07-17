#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  deriveCatalogSlug,
  discoverCatalogPath,
  finalizePushResultBacklink,
  inspectCatalogTarget,
  updateCatalogAfterPush,
} from "../scripts/lib/publish-evidence.mjs";
import { persistVerifiedDraftEvidence } from "../scripts/create_wechat_draft.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "md2wechat-evidence-"));
try {
  const articleDir = path.join(tmpRoot, "articles", "2026", "2026-07-17-contract-test");
  const publishDir = path.join(articleDir, "publish", "v2");
  const sourcePath = path.join(articleDir, "article.md");
  const auditPath = path.join(publishDir, "audit.log");
  const pushResultPath = path.join(publishDir, "push-result.json");
  const catalogPath = path.join(tmpRoot, "CATALOG.md");
  fs.mkdirSync(publishDir, { recursive: true });
  fs.writeFileSync(sourcePath, "# Contract test\n", "utf8");
  const persisted = persistVerifiedDraftEvidence({
    audit: {
      timestamp: "2026-07-17T08:00:00.000Z",
      source: { mdPath: sourcePath, htmlPath: path.join(publishDir, "article.html"), title: "Contract Test", author: "Author", account: "XINZHE" },
      assets: [],
      lintReport: null,
      push: { status: "ok", mediaId: "new-media-id-12345678901234567890", thumbMediaId: "thumb-id" },
      verify: { imgCount: 1, cdnCount: 1, h2Count: 1, cardCount: 0, darkCardCount: 0, lightCardCount: 0, quoteCount: 0, styleCount: 60, positionCount: 0, filterCount: 0 },
    },
    pushResult: {
      schema_version: "md2wechat-push-result/v1",
      media_id: "new-media-id-12345678901234567890",
      thumb_media_id: "thumb-id",
      errcode: 0,
      completion_status: "verified",
      verification: { status: "passed" },
    },
    auditOutPath: auditPath,
    pushResultOutPath: pushResultPath,
  });
  assert.equal(persisted.auditPath, auditPath);
  assert.equal(persisted.pushResultPath, pushResultPath);
  assert.match(fs.readFileSync(auditPath, "utf8"), /media_id: new-media-id-12345678901234567890/);
  fs.writeFileSync(catalogPath, [
    "# Article Catalog",
    "",
    "| Date | Slug | Title | Status | Draftbox | WeChat media_id | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    "| 2026-07-17 | `contract-test` | Contract Test | drafting | 未推送草稿箱 | `old-media-id-12345678901234567890` | 初始备注 |",
    "",
  ].join("\n"), "utf8");

  assert.equal(discoverCatalogPath(sourcePath), catalogPath);
  assert.equal(deriveCatalogSlug(sourcePath), "contract-test");
  assert.equal(inspectCatalogTarget({ catalogPath, slug: "contract-test" }).row.status, "drafting");

  const update = updateCatalogAfterPush({
    catalogPath,
    slug: "contract-test",
    mediaId: "new-media-id-12345678901234567890",
    account: "XINZHE",
    sourcePath,
    auditPath,
  });
  assert.equal(update.changed, true);
  assert.equal(update.old_media_id, "old-media-id-12345678901234567890");

  const catalog = fs.readFileSync(catalogPath, "utf8");
  assert.match(catalog, /\| pushed-draft \|/);
  assert.match(catalog, /`new-media-id-12345678901234567890`/);
  assert.match(catalog, /回执见 `publish\/v2\/audit\.log`/);
  assert.match(catalog, /原 media_id `old-media-id-12345678901234567890` 已失效并更新/);

  const finalResult = finalizePushResultBacklink({ pushResultPath, auditPath, catalogUpdate: update });
  assert.equal(finalResult.evidence.audit_path, auditPath);
  assert.equal(finalResult.evidence.push_result_path, pushResultPath);
  assert.equal(finalResult.backlink.catalog_slug, "contract-test");

  const second = updateCatalogAfterPush({
    catalogPath,
    slug: "contract-test",
    mediaId: "new-media-id-12345678901234567890",
    account: "XINZHE",
    sourcePath,
    auditPath,
  });
  assert.equal(second.changed, false);

  assert.throws(
    () => inspectCatalogTarget({ catalogPath, slug: "missing" }),
    /matched 0 rows/,
  );
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log("Publish evidence contract passed.");

#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyReconciliationRepairs,
  buildReconciliationReport,
} from "../scripts/reconcile_wechat_drafts.mjs";

const workerSource = fs.readFileSync(
  new URL("../scripts/lib/wechat-reconcile-worker.mjs", import.meta.url),
  "utf8",
);
assert.match(workerSource, /await fetch\(/);
assert.doesNotMatch(workerSource, /execFileSync|WECHAT_.*APP_SECRET.*console/);

const catalog = [
  "# Article Catalog",
  "",
  "| Date | Slug | Title | Status | Draftbox | WeChat media_id | Notes |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  "| 2026-07-16 | `symbiotic-writing` | 花了一天跟 AI 讨论代码，我们碰撞出了灵感 | pushed-draft | 已推送新褶草稿箱 | `id-symbiotic` | audit |",
  "| 2026-07-16 | `weknora-agent-programming` | 当 LLM 开始写代码——Agent 编程的 10 条安全底线 | pushed-draft | 已推送新褶草稿箱 | `id-agent` | audit |",
  "| 2026-07-16 | `weknora-taste` | WeKnora 代码里的四种品味 | pushed-draft | 已推送新褶草稿箱 | `id-taste` | audit |",
  "| 2026-07-16 | `weknora-rag-deepdive` | 手把手拆一个生产级 RAG 系统 | pushed-draft | 已推送新褶草稿箱 | `id-rag` | audit |",
  "| 2026-07-07 | `older-cataloged` | Older Cataloged Draft | pushed-draft | 已推送草稿箱 | `id-older` | audit |",
  "| 2026-07-16 | `already-published` | Published Draft | published | 已发布 | `id-published` | manual |",
  "",
].join("\n");

const snapshot = {
  account: "XINZHE",
  queried_at: "2026-07-17T12:00:00.000Z",
  draft_total: 7,
  freepublish: { available: false, errcode: 48001 },
  drafts: [
    { media_id: "id-symbiotic", title: "花了一天跟AI讨论代码，我们碰撞出了灵感", thumb_media_id: "thumb-ok" },
    { media_id: "id-agent", title: "当LLM开始写代码——Agent编程的10条安全底线", thumb_media_id: "" },
    { media_id: "id-taste", title: "WeKnora代码里的四种品味", thumb_media_id: "" },
    { media_id: "id-rag", title: "手把手拆一个生产级RAG系统", thumb_media_id: "" },
    { media_id: "id-older", title: "Older Cataloged Draft", thumb_media_id: "thumb-old" },
    { media_id: "external-1", title: "External One", thumb_media_id: "thumb-e1" },
    { media_id: "external-2", title: "External Two", thumb_media_id: "thumb-e2" },
  ],
};

const report = buildReconciliationReport({
  catalogMarkdown: catalog,
  catalogPath: "/tmp/CATALOG.md",
  snapshot,
  account: "XINZHE",
  date: "2026-07-16",
});

assert.equal(report.summary.matched, 4);
assert.equal(report.summary.stale_ids, 0);
assert.equal(report.summary.invalid_ids, 0);
assert.equal(report.summary.absent_from_draftbox, 0);
assert.equal(report.summary.uncataloged_drafts, 2);
assert.equal(report.summary.cover_missing_selected, 3);
assert.equal(report.publication_inference.allowed, false);
assert.equal(report.live_snapshot.freepublish.errcode, 48001);

const driftedCatalog = catalog.replace("`id-taste`", "`old-id-taste`");
const staleReport = buildReconciliationReport({
  catalogMarkdown: driftedCatalog,
  snapshot,
  account: "XINZHE",
  slugs: ["weknora-taste", "already-published"],
});
assert.equal(staleReport.summary.stale_ids, 1);
assert.equal(staleReport.stale_ids[0].replacement_media_id, "id-taste");
assert.equal(staleReport.absent_from_draftbox.length, 0);

const absentReport = buildReconciliationReport({
  catalogMarkdown: catalog.replace("| published |", "| pushed-draft |"),
  snapshot,
  account: "XINZHE",
  slugs: ["already-published"],
});
assert.equal(absentReport.summary.absent_from_draftbox, 1);
assert.equal(absentReport.absent_from_draftbox[0].state, "published-or-deleted");
assert.equal(absentReport.absent_from_draftbox[0].publication_assertion, "forbidden");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "md2wechat-reconcile-write-"));
try {
  const catalogPath = path.join(tmpRoot, "CATALOG.md");
  const articleDir = path.join(tmpRoot, "articles", "2026", "2026-07-16-weknora-taste");
  const auditPath = path.join(articleDir, "publish", "v1", "audit.log");
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.writeFileSync(catalogPath, driftedCatalog, "utf8");
  fs.writeFileSync(auditPath, "media_id: id-taste\n", "utf8");
  const writeReport = buildReconciliationReport({
    catalogMarkdown: driftedCatalog,
    catalogPath,
    snapshot,
    account: "XINZHE",
    slugs: ["weknora-taste"],
  });
  const repairs = applyReconciliationRepairs({ report: writeReport, catalogPath, account: "XINZHE" });
  assert.equal(repairs.length, 1);
  const repairedCatalog = fs.readFileSync(catalogPath, "utf8");
  assert.match(repairedCatalog, /`id-taste`/);
  assert.match(repairedCatalog, /原 media_id `old-id-taste` 已失效并更新/);
  assert.match(repairedCatalog, /回执见 `publish\/v1\/audit\.log`/);
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log("WeChat draft reconciliation contract passed.");

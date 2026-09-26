#!/usr/bin/env node
// 发布历史快照 ↔ CATALOG.md 对账：输出三类差异，供人工裁定后批量修状态。
//
// 用法：
//   node scripts/reconcile_published.mjs --snapshot published.json --catalog /path/CATALOG.md [--since 2026-06] [--report diff.json]
//
// 输出三桶：
//   flippable     后台已发布、CATALOG 仍 pushed-draft（标题匹配成功）→ 可翻 published
//   backend_only  后台有、CATALOG 无（仓外文章 / 改题发布 / 仓前时期）→ 需人工裁定登记方式
//   catalog_stale CATALOG 是 pushed-draft 但后台既无发布也无删除 → 存疑（从未推送？他渠道？）
//
// 匹配规则（沿用 2026-09-26 人工对账口径）：标题归一化（去空白/标点/「DeepSeek Harness」前缀）
// 后做包含匹配；发布时常改题，匹配不上的一律进 backend_only 人工看，不自动猜。

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--snapshot") args.snapshot = argv[++i];
    else if (k === "--catalog") args.catalog = argv[++i];
    else if (k === "--since") args.since = argv[++i];
    else if (k === "--report") args.report = argv[++i];
  }
  if (!args.snapshot || !args.catalog) {
    console.error("Usage: node scripts/reconcile_published.mjs --snapshot <json> --catalog <CATALOG.md> [--since YYYY-MM] [--report <json>]");
    process.exit(2);
  }
  return args;
}

const norm = (s) => (s || "").replace(/[\s：:，,。.！?？"""''\-—·《》]|DeepSeek Harness/g, "");

function parseCatalog(mdPath) {
  const rows = [];
  for (const line of fs.readFileSync(mdPath, "utf8").split("\n")) {
    const m = /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*(\S+)\s*\|/.exec(line);
    if (m) rows.push({ date: m[1], slug: m[2], title: m[3].trim(), status: m[4], raw: line });
  }
  return rows;
}

const args = parseArgs(process.argv);
const snap = JSON.parse(fs.readFileSync(args.snapshot, "utf8"));
const rows = parseCatalog(args.catalog);

const matchedSlugs = new Set();
const flippable = [], backendOnly = [];
for (const it of snap.items) {
  if (!it.title || it.title === "(群发/非图文)") continue;
  if (args.since && !(it.time || "").startsWith(args.since) && it.time) continue;
  if (args.since && !it.time) continue; // 无时间戳的旧记录不参与 --since 对账
  const nb = norm(it.title);
  let hit = null;
  for (const r of rows) {
    const nr = norm(r.title);
    if (nb && nr && (nb.includes(nr) || nr.includes(nb))) { hit = r; break; }
  }
  if (hit) {
    matchedSlugs.add(hit.slug);
    if (hit.status === "pushed-draft" && !it.is_deleted) {
      flippable.push({ slug: hit.slug, catalog_title: hit.title, backend_title: it.title, time: it.time, exact: nb === norm(hit.title) });
    }
  } else if (!it.is_deleted) {
    backendOnly.push({ title: it.title, time: it.time, read_num: it.read_num });
  }
}
const catalogStale = rows.filter((r) => r.status === "pushed-draft" && !matchedSlugs.has(r.slug)).map((r) => ({ slug: r.slug, title: r.title, date: r.date }));

const report = { schema: "mp-reconcile-published/v1", snapshot: path.resolve(args.snapshot), since: args.since || "(all)", flippable, backend_only: backendOnly, catalog_stale: catalogStale };
const out = args.report || "reconcile-published.json";
fs.writeFileSync(out, JSON.stringify(report, null, 1));
console.log(`flippable=${flippable.length} backend_only=${backendOnly.length} catalog_stale=${catalogStale.length} -> ${path.resolve(out)}`);
for (const f of flippable) console.log(`  [flip] ${f.slug} | ${f.backend_title} (${f.time})${f.exact ? "" : "  # 改题发布"}`);
for (const b of backendOnly) console.log(`  [only] ${b.time || "?"} | ${b.title}`);
for (const s of catalogStale) console.log(`  [stale] ${s.slug} | ${s.title}`);

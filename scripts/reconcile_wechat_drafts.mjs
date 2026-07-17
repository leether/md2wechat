#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  atomicWriteJson,
  findAuditPointerForSlug,
  normalizeCatalogMediaId,
  normalizeCatalogTitle,
  parseCatalogMarkdown,
  updateCatalogAfterPush,
} from "./lib/publish-evidence.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const args = { slug: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    const value = next && !next.startsWith("--") ? next : true;
    if (key === "slug") args.slug.push(String(value));
    else args[key] = value;
    if (value !== true) index += 1;
  }
  return args;
}

function readEnvFile(envPath) {
  const pairs = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const separator = trimmed.indexOf("=");
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    pairs[key] = value;
  }
  return pairs;
}

function shellQuote(value = "") {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function fetchRelaySnapshot({ envPath, account, relayEnv = "" }) {
  const env = readEnvFile(envPath);
  const relayHost = env.WECHAT_RELAY_HOST || "";
  if (!relayHost) throw new Error(`WECHAT_RELAY_HOST missing from ${envPath}`);
  const remoteEnv = relayEnv
    || env.WECHAT_RELAY_RECONCILE_ENV
    || (env.WECHAT_RELAY_SHARED_DIR ? `${env.WECHAT_RELAY_SHARED_DIR}/.env` : "")
    || (env.WECHAT_RELAY_PUBLISH_ROOT ? `${env.WECHAT_RELAY_PUBLISH_ROOT}/.env` : "");
  if (!remoteEnv) {
    throw new Error("relay credential path missing; configure WECHAT_RELAY_RECONCILE_ENV or WECHAT_RELAY_SHARED_DIR");
  }

  const workerPath = path.join(__dirname, "lib", "wechat-reconcile-worker.mjs");
  const workerSource = fs.readFileSync(workerPath, "utf8");
  const remoteCommand = `node --input-type=module - --env ${shellQuote(remoteEnv)} --account ${shellQuote(account)}`;
  const result = spawnSync("ssh", [relayHost, remoteCommand], {
    encoding: "utf8",
    input: workerSource,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `relay snapshot failed with status ${result.status}`).trim());
  }
  return JSON.parse(result.stdout);
}

function publicDraftRecord(draft) {
  return {
    media_id: draft.media_id || "",
    title: draft.title || "",
    thumb_media_id: draft.thumb_media_id || "",
    create_time: draft.create_time ?? null,
    update_time: draft.update_time ?? null,
  };
}

export function buildReconciliationReport({
  catalogMarkdown,
  catalogPath = "",
  snapshot,
  account,
  slugs = [],
  date = "",
} = {}) {
  const catalog = parseCatalogMarkdown(catalogMarkdown);
  const allRows = catalog.rows;
  const requestedSlugs = new Set((slugs || []).filter(Boolean));
  let selectedRows = allRows.filter((row) => row.status === "pushed-draft");
  if (requestedSlugs.size > 0) selectedRows = selectedRows.filter((row) => requestedSlugs.has(row.slug));
  if (date) selectedRows = selectedRows.filter((row) => row.date === date);

  const drafts = Array.isArray(snapshot?.drafts) ? snapshot.drafts.map(publicDraftRecord) : [];
  const byId = new Map(drafts.filter((draft) => draft.media_id).map((draft) => [draft.media_id, draft]));
  const byTitle = new Map();
  for (const draft of drafts) {
    const key = normalizeCatalogTitle(draft.title);
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(draft);
  }

  const matched = [];
  const staleIds = [];
  const absent = [];
  const selectedLiveIds = new Set();
  for (const row of selectedRows) {
    const mediaId = normalizeCatalogMediaId(row.mediaId);
    const direct = mediaId ? byId.get(mediaId) : null;
    if (direct) {
      selectedLiveIds.add(direct.media_id);
      matched.push({ slug: row.slug, title: row.title, media_id: mediaId, thumb_media_id: direct.thumb_media_id });
      continue;
    }

    const titleMatches = byTitle.get(normalizeCatalogTitle(row.title)) || [];
    if (titleMatches.length === 1) {
      const replacement = titleMatches[0];
      selectedLiveIds.add(replacement.media_id);
      staleIds.push({
        slug: row.slug,
        title: row.title,
        old_media_id: mediaId,
        replacement_media_id: replacement.media_id,
        thumb_media_id: replacement.thumb_media_id,
        state: "replacement-candidate",
      });
      continue;
    }

    absent.push({
      slug: row.slug,
      title: row.title,
      media_id: mediaId,
      state: "published-or-deleted",
      publication_assertion: "forbidden",
      title_match_count: titleMatches.length,
    });
  }

  const allCatalogIds = new Set(allRows.map((row) => normalizeCatalogMediaId(row.mediaId)).filter(Boolean));
  const allCatalogTitles = new Set(allRows.map((row) => normalizeCatalogTitle(row.title)).filter(Boolean));
  const uncatalogedDrafts = drafts.filter((draft) =>
    !allCatalogIds.has(draft.media_id) && !allCatalogTitles.has(normalizeCatalogTitle(draft.title))
  );
  const coverMissingAll = drafts.filter((draft) => !draft.thumb_media_id);
  const coverMissingSelected = drafts.filter((draft) => selectedLiveIds.has(draft.media_id) && !draft.thumb_media_id);
  const invalidIds = [
    ...staleIds.map((item) => ({ slug: item.slug, title: item.title, media_id: item.old_media_id, reason: "superseded" })),
    ...absent.map((item) => ({ slug: item.slug, title: item.title, media_id: item.media_id, reason: "absent-from-draftbox" })),
  ];

  return {
    schema_version: "md2wechat-draft-reconcile/v1",
    account: account || snapshot?.account || "",
    queried_at: snapshot?.queried_at || new Date().toISOString(),
    catalog_path: catalogPath ? path.resolve(catalogPath) : "",
    scope: {
      status: "pushed-draft",
      date: date || "",
      slugs: [...requestedSlugs],
      selected_count: selectedRows.length,
    },
    live_snapshot: {
      draft_total: Number(snapshot?.draft_total ?? drafts.length),
      freepublish: snapshot?.freepublish || { available: false, errcode: null, reason: "not-probed" },
    },
    summary: {
      matched: matched.length,
      stale_ids: staleIds.length,
      invalid_ids: invalidIds.length,
      absent_from_draftbox: absent.length,
      uncataloged_drafts: uncatalogedDrafts.length,
      cover_missing_selected: coverMissingSelected.length,
      cover_missing_all_live: coverMissingAll.length,
    },
    matched,
    stale_ids: staleIds,
    invalid_ids: invalidIds,
    absent_from_draftbox: absent,
    uncataloged_drafts: uncatalogedDrafts,
    cover_missing: {
      selected: coverMissingSelected,
      all_live: coverMissingAll,
    },
    publication_inference: {
      allowed: false,
      absent_state: "published-or-deleted",
      reason: "draft disappearance alone is not publication evidence",
    },
  };
}

export function applyReconciliationRepairs({ report, catalogPath, account }) {
  const repairs = [];
  for (const item of report.stale_ids || []) {
    const auditPointer = findAuditPointerForSlug({
      catalogPath,
      slug: item.slug,
      mediaId: item.replacement_media_id,
    });
    const result = updateCatalogAfterPush({
      catalogPath,
      slug: item.slug,
      mediaId: item.replacement_media_id,
      account,
      auditPointer,
    });
    repairs.push(result);
  }
  return repairs;
}

export function reconcileWechatDrafts(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write([
      "Usage: node scripts/reconcile_wechat_drafts.mjs --catalog <CATALOG.md> --account <ACCOUNT> [options]",
      "  --env <path>             Local md2wechat .env containing WECHAT_RELAY_* (default: ./.env)",
      "  --relay-env <path>       Credential .env path on relay",
      "  --slug <slug>            Repeat to limit catalog rows",
      "  --date <YYYY-MM-DD>       Limit selected pushed-draft rows by date",
      "  --snapshot <json>        Offline fixture; skips relay (tests only)",
      "  --report <json>          Persist the reconciliation report locally",
      "  --write                  Repair only unique title-matched stale ids in CATALOG",
      "",
    ].join("\n"));
    return { status: "help" };
  }

  const catalogPath = path.resolve(String(args.catalog || "CATALOG.md"));
  const account = String(args.account || "").trim();
  if (!account) throw new Error("--account is required");
  const catalogMarkdown = fs.readFileSync(catalogPath, "utf8");
  const snapshot = args.snapshot
    ? JSON.parse(fs.readFileSync(path.resolve(args.snapshot), "utf8"))
    : fetchRelaySnapshot({
        envPath: path.resolve(String(args.env || ".env")),
        account,
        relayEnv: args["relay-env"] ? String(args["relay-env"]) : "",
      });
  const report = buildReconciliationReport({
    catalogMarkdown,
    catalogPath,
    snapshot,
    account,
    slugs: args.slug,
    date: args.date ? String(args.date) : "",
  });
  if (args.write) {
    report.write_result = {
      repairs: applyReconciliationRepairs({ report, catalogPath, account }),
      absent_rows_unchanged: report.absent_from_draftbox.length,
    };
  }
  if (args.report) atomicWriteJson(path.resolve(args.report), report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    reconcileWechatDrafts();
  } catch (error) {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exitCode = 1;
  }
}

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveCatalogSlug,
  discoverCatalogPath,
  finalizePushResultBacklink,
  inspectCatalogTarget,
  updateCatalogAfterPush,
} from "./lib/publish-evidence.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export function updateWechatCatalogFromArgs(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write([
      "Usage: node scripts/update_wechat_catalog.mjs --source <article.md> [options]",
      "  --catalog <CATALOG.md>       Explicit catalog; otherwise discover from source ancestors",
      "  --no-catalog                 Finalize local evidence paths without a CATALOG projection",
      "  --slug <slug>                Explicit row slug; otherwise derive from source path",
      "  --push-result <path>         Required unless --check",
      "  --audit <path>               Durable audit.log path",
      "  --account <name>             Account label for a newly transitioned Draftbox cell",
      "  --check                      Validate exact row admission without writing",
      "  --json                       Emit JSON",
      "",
    ].join("\n"));
    return { status: "help" };
  }

  const sourcePath = args.source ? path.resolve(args.source) : "";
  const catalogPath = args.catalog
    ? path.resolve(args.catalog)
    : discoverCatalogPath(sourcePath);
  const slug = String(args.slug || deriveCatalogSlug(sourcePath)).trim();
  if (!args["no-catalog"] && !catalogPath) throw new Error("CATALOG.md not found; pass --catalog explicitly or --no-catalog");
  if (!args["no-catalog"] && !slug) throw new Error("catalog slug could not be derived; pass --slug explicitly");

  if (args.check) {
    if (args["no-catalog"]) throw new Error("--check cannot be combined with --no-catalog");
    const { catalog, row } = inspectCatalogTarget({ catalogPath, slug });
    const result = {
      status: "admitted",
      catalog_path: catalog.path,
      slug,
      current_media_id: row.mediaId,
    };
    if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }

  if (!args["push-result"]) throw new Error("--push-result is required unless --check is used");
  const pushResultPath = path.resolve(args["push-result"]);
  const pushResult = JSON.parse(fs.readFileSync(pushResultPath, "utf8"));
  if (!pushResult.media_id || pushResult.errcode !== 0 || pushResult.verification?.status !== "passed") {
    throw new Error("push-result is not a verified successful draft result");
  }

  const catalogUpdate = args["no-catalog"]
    ? null
    : updateCatalogAfterPush({
        catalogPath,
        slug,
        mediaId: pushResult.media_id,
        account: args.account || pushResult.account || "",
        sourcePath: sourcePath || pushResult.source_path || "",
        auditPath: args.audit ? path.resolve(args.audit) : "",
      });
  const finalized = finalizePushResultBacklink({
    pushResultPath,
    auditPath: args.audit ? path.resolve(args.audit) : "",
    catalogUpdate,
  });
  const result = catalogUpdate
    ? { ...catalogUpdate, push_result: finalized }
    : { status: "evidence-finalized", changed: true, push_result: finalized };
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  try {
    updateWechatCatalogFromArgs();
  } catch (error) {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exitCode = 1;
  }
}

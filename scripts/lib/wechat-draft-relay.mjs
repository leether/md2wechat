import fs from "node:fs";
import path from "node:path";

function normalizeWechatAccount(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[()（）·.-]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
}

export const DEFAULT_WECHAT_DRAFT_RELAY_ROOT = "/path/to/your/relay/directory";
export const DEFAULT_WECHAT_DRAFT_RELAY_FAILURE_KEEP_COUNT = 3;
export const DEFAULT_WECHAT_DRAFT_RELAY_FAILURE_MAX_AGE_HOURS = 24;

const IMG_SRC_PATTERN = /(<img\b[^>]*\bsrc=")([^"]+)(")/gi;

function parseEnvPairs(envText = "") {
  const pairs = new Map();
  for (const line of String(envText || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1);
    pairs.set(key, value);
  }
  return pairs;
}

export function safeRelaySegment(value = "") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "relay";
}

export function shellQuote(value = "") {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function isRemoteImageSource(src = "") {
  return /^https?:\/\//i.test(String(src || "").trim());
}

export function isDataImageSource(src = "") {
  return /^data:/i.test(String(src || "").trim());
}

export function resolveRelayLocalImagePath(htmlPath, src, { cwd = process.cwd() } = {}) {
  const normalizedSrc = String(src || "").trim();
  if (!normalizedSrc || isRemoteImageSource(normalizedSrc) || isDataImageSource(normalizedSrc)) {
    return "";
  }

  const candidates = path.isAbsolute(normalizedSrc)
    ? [normalizedSrc]
    : [
        path.resolve(path.dirname(htmlPath), normalizedSrc),
        path.resolve(cwd, normalizedSrc),
      ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

export function buildRelayEnvContent(envText, account = "") {
  const envPairs = parseEnvPairs(envText);
  const normalizedAccount = normalizeWechatAccount(account);
  const keepKeys = [
    "WECHAT_MP_APP_ID",
    "WECHAT_MP_APP_SECRET",
  ];

  if (normalizedAccount) {
    keepKeys.push(
      `WECHAT_${normalizedAccount}_APP_ID`,
      `WECHAT_${normalizedAccount}_APP_SECRET`,
    );
  }

  const lines = keepKeys
    .filter((key) => envPairs.has(key))
    .map((key) => `${key}=${envPairs.get(key)}`);

  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function planRelayHtmlAssets(html, { htmlPath, assetDirName = "assets", cwd = process.cwd() } = {}) {
  const assetPlans = [];
  const seen = new Map();
  let ordinal = 0;

  const rewrittenHtml = String(html || "").replace(IMG_SRC_PATTERN, (full, prefix, src, suffix) => {
    const normalizedSrc = String(src || "").trim();
    const sourcePath = resolveRelayLocalImagePath(htmlPath, normalizedSrc, { cwd });
    if (!sourcePath) {
      return full;
    }

    if (!seen.has(sourcePath)) {
      ordinal += 1;
      const ext = path.extname(sourcePath).toLowerCase() || ".img";
      const targetRelativePath = `${assetDirName}/inline-${String(ordinal).padStart(2, "0")}${ext}`;
      const plan = { sourcePath, targetRelativePath };
      seen.set(sourcePath, plan);
      assetPlans.push(plan);
    }

    return `${prefix}${seen.get(sourcePath).targetRelativePath}${suffix}`;
  });

  return {
    html: rewrittenHtml,
    assets: assetPlans,
  };
}

export function buildRelayPruneCommand({
  accountRoot,
  excludeDir = "",
  keepCount = DEFAULT_WECHAT_DRAFT_RELAY_FAILURE_KEEP_COUNT,
  maxAgeHours = DEFAULT_WECHAT_DRAFT_RELAY_FAILURE_MAX_AGE_HOURS,
} = {}) {
  if (!accountRoot) {
    throw new Error("accountRoot is required for relay prune command");
  }

  const maxAgeSeconds = Math.max(1, Math.trunc(Number(maxAgeHours) * 3600));
  const normalizedKeepCount = Math.max(0, Math.trunc(Number(keepCount)));

  return [
    `root=${shellQuote(accountRoot)}`,
    `exclude=${shellQuote(excludeDir)}`,
    `keep_count=${normalizedKeepCount}`,
    `max_age_seconds=${maxAgeSeconds}`,
    '[ -d "$root" ] || exit 0',
    'now=$(date +%s)',
    'find "$root" -mindepth 1 -maxdepth 1 -type d -printf \'%T@ %p\\n\' | sort -nr |',
    'awk -v now="$now" -v keep="$keep_count" -v max_age="$max_age_seconds" -v exclude="$exclude" \'',
    '  {',
    '    ts = int($1);',
    '    dir = $2;',
    '    if (dir == exclude) next;',
    '    age = now - ts;',
    '    if (NR > keep || age > max_age) print dir;',
    '  }',
    '\' | while read -r dir; do',
    '  [ -n "$dir" ] || continue',
    '  rm -rf "$dir"',
    'done',
  ].join(" ");
}

import fs from "node:fs";
import path from "node:path";

const REQUIRED_CATALOG_COLUMNS = [
  "Date",
  "Slug",
  "Title",
  "Status",
  "Draftbox",
  "WeChat media_id",
  "Notes",
];

function splitMarkdownRow(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;

  const cells = [];
  let current = "";
  let escaped = false;
  for (const char of trimmed.slice(1, -1)) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function stripMarkdownValue(value = "") {
  const trimmed = String(value || "").trim();
  if (trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isSeparatorRow(cells) {
  return Array.isArray(cells) && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function atomicWriteText(targetPath, content) {
  const absolute = path.resolve(targetPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const tempPath = `${absolute}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, absolute);
  return absolute;
}

export function atomicWriteJson(targetPath, value) {
  return atomicWriteText(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

export function normalizeCatalogTitle(value = "") {
  return stripMarkdownValue(value)
    .normalize("NFKC")
    .replace(/&nbsp;/gi, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function normalizeCatalogMediaId(value = "") {
  const normalized = stripMarkdownValue(value);
  return ["", "无", "none", "n/a", "null"].includes(normalized.toLowerCase()) ? "" : normalized;
}

export function parseCatalogMarkdown(markdown = "") {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  let headerIndex = -1;
  let headers = [];

  for (let index = 0; index < lines.length; index += 1) {
    const cells = splitMarkdownRow(lines[index]);
    if (!cells) continue;
    const normalized = cells.map(stripMarkdownValue);
    if (REQUIRED_CATALOG_COLUMNS.every((column) => normalized.includes(column))) {
      headerIndex = index;
      headers = normalized;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error(`CATALOG table missing required columns: ${REQUIRED_CATALOG_COLUMNS.join(", ")}`);
  }

  const column = Object.fromEntries(headers.map((header, index) => [header, index]));
  const rows = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const cells = splitMarkdownRow(lines[index]);
    if (!cells) {
      if (rows.length > 0) break;
      continue;
    }
    if (isSeparatorRow(cells)) continue;
    if (cells.length !== headers.length) {
      throw new Error(`CATALOG row ${index + 1} has ${cells.length} cells; expected ${headers.length}`);
    }
    rows.push({
      lineIndex: index,
      cells,
      date: stripMarkdownValue(cells[column.Date]),
      slug: stripMarkdownValue(cells[column.Slug]),
      title: stripMarkdownValue(cells[column.Title]),
      status: stripMarkdownValue(cells[column.Status]),
      draftbox: stripMarkdownValue(cells[column.Draftbox]),
      mediaId: normalizeCatalogMediaId(cells[column["WeChat media_id"]]),
      notes: stripMarkdownValue(cells[column.Notes]),
    });
  }

  return { lines, headers, column, rows };
}

export function readCatalog(catalogPath) {
  const absolute = path.resolve(catalogPath);
  return {
    path: absolute,
    markdown: fs.readFileSync(absolute, "utf8"),
    ...parseCatalogMarkdown(fs.readFileSync(absolute, "utf8")),
  };
}

export function discoverCatalogPath(sourcePath, { maxDepth = 10 } = {}) {
  if (!sourcePath) return "";
  let current = path.resolve(fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory()
    ? sourcePath
    : path.dirname(sourcePath));

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const candidate = path.join(current, "CATALOG.md");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "";
}

export function deriveCatalogSlug(sourcePath) {
  if (!sourcePath) return "";
  const absolute = path.resolve(sourcePath);
  const sourceStem = path.basename(absolute, path.extname(absolute));
  if (!/^(?:article|index|draft)$/i.test(sourceStem)) return sourceStem;
  return path.basename(path.dirname(absolute)).replace(/^\d{4}-\d{2}(?:-\d{2})?-/, "");
}

export function inspectCatalogTarget({ catalogPath, slug }) {
  if (!catalogPath) throw new Error("catalogPath is required");
  if (!slug) throw new Error("catalog slug is required");
  const catalog = readCatalog(catalogPath);
  const matches = catalog.rows.filter((row) => row.slug === slug);
  if (matches.length !== 1) {
    throw new Error(`catalog slug ${slug} matched ${matches.length} rows in ${catalog.path}; expected exactly 1`);
  }
  return { catalog, row: matches[0] };
}

function normalizedPointer(value = "") {
  return String(value || "").replaceAll(path.sep, "/").replace(/^\.\//, "");
}

function appendNote(notes, fragment) {
  const trimmed = String(notes || "").trim().replace(/[；;]\s*$/, "");
  if (!fragment || trimmed.includes(fragment)) return trimmed;
  return trimmed ? `${trimmed}；${fragment}` : fragment;
}

export function updateCatalogAfterPush({
  catalogPath,
  slug,
  mediaId,
  account = "",
  sourcePath = "",
  auditPath = "",
  auditPointer = "",
  checkOnly = false,
} = {}) {
  if (!mediaId && !checkOnly) throw new Error("mediaId is required for CATALOG update");
  const { catalog, row } = inspectCatalogTarget({ catalogPath, slug });
  if (checkOnly) {
    return {
      status: "admitted",
      changed: false,
      catalog_path: catalog.path,
      slug,
      current_media_id: row.mediaId,
    };
  }

  const cells = [...row.cells];
  const oldMediaId = row.mediaId;
  cells[catalog.column.Status] = "pushed-draft";
  if (!row.draftbox || /^(?:无|未推送|未推送草稿箱)$/i.test(row.draftbox)) {
    cells[catalog.column.Draftbox] = account ? `已推送草稿箱（${account}）` : "已推送草稿箱";
  }
  cells[catalog.column["WeChat media_id"]] = `\`${mediaId}\``;

  let notes = row.notes;
  let pointer = normalizedPointer(auditPointer);
  if (!pointer && auditPath) {
    pointer = sourcePath
      ? normalizedPointer(path.relative(path.dirname(path.resolve(sourcePath)), path.resolve(auditPath)))
      : normalizedPointer(auditPath);
  }
  if (pointer) notes = appendNote(notes, `回执见 \`${pointer}\``);
  if (oldMediaId && oldMediaId !== mediaId) {
    notes = appendNote(notes, `原 media_id \`${oldMediaId}\` 已失效并更新`);
  }
  cells[catalog.column.Notes] = notes;

  const nextLine = `| ${cells.join(" | ")} |`;
  const changed = nextLine !== catalog.lines[row.lineIndex];
  if (changed) {
    catalog.lines[row.lineIndex] = nextLine;
    atomicWriteText(catalog.path, catalog.lines.join("\n"));
  }

  return {
    status: "updated",
    changed,
    catalog_path: catalog.path,
    slug,
    old_media_id: oldMediaId,
    media_id: mediaId,
    audit_pointer: pointer,
  };
}

export function finalizePushResultBacklink({ pushResultPath, auditPath, catalogUpdate = null } = {}) {
  const absolute = path.resolve(pushResultPath);
  const result = JSON.parse(fs.readFileSync(absolute, "utf8"));
  result.evidence = {
    ...(result.evidence || {}),
    audit_path: auditPath ? path.resolve(auditPath) : result.evidence?.audit_path || "",
    push_result_path: absolute,
  };
  if (catalogUpdate) {
    result.backlink = {
      status: catalogUpdate.status || "updated",
      catalog_path: catalogUpdate.catalog_path || "",
      catalog_slug: catalogUpdate.slug || "",
      old_media_id: catalogUpdate.old_media_id || "",
      audit_pointer: catalogUpdate.audit_pointer || "",
    };
  }
  atomicWriteJson(absolute, result);
  return result;
}

function walkDirectories(rootPath, visit) {
  if (!rootPath || !fs.existsSync(rootPath)) return;
  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(current, entry.name);
      if (visit(fullPath, entry.name) === false) continue;
      stack.push(fullPath);
    }
  }
}

export function findArticleDirectory({ catalogPath, slug }) {
  const articlesRoot = path.join(path.dirname(path.resolve(catalogPath)), "articles");
  const matches = [];
  walkDirectories(articlesRoot, (fullPath, name) => {
    if (name === slug || name.endsWith(`-${slug}`)) matches.push(fullPath);
    return !name.startsWith("publish");
  });
  return matches.length === 1 ? matches[0] : "";
}

export function findAuditPointerForSlug({ catalogPath, slug, mediaId = "" }) {
  const articleDir = findArticleDirectory({ catalogPath, slug });
  if (!articleDir) return "";
  const publishRoot = path.join(articleDir, "publish");
  if (!fs.existsSync(publishRoot)) return "";
  const versionDirs = fs.readdirSync(publishRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
    .sort((a, b) => Number(b.name.slice(1)) - Number(a.name.slice(1)));

  for (const version of versionDirs) {
    const versionDir = path.join(publishRoot, version.name);
    const auditPath = path.join(versionDir, "audit.log");
    const resultPath = path.join(versionDir, "push-result.json");
    let matches = !mediaId;
    if (mediaId && fs.existsSync(resultPath)) {
      try {
        matches = JSON.parse(fs.readFileSync(resultPath, "utf8")).media_id === mediaId;
      } catch {
        matches = false;
      }
    }
    if (mediaId && !matches && fs.existsSync(auditPath)) {
      matches = fs.readFileSync(auditPath, "utf8").includes(mediaId);
    }
    if (matches && fs.existsSync(auditPath)) {
      return normalizedPointer(path.relative(articleDir, auditPath));
    }
  }
  return "";
}

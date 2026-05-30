import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(thisDir, "..", "..");
export const memoryRoot = path.join(repoRoot, "docs", "memory");

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

export function writeUtf8(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function today() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseArgs(argv) {
  const args = { _: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    const value = !next || next.startsWith("--") ? true : next;

    if (value !== true) {
      i += 1;
    }

    if (Object.prototype.hasOwnProperty.call(args, key)) {
      args[key] = Array.isArray(args[key]) ? [...args[key], value] : [args[key], value];
    } else {
      args[key] = value;
    }
  }

  return args;
}

export function asArray(value) {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

export function requireArg(args, key, message) {
  if (!args[key] || args[key] === true) {
    throw new Error(message || `Missing required argument --${key}`);
  }

  return args[key];
}

export function formatMetadataBlock(entries) {
  return entries
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `- \`${key}\`: ${value}`)
    .join("\n");
}

export function formatBulletSection(items) {
  const normalized = items.filter(Boolean);
  return normalized.length ? normalized.map((item) => `- ${item}`).join("\n") : "- ";
}

export function extractMetadata(content) {
  const lines = content.replace(/\r/g, "").split("\n");
  const metadata = {};
  let inMetadata = false;

  for (const line of lines) {
    if (line.trim() === "## Metadata") {
      inMetadata = true;
      continue;
    }

    if (inMetadata && line.startsWith("## ")) {
      break;
    }

    if (!inMetadata) {
      continue;
    }

    const match = line.match(/^- `([^`]+)`: ?(.*)$/);
    if (match) {
      metadata[match[1]] = match[2].trim();
    }
  }

  return metadata;
}

export function updateMetadata(content, updates) {
  const lines = content.replace(/\r/g, "").split("\n");
  const nextLines = [];
  let inMetadata = false;
  let wroteMetadata = false;

  for (const line of lines) {
    if (line.trim() === "## Metadata") {
      inMetadata = true;
      wroteMetadata = true;
      nextLines.push(line);
      nextLines.push("");
      continue;
    }

    if (inMetadata && line.startsWith("## ")) {
      nextLines.push(
        ...Object.entries(updates)
          .filter(([, value]) => value !== undefined && value !== "")
          .map(([key, value]) => `- \`${key}\`: ${value}`),
      );
      nextLines.push("");
      nextLines.push(line);
      inMetadata = false;
      continue;
    }

    if (inMetadata) {
      continue;
    }

    nextLines.push(line);
  }

  if (!wroteMetadata) {
    throw new Error("Missing ## Metadata section");
  }

  if (inMetadata) {
    nextLines.push(
      ...Object.entries(updates)
        .filter(([, value]) => value !== undefined && value !== "")
        .map(([key, value]) => `- \`${key}\`: ${value}`),
    );
  }

  return `${nextLines.join("\n").replace(/\n+$/, "")}\n`;
}

export function listMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return listMarkdownFiles(fullPath);
      }
      return entry.name.endsWith(".md") ? [fullPath] : [];
    })
    .sort();
}

export function relativeToRepo(filePath) {
  return path.relative(repoRoot, filePath);
}

export function promotedKindFromPath(filePath) {
  const relPath = relativeToRepo(filePath);

  if (relPath.startsWith("docs/memory/facts/")) {
    return "fact";
  }

  if (relPath.startsWith("docs/memory/decisions/")) {
    return "decision";
  }

  if (relPath.startsWith("docs/memory/profiles/")) {
    return "profile";
  }

  throw new Error(`Unsupported promoted memory path: ${relPath}`);
}

export function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

export function printHelp(lines) {
  console.log(lines.join("\n"));
}

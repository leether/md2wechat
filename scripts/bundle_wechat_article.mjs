import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── 轻量 args 解析 ──
function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  args._ = positional;
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/bundle_wechat_article.mjs --html <file.html> --out <dir> [options]

Required:
  --html <path>            Rendered WeChat HTML file
  --out <dir>              Output bundle directory (will be created/cleaned)

Optional:
  --lint <path>            Lint report JSON to include in bundle
  --qr <path>              QR code image to include in bundle
  --env <path>             .env file to include in bundle
  --help                   Show this help

Behavior:
  1. Reads HTML and extracts all local image paths from src attributes
  2. Creates/cleans the output directory
  3. Copies HTML + all images + optional lint/qr/env into the directory
  4. Replaces absolute paths in HTML with filenames only
  5. Validates bundle integrity and outputs a manifest
`);
}

// ── 从 HTML 提取所有图片路径 ──
function extractImagePaths(html, baseDir) {
  const paths = [];
  const regex = /src=["']([^"']+)["']/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const src = m[1];
    // 跳过 URL 和 data URI
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
      continue;
    }
    const resolved = path.isAbsolute(src) ? src : path.resolve(baseDir, src);
    paths.push({ original: src, resolved, basename: path.basename(src) });
  }
  return paths;
}

// ── 主流程 ──
function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return 0;
  }

  const htmlPath = args.html;
  if (!htmlPath) {
    console.error("❌ Missing --html argument");
    printHelp();
    return 1;
  }
  if (!fs.existsSync(htmlPath)) {
    console.error(`❌ HTML file not found: ${htmlPath}`);
    return 1;
  }

  const outDir = args.out;
  if (!outDir) {
    console.error("❌ Missing --out argument");
    printHelp();
    return 1;
  }

  // 读取 HTML
  const html = fs.readFileSync(htmlPath, "utf8");
  const htmlDir = path.dirname(htmlPath);

  // 提取图片路径
  const images = extractImagePaths(html, htmlDir);

  // 去重（按 resolved 路径）
  const seen = new Set();
  const uniqueImages = [];
  for (const img of images) {
    if (seen.has(img.resolved)) continue;
    seen.add(img.resolved);
    uniqueImages.push(img);
  }

  // 清理并创建输出目录
  if (fs.existsSync(outDir)) {
    // 只删除文件，保留目录本身
    for (const entry of fs.readdirSync(outDir)) {
      const entryPath = path.join(outDir, entry);
      const stat = fs.statSync(entryPath);
      if (stat.isFile()) fs.unlinkSync(entryPath);
      if (stat.isDirectory()) fs.rmSync(entryPath, { recursive: true });
    }
  } else {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // 复制图片
  const manifest = {
    html: path.basename(htmlPath),
    images: [],
    extras: [],
    missing: [],
  };

  for (const img of uniqueImages) {
    if (!fs.existsSync(img.resolved)) {
      manifest.missing.push(img.resolved);
      continue;
    }
    const dest = path.join(outDir, img.basename);
    fs.copyFileSync(img.resolved, dest);
    manifest.images.push({
      original: img.original,
      basename: img.basename,
      size: fs.statSync(dest).size,
    });
  }

  // 替换 HTML 中的路径
  let bundledHtml = html;
  for (const img of uniqueImages) {
    if (manifest.missing.includes(img.resolved)) continue;
    // 安全替换：精确匹配原路径
    const escaped = img.original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`src=["']${escaped}["']`, "g");
    bundledHtml = bundledHtml.replace(re, `src="${img.basename}"`);
  }

  // 写入 HTML
  const outHtmlPath = path.join(outDir, path.basename(htmlPath));
  fs.writeFileSync(outHtmlPath, bundledHtml);

  // 复制 lint report
  if (args.lint && fs.existsSync(args.lint)) {
    const lintDest = path.join(outDir, path.basename(args.lint));
    fs.copyFileSync(args.lint, lintDest);
    manifest.extras.push({ file: path.basename(args.lint), type: "lint" });
  }

  // 复制 QR code
  if (args.qr && fs.existsSync(args.qr)) {
    const qrDest = path.join(outDir, path.basename(args.qr));
    fs.copyFileSync(args.qr, qrDest);
    manifest.extras.push({ file: path.basename(args.qr), type: "qr" });
  }

  // 复制 .env
  if (args.env && fs.existsSync(args.env)) {
    const envDest = path.join(outDir, path.basename(args.env));
    fs.copyFileSync(args.env, envDest);
    manifest.extras.push({ file: path.basename(args.env), type: "env" });
  }

  // ── 验证 bundle ──
  const validation = {
    localPaths: 0,
    oversizedImages: [],
    allImagesPresent: true,
  };

  const finalHtml = fs.readFileSync(outHtmlPath, "utf8");
  const localPathRegex = /src=["']\/(?:Users|tmp|home|var)\/[^"']+["']/g;
  validation.localPaths = (finalHtml.match(localPathRegex) || []).length;

  for (const img of manifest.images) {
    const imgPath = path.join(outDir, img.basename);
    if (img.size > 2097152) {
      validation.oversizedImages.push({ basename: img.basename, size: img.size });
    }
  }

  validation.allImagesPresent = manifest.missing.length === 0;

  // ── 输出报告 ──
  console.log("━━━ md2wechat Bundle Report ━━━");
  console.log(`Bundle dir: ${outDir}`);
  console.log(`HTML: ${manifest.html}`);
  console.log(`Images: ${manifest.images.length}`);
  for (const img of manifest.images) {
    const sizeMB = (img.size / 1024 / 1024).toFixed(2);
    const flag = img.size > 2097152 ? " ⚠️ OVERSIZE" : "";
    console.log(`  → ${img.basename} (${sizeMB}MB)${flag}`);
  }
  if (manifest.missing.length > 0) {
    console.log(`\n❌ Missing images:`);
    for (const m of manifest.missing) console.log(`  → ${m}`);
  }
  if (manifest.extras.length > 0) {
    console.log(`Extras: ${manifest.extras.map((e) => e.file).join(", ")}`);
  }
  console.log("\n【Validation】");
  console.log(`  Local paths in HTML: ${validation.localPaths} ${validation.localPaths === 0 ? "✅" : "❌"}`);
  console.log(`  All images present: ${validation.allImagesPresent ? "✅" : "❌"}`);
  if (validation.oversizedImages.length > 0) {
    console.log(`  Oversized images: ${validation.oversizedImages.length} ❌`);
    for (const o of validation.oversizedImages) {
      console.log(`    → ${o.basename} (${(o.size / 1024 / 1024).toFixed(2)}MB > 2MB)`);
    }
  } else {
    console.log(`  Image sizes: ✅`);
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // 写入 manifest
  const manifestPath = path.join(outDir, "bundle-manifest.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ manifest, validation, bundledAt: new Date().toISOString() }, null, 2),
  );

  const hasErrors = manifest.missing.length > 0 || validation.localPaths > 0;
  return hasErrors ? 1 : 0;
}

const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
  (fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
);
if (isMain) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

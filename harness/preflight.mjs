import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

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
  console.log(`Usage: node harness/preflight.mjs --html <file.html> [options]

Required:
  --html <path>            WeChat-ready HTML file

Optional:
  --md <path>              Source Markdown file (for L3 card/table count checks)
  --title <text>           Article title (overrides HTML inference)
  --author <text>          Article author
  --digest <text>          Article digest (overrides HTML <!-- WECHAT_SUMMARY -->)
  --cover <path>           Cover image path (for size/aspect checks)
  --rules <path>           push_rules.json path (default: ./push_rules.json)
  --json                   Output machine-readable JSON only
  --help                   Show this help
`);
}

// ── 字符计数（按微信规则：一个汉字=1，一个英文/数字=1） ──
function countChars(str) {
  if (!str) return 0;
  let count = 0;
  for (const ch of String(str)) {
    count++;
  }
  return count;
}

// ── 从 HTML 提取 summary ──
function extractDigestFromHtml(html) {
  const m = html.match(/<!--\s*WECHAT_SUMMARY:\s*(.*?)\s*-->/);
  return m ? m[1].trim() : "";
}

// ── 从 HTML 提取 title ──
function extractTitleFromHtml(html) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : "";
}

// ── 从 HTML 提取所有本地图片路径 ──
function extractLocalImagePaths(html, htmlDir) {
  const paths = [];
  const regex = /src=["']([^"']+)["']/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const src = m[1];
    // 跳过已上传的 CDN 图片
    if (src.includes("mmbiz.qpic.cn")) continue;
    if (src.startsWith("http://") || src.startsWith("https://")) continue;
    if (src.startsWith("data:")) continue;
    // 相对路径或绝对路径
    const resolved = path.isAbsolute(src) ? src : path.resolve(htmlDir, src);
    paths.push(resolved);
  }
  return paths;
}

// ── 获取图片尺寸（macOS sips / Linux file） ──
function getImageDimensions(imagePath) {
  try {
    if (process.platform === "darwin") {
      const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", imagePath], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const w = out.match(/pixelWidth:\s*(\d+)/);
      const h = out.match(/pixelHeight:\s*(\d+)/);
      if (w && h) return { width: parseInt(w[1]), height: parseInt(h[1]) };
    } else {
      const out = execFileSync("file", [imagePath], { encoding: "utf8" });
      const m = out.match(/(\d+)\s*x\s*(\d+)/);
      if (m) return { width: parseInt(m[1]), height: parseInt(m[2]) };
    }
  } catch {}
  return null;
}

// ── L1 检查实现 ──

function checkDigestLength(html, digestArg, rules) {
  const digest = digestArg || extractDigestFromHtml(html) || "";
  const len = countChars(digest);
  const max = rules.threshold?.max_chars || 128;
  if (len > max) {
    return {
      passed: false,
      level: "L1",
      id: "digest_length",
      message: `Digest exceeds ${max} characters: got ${len}`,
      actual: len,
      limit: max,
      digest: digest.slice(0, 60) + (digest.length > 60 ? "..." : ""),
    };
  }
  return { passed: true, level: "L1", id: "digest_length", actual: len };
}

function checkTitleLength(html, titleArg, rules) {
  const title = titleArg || extractTitleFromHtml(html) || "";
  const len = countChars(title);
  const max = rules.threshold?.max_chars || 32;
  if (len > max) {
    return {
      passed: false,
      level: "L1",
      id: "title_length",
      message: `Title exceeds ${max} characters: got ${len}`,
      actual: len,
      limit: max,
    };
  }
  return { passed: true, level: "L1", id: "title_length", actual: len };
}

function checkAuthorLength(authorArg, rules) {
  const author = authorArg || "";
  const len = countChars(author);
  const max = rules.threshold?.max_chars || 16;
  if (len > max) {
    return {
      passed: false,
      level: "L1",
      id: "author_length",
      message: `Author exceeds ${max} characters: got ${len}`,
      actual: len,
      limit: max,
    };
  }
  return { passed: true, level: "L1", id: "author_length", actual: len };
}

function checkLocalPaths(html, rules) {
  const matches = [];
  // 匹配本地绝对路径模式
  const patterns = [
    /src=["']\/Users\/[^"']+["']/g,
    /src=["']\/tmp\/[^"']+["']/g,
    /src=["']\/home\/[^"']+["']/g,
    /src=["']\/var\/[^"']+["']/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      matches.push(m[0]);
    }
  }
  if (matches.length > 0) {
    return {
      passed: false,
      level: "L1",
      id: "local_path_absence",
      message: `Found ${matches.length} local absolute path(s) in HTML. Must replace with filenames before upload.`,
      matches: matches.slice(0, 5),
    };
  }
  return { passed: true, level: "L1", id: "local_path_absence" };
}

function checkImageSizes(html, htmlDir, coverPath, rules) {
  const maxBytes = rules.threshold?.max_bytes || 2097152;
  const imagePaths = extractLocalImagePaths(html, htmlDir);
  if (coverPath) imagePaths.push(path.resolve(coverPath));

  const oversized = [];
  for (const p of imagePaths) {
    if (!fs.existsSync(p)) {
      oversized.push({ path: p, exists: false, size: 0 });
      continue;
    }
    const stat = fs.statSync(p);
    if (stat.size > maxBytes) {
      oversized.push({
        path: p,
        exists: true,
        size: stat.size,
        limit: maxBytes,
        oversize_by: `${((stat.size - maxBytes) / 1024).toFixed(1)}KB`,
      });
    }
  }
  if (oversized.length > 0) {
    const missing = oversized.filter((o) => !o.exists);
    const tooBig = oversized.filter((o) => o.exists);
    const msgs = [];
    if (missing.length) msgs.push(`${missing.length} image(s) not found`);
    if (tooBig.length) msgs.push(`${tooBig.length} image(s) exceed ${(maxBytes / 1024 / 1024).toFixed(1)}MB`);
    return {
      passed: false,
      level: "L1",
      id: "image_size",
      message: msgs.join("; "),
      details: oversized,
    };
  }
  return { passed: true, level: "L1", id: "image_size", checked: imagePaths.length };
}

function checkHtmlCompliance(html, rules) {
  const issues = [];
  const positionCount = (html.match(/position:/g) || []).length;
  const filterCount = (html.match(/filter:/g) || []).length;
  if (positionCount > 0) {
    issues.push(`Found ${positionCount} 'position:' style(s). WeChat strips position CSS.`);
  }
  if (filterCount > 0) {
    issues.push(`Found ${filterCount} 'filter:' style(s). WeChat strips filter CSS.`);
  }
  if (issues.length > 0) {
    return {
      passed: false,
      level: "L1",
      id: "html_compliance",
      message: issues.join(" "),
      positionCount,
      filterCount,
    };
  }
  return { passed: true, level: "L1", id: "html_compliance", positionCount, filterCount };
}

// ── L2 检查实现 ──

function checkContentChars(html, rules) {
  const textOnly = html.replace(/<[^>]+>/g, "");
  const len = countChars(textOnly);
  const warn = rules.threshold?.warn_chars || 20000;
  if (len >= warn) {
    return {
      passed: false,
      level: "L2",
      id: "content_chars",
      message: `HTML content text exceeds ${warn} characters: got ${len}`,
      actual: len,
      warn,
    };
  }
  return { passed: true, level: "L2", id: "content_chars", actual: len };
}

function checkContentBytes(html, rules) {
  const bytes = Buffer.byteLength(html, "utf8");
  const warn = rules.threshold?.warn_bytes || 1048576;
  if (bytes >= warn) {
    return {
      passed: false,
      level: "L2",
      id: "content_bytes",
      message: `HTML content exceeds ${(warn / 1024 / 1024).toFixed(1)}MB: got ${(bytes / 1024).toFixed(1)}KB`,
      actual: bytes,
      warn,
    };
  }
  return { passed: true, level: "L2", id: "content_bytes", actual: bytes };
}

function checkCoverAspectRatio(coverPath, rules) {
  if (!coverPath || !fs.existsSync(coverPath)) {
    return { passed: true, level: "L2", id: "cover_aspect_ratio", skipped: true, reason: "No cover provided" };
  }
  const dims = getImageDimensions(coverPath);
  if (!dims) {
    return { passed: true, level: "L2", id: "cover_aspect_ratio", skipped: true, reason: "Cannot read dimensions" };
  }
  const ratio = dims.width / dims.height;
  const target = rules.threshold?.target_ratio || 2.35;
  const tolerance = rules.threshold?.tolerance || 0.2;
  const diff = Math.abs(ratio - target);
  if (diff > tolerance) {
    return {
      passed: false,
      level: "L2",
      id: "cover_aspect_ratio",
      message: `Cover aspect ratio ${ratio.toFixed(2)} deviates from target ${target} (tolerance ±${tolerance})`,
      actual: ratio,
      target,
      recommended_crop: `0_0.0035_1_0.9965`,
    };
  }
  return { passed: true, level: "L2", id: "cover_aspect_ratio", actual: ratio, target };
}

function checkSummaryQuality(html, rules) {
  const digest = extractDigestFromHtml(html) || "";
  const len = countChars(digest);
  const minChars = rules.threshold?.min_chars || 20;
  const minData = rules.threshold?.min_data_points || 1;
  // 简单启发：检查是否包含数字
  const hasNumber = /\d/.test(digest);
  if (len < minChars || !hasNumber) {
    return {
      passed: false,
      level: "L2",
      id: "summary_quality",
      message: `Summary should contain concrete data points (numbers/dates/percentages). Got ${len} chars, hasNumber=${hasNumber}`,
      actual: len,
      hasNumber,
    };
  }
  return { passed: true, level: "L2", id: "summary_quality", actual: len, hasNumber };
}

// ── L3 检查实现 ──

function checkCtaIntegrity(html, rules) {
  const hasFooter = html.includes("扫码加入") || html.includes("交流群") || html.includes("qr.png");
  const hasQr = html.includes("qr.png") || html.includes("mmbiz.qpic.cn");
  if (!hasFooter) {
    return {
      passed: false,
      level: "L3",
      id: "cta_integrity",
      message: "No CTA footer detected in HTML. Consider adding a footer with QR code.",
      auto_detect: true,
    };
  }
  return { passed: true, level: "L3", id: "cta_integrity", hasFooter, hasQr };
}

function checkCardCount(html, mdPath, rules) {
  const htmlCardCount = (html.match(/border-radius:22px/g) || []).length;
  let mdCardCount = 0;
  if (mdPath && fs.existsSync(mdPath)) {
    const md = fs.readFileSync(mdPath, "utf8");
    mdCardCount = (md.match(/:::\s*wechat-card/g) || []).length;
  }
  if (mdPath && mdCardCount > 0 && htmlCardCount !== mdCardCount) {
    return {
      passed: false,
      level: "L3",
      id: "card_count_match",
      message: `Card count mismatch: MD has ${mdCardCount}, HTML has ${htmlCardCount}`,
      mdCount: mdCardCount,
      htmlCount: htmlCardCount,
    };
  }
  return { passed: true, level: "L3", id: "card_count_match", htmlCount: htmlCardCount, mdCount: mdCardCount };
}

function checkTableCount(html, mdPath, rules) {
  const htmlTableCount = (html.match(/<table/g) || []).length;
  let mdTableCount = 0;
  if (mdPath && fs.existsSync(mdPath)) {
    const md = fs.readFileSync(mdPath, "utf8");
    mdTableCount = (md.match(/^\|.*\|.*\|/gm) || []).length;
    // 排除卡片内部的表格（会被静默忽略）
    const lines = md.split("\n");
    let inCard = false;
    let cardTableCount = 0;
    for (const line of lines) {
      if (line.trim().startsWith(":::wechat-card")) inCard = true;
      if (line.trim() === ":::") inCard = false;
      if (inCard && line.trim().startsWith("|")) cardTableCount++;
    }
    mdTableCount -= cardTableCount;
  }
  if (mdPath && mdTableCount > 0 && htmlTableCount !== mdTableCount) {
    return {
      passed: false,
      level: "L3",
      id: "table_count_match",
      message: `Table count mismatch: MD has ${mdTableCount} (excl. cards), HTML has ${htmlTableCount}`,
      mdCount: mdTableCount,
      htmlCount: htmlTableCount,
    };
  }
  return { passed: true, level: "L3", id: "table_count_match", htmlCount: htmlTableCount, mdCount: mdTableCount };
}

function checkImageCdnCount(html, rules) {
  const imgCount = (html.match(/<img/g) || []).length;
  const cdnCount = (html.match(/mmbiz\.qpic\.cn/g) || []).length;
  // 本地 preflight 时 CDN 数通常等于 0（还没上传）
  // 这个检查主要用于推送后的 Audit Log 对比
  // 但本地可以检查是否有残留的非 CDN、非本地路径的 src
  const localPatternCount = (html.match(/src=["']\//g) || []).length;
  if (localPatternCount > 0) {
    return {
      passed: false,
      level: "L3",
      id: "image_cdn_count_match",
      message: `Found ${localPatternCount} image(s) with local/absolute paths. All images should be filenames (for upload) or CDN URLs.`,
      imgCount,
      cdnCount,
      localCount: localPatternCount,
    };
  }
  return { passed: true, level: "L3", id: "image_cdn_count_match", imgCount, cdnCount };
}

// ── 主检查流程 ──

export function runPreflight(opts) {
  const {
    htmlPath,
    mdPath,
    title,
    author,
    digest,
    coverPath,
    rulesPath,
  } = opts;

  const rulesFile = rulesPath || path.join(path.dirname(fileURLToPath(import.meta.url)), "push_rules.json");
  let rules = {};
  try {
    rules = JSON.parse(fs.readFileSync(rulesFile, "utf8"));
  } catch (e) {
    console.error(`⚠️  Cannot load rules from ${rulesFile}: ${e.message}`);
  }

  const html = fs.readFileSync(htmlPath, "utf8");
  const htmlDir = path.dirname(htmlPath);

  const l1Checks = [
    checkDigestLength(html, digest, rules.l1_mandatory_checks?.digest_length || {}),
    checkTitleLength(html, title, rules.l1_mandatory_checks?.title_length || {}),
    checkAuthorLength(author, rules.l1_mandatory_checks?.author_length || {}),
    checkLocalPaths(html, rules.l1_mandatory_checks?.local_path_absence || {}),
    checkImageSizes(html, htmlDir, coverPath, rules.l1_mandatory_checks?.image_size || {}),
    checkHtmlCompliance(html, rules.l1_mandatory_checks?.html_compliance || {}),
  ];

  const l2Checks = [
    checkContentChars(html, rules.l2_warning_checks?.content_chars || {}),
    checkContentBytes(html, rules.l2_warning_checks?.content_bytes || {}),
    checkCoverAspectRatio(coverPath, rules.l2_warning_checks?.cover_aspect_ratio || {}),
    checkSummaryQuality(html, rules.l2_warning_checks?.summary_quality || {}),
  ];

  const l3Checks = [
    checkCtaIntegrity(html, rules.l3_pattern_checks?.cta_integrity || {}),
    checkCardCount(html, mdPath, rules.l3_pattern_checks?.card_count_match || {}),
    checkTableCount(html, mdPath, rules.l3_pattern_checks?.table_count_match || {}),
    checkImageCdnCount(html, rules.l3_pattern_checks?.image_cdn_count_match || {}),
  ];

  const l1Failures = l1Checks.filter((c) => !c.passed);
  const l2Warnings = l2Checks.filter((c) => !c.passed);
  const l3NeedsReview = l3Checks.filter((c) => !c.passed);

  const ok = l1Failures.length === 0;

  return {
    ok,
    timestamp: new Date().toISOString(),
    htmlPath,
    mdPath,
    l1: { total: l1Checks.length, passed: l1Checks.length - l1Failures.length, failures: l1Failures },
    l2: { total: l2Checks.length, passed: l2Checks.length - l2Warnings.length, warnings: l2Warnings },
    l3: { total: l3Checks.length, passed: l3Checks.length - l3NeedsReview.length, needsReview: l3NeedsReview },
    autopoiesis: rules.autopoiesis || {},
  };
}

function formatReport(report) {
  const lines = [];
  lines.push("━━━ md2wechat Local Preflight ━━━");
  lines.push(`时间: ${report.timestamp}`);
  lines.push(`HTML: ${report.htmlPath}`);
  if (report.mdPath) lines.push(`MD: ${report.mdPath}`);
  lines.push("");

  // L1
  lines.push(`【L1 硬阻塞】${report.l1.passed}/${report.l1.total}`);
  for (const c of report.l1.failures) {
    lines.push(`  ❌ ${c.id}: ${c.message}`);
  }
  for (const c of report.l1.failures) {
    if (c.digest) lines.push(`     digest: "${c.digest}"`);
    if (c.matches) lines.push(`     matches: ${c.matches.join(", ")}`);
    if (c.details) {
      for (const d of c.details.slice(0, 3)) {
        lines.push(`     ${d.path}${d.exists ? ` (${(d.size / 1024 / 1024).toFixed(2)}MB > limit)` : " [NOT FOUND]"}`);
      }
    }
  }
  lines.push(report.l1.failures.length === 0 ? "  ✅ 全部通过" : "");

  // L2
  lines.push(`【L2 警告】${report.l2.passed}/${report.l2.total}`);
  for (const c of report.l2.warnings) {
    lines.push(`  ⚠️  ${c.id}: ${c.message}`);
  }
  if (report.l2.warnings.length === 0) lines.push("  ✅ 无警告");

  // L3
  lines.push(`【L3 人工确认】${report.l3.passed}/${report.l3.total}`);
  for (const c of report.l3.needsReview) {
    lines.push(`  📝 ${c.id}: ${c.message}`);
  }
  if (report.l3.needsReview.length === 0) lines.push("  ✅ 无待确认项");

  lines.push("");
  lines.push(report.ok ? "✅ Preflight 通过，可以上传推送。" : "❌ Preflight 未通过，请修复 L1 问题后重试。");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  return lines.join("\n");
}

// ── CLI 入口 ──
function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || (!args.html && !args._?.[0])) {
    printHelp();
    return 0;
  }

  const htmlPath = args.html || args._[0];
  if (!fs.existsSync(htmlPath)) {
    console.error(`❌ HTML file not found: ${htmlPath}`);
    return 1;
  }

  const report = runPreflight({
    htmlPath,
    mdPath: args.md,
    title: args.title,
    author: args.author,
    digest: args.digest,
    coverPath: args.cover,
    rulesPath: args.rules,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }

  return report.ok ? 0 : 1;
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

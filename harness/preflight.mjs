import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loadLivingMemory, formatL3MemoryItems } from "./memory-loader.mjs";

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
  const ctaKeywords = ["扫码", "加入", "交流群", "关注", "点赞", "在看", "转发", "推荐", "星标"];
  const hasCtaText = ctaKeywords.some((kw) => html.includes(kw));
  const hasQr = html.includes("qr.png") || html.includes("mmbiz.qpic.cn");
  const hasFooterRegion = html.includes("footer") || html.includes("cta") || html.includes("qr");

  if (!hasCtaText && !hasQr) {
    return {
      passed: false,
      level: "L1",
      id: "cta_integrity",
      message: "No CTA footer detected in HTML. Consider adding a footer with QR code.",
      details: { hasCtaText, hasQr, hasFooterRegion },
    };
  }

  // 有 CTA 文本但无二维码 → 警告级别（可能是纯文本 CTA）
  if (hasCtaText && !hasQr) {
    return {
      passed: false,
      level: "L1",
      id: "cta_integrity",
      message: "CTA text found but no QR code image detected. If article needs QR footer, check .env FOOTER_QR_PATH.",
      details: { hasCtaText, hasQr, hasFooterRegion },
    };
  }

  return { passed: true, level: "L1", id: "cta_integrity", hasCtaText, hasQr, hasFooterRegion };
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
      level: "L1",
      id: "card_count_match",
      message: `Card count mismatch: MD has ${mdCardCount}, HTML has ${htmlCardCount}`,
      mdCount: mdCardCount,
      htmlCount: htmlCardCount,
    };
  }
  return { passed: true, level: "L1", id: "card_count_match", htmlCount: htmlCardCount, mdCount: mdCardCount };
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
      level: "L1",
      id: "table_count_match",
      message: `Table count mismatch: MD has ${mdTableCount} (excl. cards), HTML has ${htmlTableCount}`,
      mdCount: mdTableCount,
      htmlCount: htmlTableCount,
    };
  }
  return { passed: true, level: "L1", id: "table_count_match", htmlCount: htmlTableCount, mdCount: mdTableCount };
}

function checkImageCdnCount(html, mdPath, rules) {
  const imgCount = (html.match(/<img/g) || []).length;
  const cdnCount = (html.match(/mmbiz\.qpic\.cn/g) || []).length;

  // 本地 preflight 阶段：检查本地路径残留
  const localPatternCount = (html.match(/src=["']\//g) || []).length;
  if (localPatternCount > 0) {
    return {
      passed: false,
      level: "L1",
      id: "image_cdn_count_match",
      message: `Found ${localPatternCount} image(s) with local/absolute paths. All images should be filenames (for upload) or CDN URLs.`,
      imgCount,
      cdnCount,
      localCount: localPatternCount,
    };
  }

  // 比较 MD 中声明的图片数和 HTML 中渲染的 img 数
  let mdImgCount = 0;
  if (mdPath && fs.existsSync(mdPath)) {
    const md = fs.readFileSync(mdPath, "utf8");
    // 匹配 Markdown 图片语法 ![alt](url)
    mdImgCount = (md.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length;
  }

  // HTML 中的 img 数应 ≥ MD 中声明的图片数（因为 footer qr 可能额外添加）
  if (mdPath && mdImgCount > 0 && imgCount < mdImgCount) {
    return {
      passed: false,
      level: "L1",
      id: "image_cdn_count_match",
      message: `Image count mismatch: MD declares ${mdImgCount} image(s), HTML only has ${imgCount} <img> tag(s). Some images may not have rendered.`,
      imgCount,
      mdImgCount,
      cdnCount,
      localCount: localPatternCount,
    };
  }

  return { passed: true, level: "L1", id: "image_cdn_count_match", imgCount, cdnCount, mdImgCount };
}

function checkNarrativePerspective(html, mdPath, rules) {
  // 在 MD 中检测 AI 视角的表述（HTML 中可能已丢失原始文本）
  let md = "";
  if (mdPath && fs.existsSync(mdPath)) {
    md = fs.readFileSync(mdPath, "utf8");
  }
  // 也可以在 HTML 中检测（如果 MD 不存在）
  const text = md || html;

  // AI 视角信号词：明确把"用户"作为对话另一方的表述
  const aiPerspectivePatterns = [
    /用户问我/,
    /用户问/,
    /用户说/,
    /用户表示/,
    /用户让我/,
    /用户要求我/,
    /用户给了/,
    /用户提交/,
  ];

  const matches = [];
  for (const pattern of aiPerspectivePatterns) {
    const found = text.match(pattern);
    if (found) {
      // 提取匹配位置前后各 20 字作为上下文
      const idx = text.indexOf(found[0]);
      const ctx = text.slice(Math.max(0, idx - 20), idx + found[0].length + 20).replace(/\n/g, " ");
      matches.push({ pattern: found[0], context: ctx });
    }
  }

  if (matches.length > 0) {
    return {
      passed: false,
      level: "L1",
      id: "narrative_perspective",
      message: `Detected ${matches.length} AI-perspective phrase(s) in article. Ensure all "我" refer to the same subject (the author).`,
      details: { matches },
    };
  }

  return { passed: true, level: "L1", id: "narrative_perspective" };
}

function checkCoverPlaceholder(coverPath, rules) {
  const hasCover = coverPath && fs.existsSync(coverPath);
  if (!hasCover) {
    return { passed: true, level: "L1", id: "cover_placeholder_text", skipped: true, reason: "No cover provided" };
  }

  // 使用 tesseract OCR 检测封面图中的文字
  let ocrText = "";
  try {
    ocrText = execFileSync("tesseract", [coverPath, "stdout", "-l", "chi_sim+eng"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15000,
    });
  } catch (e) {
    // OCR 失败时不阻塞，降级为警告
    return {
      passed: true,
      level: "L2",
      id: "cover_placeholder_text",
      skipped: true,
      reason: `OCR failed: ${e.message}`,
    };
  }

  // 占位符关键词库（支持扩展）
  const placeholderPatterns = [
    /【[^】]*标题[^】]*】/,
    /【[^】]*放置[^】]*】/,
    /【[^】]*占位[^】]*】/,
    /placeholder/i,
    /sample/i,
    /template/i,
    /示例/i,
    /样例/i,
    /测试/i,
  ];

  const matches = [];
  for (const pattern of placeholderPatterns) {
    const m = ocrText.match(pattern);
    if (m) matches.push(m[0]);
  }

  if (matches.length > 0) {
    return {
      passed: false,
      level: "L1",
      id: "cover_placeholder_text",
      message: `Detected placeholder text in cover image: "${matches.join(", ")}". Please remove or regenerate the cover.`,
      details: { matches, ocrLength: ocrText.length },
    };
  }

  return { passed: true, level: "L1", id: "cover_placeholder_text", ocrLength: ocrText.length };
}

// ── 主检查流程 ──

export async function runPreflight(opts) {
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
    checkCtaIntegrity(html, rules.l1_mandatory_checks?.cta_integrity || {}),
    checkCardCount(html, mdPath, rules.l1_mandatory_checks?.card_count_match || {}),
    checkTableCount(html, mdPath, rules.l1_mandatory_checks?.table_count_match || {}),
    checkImageCdnCount(html, mdPath, rules.l1_mandatory_checks?.image_cdn_count_match || {}),
    checkNarrativePerspective(html, mdPath, rules.l1_mandatory_checks?.narrative_perspective || {}),
    checkCoverPlaceholder(coverPath, rules.l1_mandatory_checks?.cover_placeholder_text || {}),
  ];

  // ── 动态加载生成的检查（代码驱动自创生）──
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const checksDir = path.join(scriptDir, "preflight-checks");
  if (fs.existsSync(checksDir)) {
    const checkFiles = fs.readdirSync(checksDir).filter((f) => f.endsWith(".mjs"));
    for (const file of checkFiles) {
      const ruleId = file.replace(".mjs", "");
      // 跳过已在内置检查中注册的（避免重复）
      if (rules.l1_mandatory_checks && rules.l1_mandatory_checks[ruleId]) {
        try {
          const mod = await import(path.join(checksDir, file));
          const fnName = `check_${ruleId}`;
          if (mod[fnName]) {
            const result = mod[fnName]({ html, mdPath, htmlDir, coverPath, title, author, digest });
            l1Checks.push(result);
          }
        } catch (e) {
          console.error(`⚠️  Failed to load generated check ${file}: ${e.message}`);
        }
      }
    }
  }

  const l2Checks = [
    checkContentChars(html, rules.l2_warning_checks?.content_chars || {}),
    checkContentBytes(html, rules.l2_warning_checks?.content_bytes || {}),
    checkCoverAspectRatio(coverPath, rules.l2_warning_checks?.cover_aspect_ratio || {}),
    checkSummaryQuality(html, rules.l2_warning_checks?.summary_quality || {}),
  ];

  // ── 子代理检查：source_verification（需要语义理解，调用外部 agent）──
  const agentChecks = [];
  const sourceVerifyRule = rules.l1_mandatory_checks?.source_verification;
  if (sourceVerifyRule && mdPath && fs.existsSync(mdPath)) {
    agentChecks.push(runAgentCheck("source-verification", { html, mdPath, htmlDir, rules: sourceVerifyRule }));
  }

  // ── 活记忆附加：运行时摩擦点风险提示 ──
  const memory = loadLivingMemory();
  const memoryItems = formatL3MemoryItems(memory);
  const l1Failures = l1Checks.filter((c) => !c.passed);
  const l2Warnings = l2Checks.filter((c) => !c.passed);
  const agentFailures = agentChecks.filter((c) => c && !c.passed);

  const ok = l1Failures.length === 0 && agentFailures.length === 0;

  return {
    ok,
    timestamp: new Date().toISOString(),
    htmlPath,
    mdPath,
    l1: { total: l1Checks.length, passed: l1Checks.length - l1Failures.length, failures: l1Failures },
    l2: { total: l2Checks.length, passed: l2Checks.length - l2Warnings.length, warnings: l2Warnings },
    agent: { total: agentChecks.length, passed: agentChecks.length - agentFailures.length, failures: agentFailures },
    memory: { loaded: memory.loaded, count: memory.total_friction_points, items: memoryItems },
    autopoiesis: rules.autopoiesis || {},
  };
}

// ── 子代理检查执行 ──
function runAgentCheck(agentId, context) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const agentPath = path.join(scriptDir, "agents", `${agentId}.mjs`);

  if (!fs.existsSync(agentPath)) {
    return {
      passed: true,
      level: "L2",
      id: agentId,
      skipped: true,
      reason: `Agent script not found: ${agentPath}`,
    };
  }

  try {
    // 通过临时 JSON 文件传递上下文（避免命令行长度限制）
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "md2wechat-agent-"));
    const ctxPath = path.join(tmpDir, "context.json");
    fs.writeFileSync(ctxPath, JSON.stringify(context, null, 2));

    const out = execFileSync(process.execPath, [agentPath, ctxPath], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
    });

    // 清理临时文件
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}

    const result = JSON.parse(out.trim().split("\n").pop());
    return { ...result, level: "L1", id: agentId };
  } catch (e) {
    return {
      passed: false,
      level: "L1",
      id: agentId,
      message: `Agent check failed: ${e.message}`,
      details: { agentId, error: e.message },
    };
  }
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
    if (c.digest) lines.push(`     digest: "${c.digest}"`);
    if (c.matches) lines.push(`     matches: ${c.matches.join(", ")}`);
    if (c.details) {
      if (c.details.matches) {
        for (const m of c.details.matches.slice(0, 3)) {
          lines.push(`     → "${m.context || m}"`);
        }
      }
      if (c.details.oversized) {
        for (const d of c.details.oversized?.slice(0, 3) || []) {
          lines.push(`     ${d.path}${d.exists ? ` (${(d.size / 1024 / 1024).toFixed(2)}MB > limit)` : " [NOT FOUND]"}`);
        }
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

  // Agent
  if (report.agent && report.agent.total > 0) {
    lines.push(`【Agent 子代理】${report.agent.passed}/${report.agent.total}`);
    for (const c of report.agent.failures) {
      lines.push(`  🤖 ${c.id}: ${c.message}`);
    }
    if (report.agent.failures.length === 0) lines.push("  ✅ 全部通过");
  }

  // Memory
  if (report.memory && report.memory.items && report.memory.items.length > 0) {
    lines.push(`【活记忆风险提示】${report.memory.items.length} 条`);
    for (const c of report.memory.items.slice(0, 3)) {
      lines.push(`  🧠 ${c.id}: ${c.message}`);
    }
  }

  lines.push("");
  lines.push(report.ok ? "✅ Preflight 通过，可以上传推送。" : "❌ Preflight 未通过，请修复 L1 问题后重试。");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  return lines.join("\n");
}

// ── CLI 入口 ──
async function main() {
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

  const report = await runPreflight({
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
  main().then((code) => {
    process.exitCode = code ?? 0;
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

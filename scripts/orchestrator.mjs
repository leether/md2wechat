import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PIPELINE_HOME = path.resolve(__dirname, "..");
const NODE = process.execPath;

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
  console.log(`Usage: node scripts/orchestrator.mjs --input <article.md> --account <ACCOUNT> [options]

Required:
  --input <path>           Source Markdown article
  --account <name>         WeChat account key (e.g. XINZHE)

Optional:
  --title <text>           Article title (overrides H1 in MD)
  --author <text>          Article author (default: from .env or \"新褶\")
  --env <path>             .env file path (default: ./.env)
  --out-dir <dir>          Bundle output directory (default: /tmp/wechat-<slug>)
  --thumb-image <path>     Cover image path (for WeChat draft)
  --qr <path>              QR code image path
  --dry-run                Run full pipeline but skip WeChat API push
  --auto-fix               Automatically fix L1 preflight failures
  --open-comment <0|1>     Enable/disable comments (default: 1)
  --crop-235-1 <spec>      Cover crop spec (e.g. 0_0.0035_1_0.9965)
  --help                   Show this help

Pipeline:
  Step 1: render_wechat_editorial.mjs  →  HTML + lint report
  Step 2: preflight (auto-invoked by renderer)  →  L1/L2/L3 checks
  Step 3: auto-fix (if --auto-fix)  →  digest truncation / image compression
  Step 4: bundle_wechat_article.mjs  →  clean bundle with path replacement
  Step 5: create_wechat_draft.mjs (relay)  →  push to WeChat draft

Structured log: .md2wechat-pipeline.jsonl (in working dir)
`);
}

// ── 彩色输出 ──
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(label, msg) {
  console.log(`${C.dim}[${label}]${C.reset} ${msg}`);
}
function ok(msg) { console.log(`${C.green}✅${C.reset} ${msg}`); }
function warn(msg) { console.log(`${C.yellow}⚠️ ${C.reset} ${msg}`); }
function err(msg) { console.log(`${C.red}❌${C.reset} ${msg}`); }
function info(msg) { console.log(`${C.blue}ℹ️ ${C.reset} ${msg}`); }
function step(n, title) {
  console.log(`\n${C.bold}${C.cyan}━━━ Step ${n}: ${title} ━━━${C.reset}`);
}

// ── 从 .env 文件读取指定变量 ──
function readEnvVar(envPath, key) {
  try {
    const content = fs.readFileSync(envPath, "utf8");
    const match = content.match(new RegExp(`^${key}=(.+)$`, "m"));
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

// ── JSONL 日志 ──
class PipelineLogger {
  constructor(logPath) {
    this.logPath = logPath;
    this.entries = [];
  }

  record(step, status, meta = {}) {
    const entry = {
      t: new Date().toISOString(),
      step,
      status,
      ...meta,
    };
    this.entries.push(entry);
    fs.appendFileSync(this.logPath, JSON.stringify(entry) + "\n");
    return entry;
  }

  summarize() {
    const total = this.entries.length;
    const failures = this.entries.filter((e) => e.status === "failed").length;
    const fixes = this.entries.filter((e) => e.fix_applied).length;
    return { total, failures, fixes, entries: this.entries };
  }
}

// ── 运行子进程并记录 ──
function run(script, args, logger, stepName) {
  const start = Date.now();
  log(stepName, `> node ${path.basename(script)} ${args.join(" ")}`);

  const result = spawnSync(NODE, [script, ...args], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    cwd: PIPELINE_HOME,
  });

  const duration = Date.now() - start;
  const stdout = result.stdout?.trim() || "";
  const stderr = result.stderr?.trim() || "";
  const exitCode = result.status;

  // 打印输出（控制长度）
  const outLines = stdout.split("\n").filter((l) => l.trim());
  const errLines = stderr.split("\n").filter((l) => l.trim());
  for (const line of outLines.slice(0, 20)) {
    console.log(`  ${C.dim}${line.slice(0, 200)}${C.reset}`);
  }
  if (outLines.length > 20) {
    console.log(`  ${C.dim}... (${outLines.length - 20} more lines)${C.reset}`);
  }
  for (const line of errLines.slice(0, 5)) {
    console.log(`  ${C.red}${line.slice(0, 200)}${C.reset}`);
  }

  const status = exitCode === 0 ? "success" : "failed";
  logger.record(stepName, status, {
    script: path.basename(script),
    args,
    exit_code: exitCode,
    duration_ms: duration,
    stdout_preview: stdout.slice(0, 500),
    stderr_preview: stderr.slice(0, 500),
  });

  return { exitCode, stdout, stderr, duration };
}

// ── AutoHeal: 自动修复 L1 问题 ──
class AutoHeal {
  constructor(mdPath, logger) {
    this.mdPath = mdPath;
    this.logger = logger;
    this.fixesApplied = [];
  }

  apply(preflightReport, htmlPath) {
    const failures = preflightReport?.l1?.failures || [];
    let needsReRender = false;

    for (const f of failures) {
      switch (f.id) {
        case "digest_length": {
          const fixed = this.fixDigest();
          if (fixed) {
            this.fixesApplied.push("digest_truncated");
            needsReRender = true;
          }
          break;
        }
        case "image_size": {
          const paths = f.details?.paths || this.extractImagePathsFromReport(f, htmlPath);
          const fixed = this.fixOversizedImages(paths);
          if (fixed) {
            this.fixesApplied.push("images_compressed");
            needsReRender = true;
          }
          break;
        }
        case "local_path_absence": {
          // 本地路径在渲染阶段是正常的（bundle 会替换为文件名）
          // 如果所有路径指向的文件都存在，则跳过
          const paths = f.details?.paths || [];
          const allExist = paths.every((p) => fs.existsSync(p));
          if (allExist) {
            info(`AutoHeal: local_path_absence skipped — ${paths.length} image(s) exist, bundle will handle path replacement`);
          } else {
            warn(`AutoHeal: some local paths do not exist: ${paths.filter((p) => !fs.existsSync(p)).join(", ")}`);
          }
          break;
        }
        case "title_length": {
          warn(`AutoHeal skipped: title_length requires human judgment`);
          break;
        }
        default:
          warn(`AutoHeal: no automatic fix for ${f.id}`);
      }
    }

    if (this.fixesApplied.length > 0) {
      this.logger.record("autofix", "applied", { fixes: this.fixesApplied });
    }

    return { fixed: this.fixesApplied.length > 0, needsReRender };
  }

  extractImagePathsFromReport(failure, htmlPath) {
    if (!htmlPath || !fs.existsSync(htmlPath)) return [];
    const html = fs.readFileSync(htmlPath, "utf8");
    const paths = [];
    const regex = /src=["'](\/[^"']+)["']/g;
    let m;
    while ((m = regex.exec(html)) !== null) {
      if (fs.existsSync(m[1])) paths.push(m[1]);
    }
    return paths;
  }

  fixDigest() {
    if (!fs.existsSync(this.mdPath)) return false;
    let md = fs.readFileSync(this.mdPath, "utf8");
    const match = md.match(/^summary:\s*(.+)$/m);
    if (!match) return false;

    const oldSummary = match[1].trim();
    // 截断到 120 字符（保留安全边际）
    if (oldSummary.length <= 120) return false;

    const newSummary = oldSummary.slice(0, 117) + "...";
    md = md.replace(/^summary:\s*(.+)$/m, `summary: ${newSummary}`);
    fs.writeFileSync(this.mdPath, md, "utf8");

    ok(`AutoHeal: truncated summary from ${oldSummary.length} to ${newSummary.length} chars`);
    return true;
  }

  fixOversizedImages(paths) {
    let fixedAny = false;
    for (const imgPath of paths) {
      if (!fs.existsSync(imgPath)) continue;
      const stat = fs.statSync(imgPath);
      const mb = stat.size / (1024 * 1024);
      if (mb > 2.0) {
        // 计算目标尺寸：线性压缩到 2MB 以下
        const targetDim = Math.floor(Math.sqrt((2.0 * 1024 * 1024) / stat.size) * 2000);
        const dim = Math.min(targetDim, 2000);
        try {
          spawnSync("sips", ["-Z", String(dim), imgPath, "--out", imgPath], {
            encoding: "utf8",
            stdio: "pipe",
          });
          const newStat = fs.statSync(imgPath);
          ok(`AutoHeal: compressed ${path.basename(imgPath)} ${mb.toFixed(2)}MB → ${(newStat.size / (1024 * 1024)).toFixed(2)}MB`);
          fixedAny = true;
        } catch (e) {
          err(`AutoHeal failed to compress ${imgPath}: ${e.message}`);
        }
      }
    }
    return fixedAny;
  }
}

// ── Step 0: Pre-Render Lint（出口条件自动化）──
function preRenderLint(mdPath, titleArg) {
  if (!fs.existsSync(mdPath)) return { ok: true, issues: [] };

  const md = fs.readFileSync(mdPath, "utf8");
  const issues = [];

  // 1. 破折号检查
  const emDashCount = (md.match(/——/g) || []).length;
  if (emDashCount > 0) {
    issues.push({ level: "L2", id: "pre_emdash", message: `Found ${emDashCount} em dash(es) (——). Replace with comma or delete before rendering.` });
  }

  // 2. 中文双引号检查
  const cnQuoteCount = (md.match(/"[^"]*"/g) || []).length;
  if (cnQuoteCount > 0) {
    issues.push({ level: "L2", id: "pre_cn_quotes", message: `Found ${cnQuoteCount} Chinese quote pair(s) (""). Replace with 「」or delete.` });
  }

  // 3. 标题字数检查（优先用 --title 参数，否则取 H1）
  let title = titleArg || "";
  if (!title) {
    const h1Match = md.match(/^#\s+(.+)$/m);
    if (h1Match) title = h1Match[1].trim();
  }
  const titleChars = title.replace(/[^\u4e00-\u9fa5]/g, "").length;
  if (titleChars > 21) {
    issues.push({ level: "L2", id: "pre_title_length", message: `Title has ${titleChars} Chinese chars (>21). Use --title to override with a shorter one.` });
  }

  // 4. summary 字数检查
  const summaryMatch = md.match(/^summary:\s*(.+)$/m);
  if (summaryMatch) {
    const summary = summaryMatch[1].trim();
    if (summary.length > 120) {
      issues.push({ level: "L2", id: "pre_summary_length", message: `summary is ${summary.length} chars (>120). Truncate before rendering.` });
    }
  } else {
    issues.push({ level: "L2", id: "pre_summary_missing", message: "Missing summary: in MD first line. digest will fallback to first 54 chars of body." });
  }

  // 5. 插图检查：正文 > 800 字时至少 1 张图
  const bodyText = md
    .replace(/^summary:.*/gm, "")
    .replace(/^```[\s\S]*?```/gm, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/:::\s*wechat-image[\s\S]*?:::/g, "")
    .replace(/[#*|`>/\-\[\]\(\)]/g, "")
    .replace(/\s+/g, "");
  const bodyChars = bodyText.length;
  const imgCount = (md.match(/!\[.*?\]\(.*?\)/g) || []).length + (md.match(/:::\s*wechat-image/g) || []).length;
  if (bodyChars > 800 && imgCount === 0) {
    issues.push({ level: "L2", id: "pre_image_missing", message: `Body is ~${bodyChars} chars (>800) but no images found. Add at least 1 illustration.` });
  }

  return { ok: issues.length === 0, issues };
}
function parsePreflightReport(stdout) {
  try {
    // 尝试从 stdout 的最后几行找 JSON
    const lines = stdout.split("\n").filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        continue;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

// ── 主流程 ──
function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || (!args.input && !args._[0])) {
    printHelp();
    return 0;
  }

  const inputPath = path.resolve(args.input || args._[0]);
  const account = args.account;
  const title = args.title;
  const author = args.author || "新褶";
  const envPath = path.resolve(args.env || path.join(PIPELINE_HOME, ".env"));
  const dryRun = args["dry-run"] || false;
  const autoFix = args["auto-fix"] || false;
  const thumbImage = args["thumb-image"] ? path.resolve(args["thumb-image"]) : null;
  const qrPath = args.qr ? path.resolve(args.qr) : null;
  const openComment = args["open-comment"] !== undefined ? args["open-comment"] : "1";
  const cropSpec = args["crop-235-1"];
  const autoPush = args["auto-push"] || false;

  if (!fs.existsSync(inputPath)) {
    err(`Input file not found: ${inputPath}`);
    return 1;
  }
  if (!account) {
    err("--account is required");
    return 1;
  }

  // 工作目录和日志
  const workDir = path.dirname(inputPath);
  const slug = path.basename(inputPath, ".md").replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "-").slice(0, 30);
  const outDir = args["out-dir"] || path.join("/tmp", `wechat-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${slug}`);
  const logPath = path.join(workDir, ".md2wechat-pipeline.jsonl");
  // 清空旧日志，避免累积
  if (fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, "", "utf8");
  }
  const logger = new PipelineLogger(logPath);

  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║     md2wechat Autopoietic Orchestrator v3.0                ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`${C.dim}Input:  ${inputPath}${C.reset}`);
  console.log(`${C.dim}Account: ${account}${C.reset}`);
  console.log(`${C.dim}Author:  ${author}${C.reset}`);
  console.log(`${C.dim}Dry-run: ${dryRun}${C.reset}`);
  console.log(`${C.dim}Auto-fix: ${autoFix}${C.reset}`);
  console.log(`${C.dim}Log:     ${logPath}${C.reset}`);

  const renderOut = path.join(workDir, `${slug}.html`);
  const lintOut = path.join(workDir, `${slug}-lint.json`);

  // ═══════════════════════════════════════════════════════════════
  // Step 0: Pre-Render Lint（SKILL.md 出口条件自动化）
  // ═══════════════════════════════════════════════════════════════
  step(0, "Pre-Render Lint");
  const preLint = preRenderLint(inputPath, title);
  if (preLint.issues.length > 0) {
    for (const issue of preLint.issues) {
      warn(`[${issue.id}] ${issue.message}`);
    }
    logger.record("pre_render_lint", "warning", { issues: preLint.issues });
  } else {
    ok("Pre-render lint passed");
    logger.record("pre_render_lint", "success");
  }

  // ═══════════════════════════════════════════════════════════════
  // Step 1: Render
  // ═══════════════════════════════════════════════════════════════
  step(1, "Render WeChat HTML");
  const renderArgs = [
    "--input", inputPath,
    "--output", renderOut,
    "--env", envPath,
    "--lint-report-out", lintOut,
  ];
  if (title) renderArgs.push("--title", title);

  const renderResult = run(
    path.join(PIPELINE_HOME, "scripts", "render_wechat_editorial.mjs"),
    renderArgs,
    logger,
    "render",
  );

  if (renderResult.exitCode === 3) {
    // Preflight blocked — 显式调用 preflight --json 获取机器可读报告
    err("Renderer exited with code 3 (preflight blocked)");
    info("Fetching structured preflight report for AutoHeal...");

    const preflightJsonResult = run(
      path.join(PIPELINE_HOME, "harness", "preflight.mjs"),
      ["--html", renderOut, "--md", inputPath, "--json"],
      logger,
      "preflight_json",
    );

    const report = parsePreflightReport(preflightJsonResult.stdout);

    if (autoFix && report) {
      info("Attempting AutoHeal...");
      const healer = new AutoHeal(inputPath, logger);
      const { fixed, needsReRender } = healer.apply(report, renderOut);

      if (fixed && needsReRender) {
        info("Re-running render after AutoHeal...");
        const retry = run(
          path.join(PIPELINE_HOME, "scripts", "render_wechat_editorial.mjs"),
          renderArgs,
          logger,
          "render_retry",
        );
        if (retry.exitCode !== 0) {
          err("Render failed again after AutoHeal. Manual intervention required.");
          return 3;
        }
        ok("Render succeeded after AutoHeal");
      } else if (!fixed && report?.l1?.failures?.some((f) => f.id !== "local_path_absence")) {
        err("AutoHeal could not fix all L1 issues. Manual intervention required.");
        return 3;
      } else {
        // 只有 local_path_absence 且都被跳过，继续到 bundle 阶段
        ok("AutoHeal: only local_path_absence (will be handled by bundle), continuing...");
        logger.record("render", "healed", { reason: "local_path_absence_skipped_for_bundle" });
      }
    } else {
      err("Preflight blocked. Use --auto-fix to attempt automatic repair, or fix manually.");
      return 3;
    }
  } else if (renderResult.exitCode !== 0) {
    err(`Render failed with exit code ${renderResult.exitCode}`);
    return 2;
  }

  ok(`HTML rendered: ${renderOut}`);
  ok(`Lint report: ${lintOut}`);

  // ═══════════════════════════════════════════════════════════════
  // Step 2: Bundle
  // ═══════════════════════════════════════════════════════════════
  step(2, "Bundle Article");
  const bundleArgs = [
    "--html", renderOut,
    "--out", outDir,
    "--lint", lintOut,
  ];
  if (qrPath) bundleArgs.push("--qr", qrPath);
  if (fs.existsSync(envPath)) bundleArgs.push("--env", envPath);

  const bundleResult = run(
    path.join(PIPELINE_HOME, "scripts", "bundle_wechat_article.mjs"),
    bundleArgs,
    logger,
    "bundle",
  );

  if (bundleResult.exitCode !== 0) {
    err(`Bundle failed with exit code ${bundleResult.exitCode}`);
    return 4;
  }

  ok(`Bundle ready: ${outDir}`);

  // 读取 bundle manifest
  const manifestPath = path.join(outDir, "manifest.json");
  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    info(`Bundle contains ${manifest.images?.length || 0} images`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Step 3: Push (or dry-run)
  // ═══════════════════════════════════════════════════════════════
  step(3, dryRun ? "Push (DRY RUN)" : "Push to WeChat Draft");

  if (dryRun) {
    warn("Dry run mode — skipping WeChat API push");
    logger.record("push", "skipped", { reason: "dry_run" });
  } else {
    // ⚠️ f035: 提醒检查封面图占位文字
    if (thumbImage) {
      warn("COVER CHECK: Please visually inspect the cover image for placeholder/template text:");
      console.log(`${C.yellow}  ${thumbImage}${C.reset}`);
      console.log(`${C.dim}  If you see placeholder text (e.g. \"【中文标题放置区】\"), fix it before pushing.${C.reset}\n`);
    }

    const relayHost = readEnvVar(envPath, "WECHAT_RELAY_HOST") || "relay";
    const relayRoot = readEnvVar(envPath, "WECHAT_RELAY_PUBLISH_ROOT") || `/home/admin/wechat-publish`;
    let remoteDir = `${relayRoot}/${account}/$(date +%Y%m%d)_${slug}/v1`;

    if (autoPush) {
      step(3, "Push to WeChat Draft (AUTO)");
      info(`Relay host: ${relayHost}`);

      // 查询已有版本号并递增
      info("Checking existing versions on relay...");
      const verResult = spawnSync("ssh", [relayHost, `ls -d ${relayRoot}/${account}/$(date +%Y%m%d)_${slug}/v* 2>/dev/null | wc -l | tr -d ' '`], { encoding: "utf8", stdio: "pipe" });
      const existingVers = parseInt(verResult.stdout?.trim() || "0", 10) || 0;
      const nextVer = existingVers + 1;
      remoteDir = `${relayRoot}/${account}/$(date +%Y%m%d)_${slug}/v${nextVer}`;
      info(`Next version: v${nextVer} (${existingVers} existing)`);

      info(`Remote dir: ${remoteDir}`);

      info("Creating remote directory...");
      const mkdirResult = spawnSync("ssh", [relayHost, `mkdir -p ${remoteDir}`], { encoding: "utf8", stdio: "pipe" });
      if (mkdirResult.status !== 0) {
        err(`SSH mkdir failed: ${mkdirResult.stderr || mkdirResult.stdout}`);
        logger.record("push", "failed", { reason: "ssh_mkdir_failed", stderr: mkdirResult.stderr });
        return 6;
      }

      info("Uploading bundle files...");
      const scpResult = spawnSync("scp", [`${outDir}/*`, `${relayHost}:${remoteDir}/`], { encoding: "utf8", stdio: "pipe", shell: true });
      if (scpResult.status !== 0) {
        err(`SCP upload failed: ${scpResult.stderr || scpResult.stdout}`);
        logger.record("push", "failed", { reason: "scp_failed", stderr: scpResult.stderr });
        return 6;
      }

      const envInBundle = fs.existsSync(path.join(outDir, ".env"));
      if (envInBundle) {
        info("Uploading .env separately...");
        const scpEnvResult = spawnSync("scp", [path.join(outDir, ".env"), `${relayHost}:${remoteDir}/.env`], { encoding: "utf8", stdio: "pipe" });
        if (scpEnvResult.status !== 0) {
          err(`SCP .env failed: ${scpEnvResult.stderr || scpEnvResult.stdout}`);
          logger.record("push", "failed", { reason: "scp_env_failed", stderr: scpEnvResult.stderr });
          return 6;
        }
      }

      info("Executing create_wechat_draft.mjs on relay...");
      const remoteCmd = [
        relayHost,
        `cd ${remoteDir} && node ${relayRoot}/${account}/shared/scripts/create_wechat_draft.mjs --html ${path.basename(renderOut)} ${thumbImage ? `--thumb-image ${path.basename(thumbImage)}` : ""} --lint-report ${path.basename(lintOut)} --title '\${title || slug}' --author '\${author}' --account ${account} --open-comment ${openComment}`,
      ];
      const pushResult = spawnSync("ssh", remoteCmd, { encoding: "utf8", stdio: "pipe", maxBuffer: 1024 * 1024 });

      const pushStdout = pushResult.stdout || "";
      const pushStderr = pushResult.stderr || "";
      for (const line of pushStdout.split("\n").filter((l) => l.trim())) {
        console.log(`  ${C.dim}${line.slice(0, 200)}${C.reset}`);
      }
      if (pushStderr) {
        for (const line of pushStderr.split("\n").filter((l) => l.trim())) {
          console.log(`  ${C.red}${line.slice(0, 200)}${C.reset}`);
        }
      }

      let pushJson = null;
      try {
        const jsonLines = pushStdout.split("\n").filter((l) => l.trim().startsWith("{") || l.trim().startsWith("["));
        for (const jl of jsonLines.reverse()) {
          try { pushJson = JSON.parse(jl); break; } catch {}
        }
      } catch {}

      if (pushResult.status !== 0 || !pushJson || pushJson.errcode !== 0) {
        err(`Remote push failed (exit ${pushResult.status}). Check relay logs.`);
        logger.record("push", "failed", { reason: "remote_push_failed", stdout_preview: pushStdout.slice(0, 500), stderr_preview: pushStderr.slice(0, 500) });
        return 6;
      }

      ok(`Push succeeded. media_id: ${pushJson.media_id || "(unknown)"}`);
      logger.record("push", "success", { media_id: pushJson.media_id, thumb_media_id: pushJson.thumb_media_id });

    } else {
      step(3, "Push to WeChat Draft (MANUAL)");
      const pushCmd = `ssh ${relayHost} "mkdir -p ${remoteDir}" && \scp ${outDir}/* ${relayHost}:${remoteDir}/ && \ssh ${relayHost} "cd ${remoteDir} && \  node ${relayRoot}/${account}/shared/scripts/create_wechat_draft.mjs \  --html ${path.basename(renderOut)} \  ${thumbImage ? `--thumb-image ${path.basename(thumbImage)}` : ""} \  --lint-report ${path.basename(lintOut)} \  --title '\${title || slug}' \  --author '\${author}' \  --account ${account} \  --open-comment ${openComment}"`;

      info("Push command (copy to terminal):");
      const envInBundle = fs.existsSync(path.join(outDir, ".env"));
      if (envInBundle) {
        warn("IMPORTANT: scp * does NOT copy hidden files. You must separately scp .env:");
        console.log(`${C.yellow}  scp ${outDir}/.env ${relayHost}:${remoteDir}/.env${C.reset}\n`);
      }
      console.log(`\n${C.cyan}${pushCmd}${C.reset}\n`);
      logger.record("push", "command_generated", { command: pushCmd, envReminder: envInBundle });
      ok("Push command generated. Execute manually or add --auto-push to execute automatically.");
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Step 4: Auto self-report
  // ═══════════════════════════════════════════════════════════════
  step(4, "Auto Self-Report");
  const summary = logger.summarize();
  info(`Pipeline completed: ${summary.total} steps, ${summary.failures} failures, ${summary.fixes} auto-fixes`);

  // 尝试自动运行 self_report 分析日志
  const selfReportScript = path.join(PIPELINE_HOME, "harness", "self_report.mjs");
  if (fs.existsSync(selfReportScript)) {
    const srResult = run(
      selfReportScript,
      ["--analyze-log", logPath, "--write-lessons"],
      logger,
      "self_report",
    );
    if (srResult.exitCode === 0) {
      ok("Self-report analyzed and lessons updated");
    } else {
      warn("Self-report analysis skipped or failed");
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Final Report
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}${C.cyan}━━━ Pipeline Summary ━━━${C.reset}`);

  // 判断最终状态：关键步骤（render/render_retry/render_healed + bundle）是否最终成功
  const hasSuccessfulRender = logger.entries.some(
    (e) => (e.step === "render" || e.step === "render_retry") && (e.status === "success" || e.status === "healed")
  );
  const hasSuccessfulBundle = logger.entries.some(
    (e) => e.step === "bundle" && e.status === "success"
  );
  const overallSuccess = hasSuccessfulRender && hasSuccessfulBundle;

  console.log(`  Input:     ${inputPath}`);
  console.log(`  HTML:      ${renderOut}`);
  console.log(`  Bundle:    ${outDir}`);
  console.log(`  Log:       ${logPath}`);
  console.log(`  Steps:     ${summary.total}`);
  console.log(`  Failures:  ${summary.failures}`);
  console.log(`  Auto-fixes: ${summary.fixes}`);
  console.log(`  Status:    ${overallSuccess ? C.green + "SUCCESS" + C.reset : C.red + "FAILED" + C.reset}`);

  // ═══════════════════════════════════════════════════════════════
  // Step 5: Audit Log Verification (harness — 不得跳过)
  // ═══════════════════════════════════════════════════════════════
  if (overallSuccess) {
    console.log(`\n${C.bold}${C.cyan}━━━ Step 5: Audit Log Verification ━━━${C.reset}`);
    console.log(`${C.dim}After pushing, the WeChat draft API returns an Audit Log. Verify each item:${C.reset}`);
    console.log(`
  [回检清单] — 拿到 Audit Log 后逐项核对：
    img标签数      ≥ 1（封面+插图+二维码）
    CDN图片数      = img标签数（全部上传微信 CDN）
    h2标题数       > 0
    卡片数         = MD 中 :::wechat-card 数量
    引用块数       = MD 中 > 数量
    style属性数    > 50
    position       = 0
    filter         = 0
    【渲染质检】   必须存在（含 --lint-report）
`);
    console.log(`${C.yellow}⚠️  IMPORTANT: Before reporting "done", call Skill('skill-compliance-harness') in WorkBuddy to run the full compliance check.${C.reset}`);
    console.log(`${C.dim}   errcode: 0 ≠ 完成。必须逐项核对上方清单。${C.reset}`);
  }

  return overallSuccess ? 0 : 5;
}

// CLI 入口判断（兼容符号链接）
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

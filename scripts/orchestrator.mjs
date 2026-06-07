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

// ── 解析 preflight JSON 输出 ──
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
    // 这里需要 relay 推送。orchestrator 可以输出推送命令供用户复制执行
    // 未来可以集成 create_wechat_draft.mjs 直接推送
    const pushCmd = `ssh relay "mkdir -p /home/admin/wechat-publish/${account}/$(date +%Y%m%d)_${slug}/v1" && \\
scp ${outDir}/* relay:/home/admin/wechat-publish/${account}/$(date +%Y%m%d)_${slug}/v1/ && \\
ssh relay "cd /home/admin/wechat-publish/${account}/$(date +%Y%m%d)_${slug}/v1 && \\
  node /home/admin/wechat-publish/${account}/shared/scripts/create_wechat_draft.mjs \\
  --html ${path.basename(renderOut)} \\
  ${thumbImage ? `--thumb-image ${path.basename(thumbImage)}` : ""} \\
  --lint-report ${path.basename(lintOut)} \\
  --title '${title || slug}' \\
  --author '${author}' \\
  --account ${account} \\
  --open-comment ${openComment}"`;

    info("Push command (copy to terminal):");
    console.log(`\n${C.cyan}${pushCmd}${C.reset}\n`);
    logger.record("push", "command_generated", { command: pushCmd });

    // 如果配置了本地推送（未来扩展）
    ok("Push command generated. Execute manually or configure relay auto-push.");
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

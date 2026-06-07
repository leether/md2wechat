import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── FrictionPoint 数据类 ──
class FrictionPoint {
  constructor({ id, category, description, resolution = "", rule_id = null, auto_encode = true }) {
    this.id = id;
    this.category = category;
    this.description = description;
    this.resolution = resolution;
    this.rule_id = rule_id;
    this.auto_encode = auto_encode;
    this.timestamp = new Date().toISOString();
  }
}

// ── SelfReport 核心类 ──
export class SelfReport {
  constructor({
    rulesPath = null,
    lessonsPath = null,
    reportPath = null,
  } = {}) {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    this.rulesPath = rulesPath ? path.resolve(rulesPath) : path.join(scriptDir, "push_rules.json");
    this.lessonsPath = lessonsPath ? path.resolve(lessonsPath) : path.join(scriptDir, "..", "docs", "LESSONS_LEARNED.md");
    this.reportPath = reportPath ? path.resolve(reportPath) : null;

    this.frictionPoints = [];
    this.rules = this._loadJson(this.rulesPath);
    this.systemState = {
      cwd: process.cwd(),
      platform: process.platform,
      nodeVersion: process.version,
    };
    this.report = null;
  }

  _loadJson(p) {
    if (!fs.existsSync(p)) return {};
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (e) {
      console.error(`[SelfReport] Failed to load JSON from ${p}: ${e.message}`);
      return {};
    }
  }

  _saveJson(p, data) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  }

  captureFriction({ id, category, description, resolution = "", rule_id = null, auto_encode = true }) {
    // 去重：相同 id 不重复记录
    if (this.frictionPoints.some((fp) => fp.id === id)) {
      return this.frictionPoints.find((fp) => fp.id === id);
    }
    const fp = new FrictionPoint({ id, category, description, resolution, rule_id, auto_encode });
    this.frictionPoints.push(fp);
    return fp;
  }

  _generateRuleId(category) {
    const mapping = {
      "写作流程": "writing_workflow",
      "HTML渲染": "html_rendering",
      "图片处理": "image_processing",
      "路径处理": "path_processing",
      "质检": "quality_check",
      "元数据": "metadata",
      "CTA": "cta_integrity",
      "配置": "configuration",
      "权限管理": "permission",
      "部署": "deployment",
      "文件管理": "file_management",
      "指令语法": "directive_syntax",
      "合规": "compliance",
    };
    return mapping[category] || `auto_${category.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
  }

  async autoEncode() {
    if (!this.rules || Object.keys(this.rules).length === 0) return 0;

    // ── 代码驱动升级：从写 JSON 配置 → 生成可执行代码 ──
    const { generateCheck, persistCheck } = await import("./code-generator.mjs");
    let newRulesCount = 0;

    for (const fp of this.frictionPoints) {
      if (!fp.auto_encode) continue;
      if (!fp.description || fp.description === "undefined") continue;

      const ruleId = String(fp.rule_id || this._generateRuleId(fp.category)).replace(/[^a-zA-Z0-9_]/g, "_");
      fp.rule_id = ruleId;

      // 检查规则是否已存在（代码文件或 JSON 配置）
      const scriptDir = path.dirname(fileURLToPath(import.meta.url));
      const checkFilePath = path.join(scriptDir, "preflight-checks", `${ruleId}.mjs`);
      const l1Exists = this.rules["l1_mandatory_checks"] && this.rules["l1_mandatory_checks"][ruleId];
      const observationExists = this.rules["observation_checks"] && this.rules["observation_checks"][ruleId];
      if (fs.existsSync(checkFilePath) || l1Exists || observationExists) continue;

      // 生成可执行检查代码
      try {
        const generated = generateCheck(fp);
        const persisted = persistCheck(generated);
        newRulesCount++;
        console.log(`[SelfReport] Auto-generated observation check: ${ruleId} → ${generated.checkType} → ${generated.filePath}`);
        console.log(`[SelfReport] Companion test: ${persisted.testPath}`);
        console.log(`[SelfReport] Evolution audit: ${persisted.auditPath}`);
      } catch (e) {
        console.error(`[SelfReport] Failed to generate check for ${ruleId}: ${e.message}`);
      }
    }

    if (newRulesCount > 0) {
      // 重新加载规则（因为 persistCheck 已修改 push_rules.json）
      this.rules = this._loadJson(this.rulesPath);
      this.rules["autopoiesis"] = this.rules["autopoiesis"] || {};
      this.rules["autopoiesis"].self_report_enabled = true;
      this.rules["autopoiesis"].auto_encode = true;
      this.rules["autopoiesis"].code_generation = true;
      this.rules["autopoiesis"].last_evolution = new Date().toISOString();
      this.rules["autopoiesis"].default_generated_enforcement = "observe";
      this.rules["autopoiesis"].generated_tests_required = true;
      this.rules["autopoiesis"].audit_required = true;
      this.rules["autopoiesis"].rollback_snapshots = true;
      this._saveJson(this.rulesPath, this.rules);
    }

    return newRulesCount;
  }

  _loadLessons() {
    if (!fs.existsSync(this.lessonsPath)) {
      return { frontmatter: {}, body: "" };
    }
    const content = fs.readFileSync(this.lessonsPath, "utf8");

    // 解析 YAML frontmatter
    let frontmatter = {};
    let body = content;
    if (content.startsWith("---")) {
      const parts = content.split("---", 3);
      if (parts.length >= 3) {
        const fmText = parts[1].trim();
        frontmatter = this._parseYaml(fmText);
        body = parts[2].trim();
      }
    }
    return { frontmatter, body };
  }

  _parseYaml(text) {
    const result = {};
    let currentKey = null;
    let currentList = null;
    let indentLevel = 0;

    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      // 列表项内的嵌套字段（缩进的 key: value，无 - 前缀）
      const nestedMatch = line.match(/^\s+([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
      if (nestedMatch && currentList !== null && currentList.length > 0) {
        const lastItem = currentList[currentList.length - 1];
        if (lastItem && typeof lastItem === "object") {
          let v = nestedMatch[2].trim();
          if (v === "null") v = null;
          else if (v === "true") v = true;
          else if (v === "false") v = false;
          else if (/^\d+$/.test(v)) v = parseInt(v);
          else v = v.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
          lastItem[nestedMatch[1]] = v;
        }
        continue;
      }

      // 顶层 key: value
      const topMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
      if (topMatch && !line.startsWith("  ")) {
        currentKey = topMatch[1];
        const val = topMatch[2].trim();
        if (val === "" || val === "") {
          currentList = [];
          result[currentKey] = currentList;
        } else {
          // 尝试解析为数字或布尔
          if (val === "true") result[currentKey] = true;
          else if (val === "false") result[currentKey] = false;
          else if (/^\d+$/.test(val)) result[currentKey] = parseInt(val);
          else result[currentKey] = val.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
          currentList = null;
        }
        continue;
      }

      // 列表项
      const listMatch = line.match(/^\s+-\s+(.*)$/);
      if (listMatch && currentList !== null) {
        const itemText = listMatch[1].trim();
        // 简单对象解析：key: "value"
        const kvMatch = itemText.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
        if (kvMatch) {
          const lastItem = currentList[currentList.length - 1];
          if (lastItem && typeof lastItem === "object" && !lastItem[kvMatch[1]]) {
            let v = kvMatch[2].trim();
            if (v === "null") v = null;
            else if (v === "true") v = true;
            else if (v === "false") v = false;
            else if (/^\d+$/.test(v)) v = parseInt(v);
            else v = v.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
            lastItem[kvMatch[1]] = v;
          } else {
            const obj = {};
            let v = kvMatch[2].trim();
            if (v === "null") v = null;
            else if (v === "true") v = true;
            else if (v === "false") v = false;
            else if (/^\d+$/.test(v)) v = parseInt(v);
            else v = v.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
            obj[kvMatch[1]] = v;
            currentList.push(obj);
          }
        } else {
          currentList.push(itemText.replace(/^"|"$/g, "").replace(/^'|'$/g, ""));
        }
      }
    }

    return result;
  }

  _serializeYaml(obj, indent = 0) {
    const lines = [];
    const prefix = "  ".repeat(indent);
    for (const [k, v] of Object.entries(obj)) {
      if (k === "friction_points" && Array.isArray(v)) {
        lines.push(`${prefix}${k}:`);
        for (const fp of v) {
          lines.push(`${prefix}  - id: "${fp.id}"`);
          lines.push(`${prefix}    category: "${fp.category}"`);
          lines.push(`${prefix}    description: "${(fp.description || "").slice(0, 120).replace(/"/g, '\\"')}"`);
          if (fp.resolution) lines.push(`${prefix}    resolution: "${(fp.resolution || "").slice(0, 120).replace(/"/g, '\\"')}"`);
          if (fp.rule_id) lines.push(`${prefix}    rule_id: "${fp.rule_id}"`);
          lines.push(`${prefix}    timestamp: "${fp.timestamp || ""}"`);
        }
      } else if (typeof v === "boolean") {
        lines.push(`${prefix}${k}: ${v}`);
      } else if (typeof v === "number") {
        lines.push(`${prefix}${k}: ${v}`);
      } else if (Array.isArray(v)) {
        lines.push(`${prefix}${k}:`);
        for (const item of v) {
          lines.push(`${prefix}  - "${String(item).replace(/"/g, '\\"')}"`);
        }
      } else {
        lines.push(`${prefix}${k}: "${String(v).replace(/"/g, '\\"')}"`);
      }
    }
    return lines.join("\n");
  }

  writeLessons() {
    const lessons = this._loadLessons();
    let fm = lessons.frontmatter || {};

    fm["autopoiesis"] = true;
    fm["memory_type"] = "living";
    fm["last_updated"] = new Date().toISOString().slice(0, 10);

    // 合并摩擦点（过滤掉 description 为空的占位符）
    const existingFps = (Array.isArray(fm["friction_points"]) ? fm["friction_points"] : [])
      .filter((fp) => fp.description && fp.description !== "undefined" && fp.description !== "");
    const existingIds = new Set(existingFps.map((f) => f.id).filter(Boolean));

    for (const fp of this.frictionPoints) {
      // 跳过无意义的占位符摩擦点
      if (!fp.description || fp.description === "undefined" || fp.description === "") continue;
      if (!existingIds.has(fp.id)) {
        existingFps.push({
          id: fp.id,
          category: fp.category,
          description: fp.description,
          resolution: fp.resolution,
          rule_id: fp.rule_id,
          timestamp: fp.timestamp,
        });
        existingIds.add(fp.id);
      }
    }
    fm["friction_points"] = existingFps;
    // evolution_count 反映实际有效摩擦点数量，而非简单累加
    fm["evolution_count"] = existingFps.length;

    // 生成正文
    const bodyLines = ["# LESSONS_LEARNED — md2wechat 活记忆器官\n"];
    bodyLines.push(
      "> 本文档是 md2wechat SKILL 的「活记忆器官」。每次 pipeline 运行产生摩擦时，"
      + "SelfReport 会自动更新此文档。摩擦点与 `harness/push_rules.json` 中的规则通过 `rule_id` 形成闭环。\n"
    );

    // 按类别分组
    const byCategory = {};
    for (const fp of existingFps) {
      const cat = fp.category || "未分类";
      byCategory[cat] = byCategory[cat] || [];
      // 跳过无意义的占位符摩擦点（description 为空或 undefined）
      if (fp.description && fp.description !== "undefined" && fp.description !== "") {
        byCategory[cat].push(fp);
      }
    }

    for (const cat of Object.keys(byCategory).sort()) {
      bodyLines.push(`\n## 摩擦点类别：${cat}\n`);
      for (const fp of byCategory[cat]) {
        bodyLines.push(`\n### ${fp.id}\n`);
        bodyLines.push(`- **描述**：${fp.description}\n`);
        if (fp.resolution) bodyLines.push(`- **解决**：${fp.resolution}\n`);
        if (fp.rule_id) bodyLines.push(`- **关联规则**：\`${fp.rule_id}\`\n`);
        bodyLines.push(`- **时间**：${fp.timestamp || "unknown"}\n`);
      }
    }

    bodyLines.push("\n---\n");
    bodyLines.push("\n*本文件由 `harness/self_report.mjs` 自动维护。手动修改请在 frontmatter 后添加自定义章节。*\n");

    const body = bodyLines.join("");
    const fmText = this._serializeYaml(fm);
    const fullContent = `---\n${fmText}\n---\n\n${body}`;

    fs.mkdirSync(path.dirname(this.lessonsPath), { recursive: true });
    fs.writeFileSync(this.lessonsPath, fullContent);
  }

  generateReport() {
    this.report = {
      timestamp: new Date().toISOString(),
      system_state: this.systemState,
      friction_summary: {
        total: this.frictionPoints.length,
        by_category: {},
        auto_encoded: this.frictionPoints.filter((fp) => fp.auto_encode && fp.rule_id).length,
      },
      evolution: {
        rules_version: this.rules?.version || "unknown",
        autopoiesis_enabled: this.rules?.autopoiesis?.self_report_enabled || false,
        new_rules_this_run: this.frictionPoints.filter((fp) => fp.auto_encode).length,
      },
    };

    for (const fp of this.frictionPoints) {
      const cat = fp.category || "未分类";
      this.report.friction_summary.by_category[cat] = (this.report.friction_summary.by_category[cat] || 0) + 1;
    }

    if (this.reportPath) {
      this._saveJson(this.reportPath, this.report);
    }

    return this.report;
  }

  formatReportConsole() {
    if (!this.report) this.generateReport();
    const r = this.report;
    const lines = [];
    lines.push("━━━ md2wechat Self Report ━━━");
    lines.push(`时间: ${r.timestamp}`);
    lines.push(`摩擦点总数: ${r.friction_summary.total}`);
    lines.push(`已编码规则: ${r.friction_summary.auto_encoded}`);
    lines.push("");
    for (const [cat, count] of Object.entries(r.friction_summary.by_category)) {
      lines.push(`  ${cat}: ${count}`);
    }
    lines.push("");
    lines.push(`规则版本: ${r.evolution.rules_version}`);
    lines.push(`自创生: ${r.evolution.autopoiesis_enabled ? "启用" : "未启用"}`);
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    return lines.join("\n");
  }
}

// ── CLI 入口 ──
function parseArgs(argv) {
  const args = {};
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
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node harness/self_report.mjs [options]

Commands:
  --capture <id>             Capture a friction point
  --category <text>          Friction category
  --description <text>       Friction description
  --resolution <text>        Resolution text
  --rule-id <text>           Associated rule id
  --auto-encode              Auto-encode into push_rules.json
  --write-lessons            Update LESSONS_LEARNED.md
  --no-write                 Analyze/capture only; do not auto-encode rules or update LESSONS_LEARNED.md
  --generate-report          Generate self-report JSON
  --analyze-log <path>       Analyze pipeline JSONL log and auto-capture patterns
  --rules-path <path>        Override push_rules.json path
  --lessons-path <path>      Override LESSONS_LEARNED.md path
  --json                     Output JSON only
  --help                     Show this help

Examples:
  # Capture and encode a new friction
  node harness/self_report.mjs --capture f030 --category "渲染" \\
    --description "新发现的问题" --resolution "修复方案" --auto-encode --write-lessons

  # Analyze pipeline log for auto-capture
  node harness/self_report.mjs --analyze-log .md2wechat-pipeline.jsonl --write-lessons
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const noWrite = Boolean(args["no-write"]);

  if (args.help) {
    printHelp();
    return 0;
  }

  const sr = new SelfReport({
    rulesPath: args["rules-path"],
    lessonsPath: args["lessons-path"],
  });

  if (args["analyze-log"]) {
    const logPath = args["analyze-log"];
    if (!fs.existsSync(logPath)) {
      console.error(`Log file not found: ${logPath}`);
      return 1;
    }

    const entries = fs.readFileSync(logPath, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));

    const failedSteps = entries.filter((e) => e.status === "failed");
    const autofixes = entries.filter((e) => e.step === "autofix" && e.status === "applied");

    // 已知失败模式 → 摩擦点映射
    const knownPatterns = {
      render: { id: "f031", category: "流程自动化", desc: "preflight 拦截导致渲染失败，需人工修复后重跑", resolution: "orchestrator --auto-fix 自动修复 digest/图片/路径等常见问题", rule_id: "preflight_auto_invoke" },
      bundle: { id: "f036", category: "打包", desc: "bundle 阶段失败，通常是图片缺失或路径问题", resolution: "检查 HTML 中的图片路径是否正确，确保所有图片存在", rule_id: "bundle_integrity" },
      preflight: { id: "f038", category: "图片处理", desc: "preflight 检测到封面图或正文插图缺失/占位，跳过了 dreamina CLI 生图步骤", resolution: "必须使用 dreamina CLI 生成封面和正文插图；紧急情况下可 --skip-image-check 逃逸", rule_id: "pre_image_missing" },
    };

    let newCaptures = 0;

    for (const step of failedSteps) {
      const script = step.script || step.step;
      const pattern = knownPatterns[script];
      if (pattern) {
        const exists = sr.frictionPoints.some((fp) => fp.id === pattern.id);
        if (!exists) {
          sr.captureFriction({
            id: pattern.id,
            category: pattern.category,
            description: pattern.desc,
            resolution: pattern.resolution,
            rule_id: pattern.rule_id,
            auto_encode: true,
          });
          newCaptures++;
        }
      }

      // 从 stdout_preview 中提取具体的 preflight 失败类型
      if (step.stdout_preview) {
        const preflightMatch = step.stdout_preview.match(/"id":\s*"([^"]+)"/g);
        if (preflightMatch) {
          for (const m of preflightMatch) {
            const id = m.match(/"id":\s*"([^"]+)"/)[1];
            const preflightPatterns = {
              digest_length: { id: "f027", category: "内容合规", desc: "digest 超过 128 字符被微信 API 拒绝", resolution: "Step 0 严格控制 summary ≤120 字；orchestrator --auto-fix 自动截断", rule_id: "digest_length" },
              image_size: { id: "f010", category: "图片处理", desc: "图片超过 2MB 导致微信 API 拒绝", resolution: "sips -Z 压缩图片；orchestrator --auto-fix 自动压缩", rule_id: "image_size" },
              local_path_absence: { id: "f030", category: "路径处理", desc: "HTML 中存在本地绝对路径，bundle 前未替换", resolution: "bundle_wechat_article.mjs 自动替换路径；preflight 可跳过此项（bundle 会处理）", rule_id: "local_path_absence" },
            };
            const pp = preflightPatterns[id];
            if (pp) {
              const exists = sr.frictionPoints.some((fp) => fp.id === pp.id);
              if (!exists) {
                sr.captureFriction({
                  id: pp.id,
                  category: pp.category,
                  description: pp.desc,
                  resolution: pp.resolution,
                  rule_id: pp.rule_id,
                  auto_encode: true,
                });
                newCaptures++;
              }
            }
          }
        }
      }
    }

    if (autofixes.length > 0) {
      const hasAutofix = sr.frictionPoints.some((fp) => fp.id === "f037");
      if (!hasAutofix) {
        sr.captureFriction({
          id: "f037",
          category: "自动修复",
          description: "preflight L1 失败需要人工介入修复，返工成本高",
          resolution: "orchestrator --auto-fix 自动修复 digest/图片等常见问题",
          rule_id: "autofix",
          auto_encode: true,
        });
        newCaptures++;
      }
    }

    if (newCaptures > 0 && !noWrite) {
      await sr.autoEncode();
    }

    if (!args.json) {
      console.log(`Analyzed ${entries.length} log entries`);
      console.log(`Found ${failedSteps.length} failed step(s), ${autofixes.length} auto-fix(es)`);
      console.log(`Auto-captured ${newCaptures} new friction point(s)`);
    }
  }

  if (args.capture) {
    sr.captureFriction({
      id: args.capture,
      category: args.category || "未分类",
      description: args.description || "",
      resolution: args.resolution || "",
      rule_id: args["rule-id"] || null,
      auto_encode: args["auto-encode"] !== false,
    });
  }

  if (args["auto-encode"]) {
    if (noWrite) {
      if (!args.json) console.log("Auto-encode skipped because --no-write is set");
    } else {
      const count = await sr.autoEncode();
      if (!args.json) console.log(`Auto-encoded ${count} new rule(s)`);
    }
  }

  if (args["write-lessons"]) {
    if (noWrite) {
      if (!args.json) console.log("LESSONS_LEARNED update skipped because --no-write is set");
    } else {
      sr.writeLessons();
      if (!args.json) console.log(`Updated ${sr.lessonsPath}`);
    }
  }

  if (args["generate-report"] || args.json) {
    sr.generateReport();
    if (args.json) {
      console.log(JSON.stringify(sr.report, null, 2));
    } else {
      console.log(sr.formatReportConsole());
    }
  }

  return 0;
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

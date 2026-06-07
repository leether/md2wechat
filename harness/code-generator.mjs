#!/usr/bin/env node
/**
 * code-generator.mjs — 代码生成器
 *
 * 从摩擦点自动生成可执行的 preflight 检查代码。
 * 将 md2wechat 的 self_report 从"文档驱动"升级为"代码驱动"。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECKS_DIR = path.resolve(__dirname, "preflight-checks");
const RULES_PATH = path.resolve(__dirname, "push_rules.json");

/**
 * 推断检查类型
 */
function inferCheckType(description = "", category = "") {
  const text = `${category} ${description}`.toLowerCase();
  if (/超过|不得超过|大于|小于|上限|下限|限制|长度|字数|大小|尺寸/.test(text)) {
    return "threshold";
  }
  if (/包含|不得存在|残留|缺失|出现|匹配|正则|格式/.test(text)) {
    return "pattern";
  }
  if (/图片|图像|封面|ocr|占位|文字|像素|比例/.test(text)) {
    return "image";
  }
  if (/主语|视角|风格|语义|理解|上下文|语境/.test(text)) {
    return "semantic";
  }
  return "agent";
}

/**
 * 从描述中提取阈值
 */
function extractThreshold(description) {
  const numMatch = description.match(/(\d+)\s*字?符?/);
  if (numMatch) return { type: "max_chars", value: parseInt(numMatch[1]) };

  const byteMatch = description.match(/(\d+)\s*[Mm][Bb]/);
  if (byteMatch) return { type: "max_bytes", value: parseInt(byteMatch[1]) * 1024 * 1024 };

  const ratioMatch = description.match(/(\d+\.?\d*):1/);
  if (ratioMatch) return { type: "ratio", value: parseFloat(ratioMatch[1]) };

  return null;
}

/**
 * 生成 threshold 类型的检查代码
 */
function generateThresholdCheck(fp, threshold) {
  const fnName = `check_${fp.rule_id || fp.id}`;
  let body = "";

  if (threshold.type === "max_chars") {
    body = `
  const text = context.html.replace(/<[^>]+>/g, "");
  const len = Array.from(text).length;
  if (len > ${threshold.value}) {
    return {
      passed: false,
      level: "L1",
      id: "${fp.rule_id || fp.id}",
      message: \`Content exceeds ${threshold.value} characters: got \${len}\`,
      actual: len,
      limit: ${threshold.value},
    };
  }
  return { passed: true, level: "L1", id: "${fp.rule_id || fp.id}", actual: len };`;
  } else if (threshold.type === "max_bytes") {
    body = `
  const bytes = Buffer.byteLength(context.html, "utf8");
  if (bytes > ${threshold.value}) {
    return {
      passed: false,
      level: "L1",
      id: "${fp.rule_id || fp.id}",
      message: \`Content exceeds ${threshold.value} bytes: got \${bytes}\`,
      actual: bytes,
      limit: ${threshold.value},
    };
  }
  return { passed: true, level: "L1", id: "${fp.rule_id || fp.id}", actual: bytes };`;
  } else {
    body = `
  // TODO: Implement threshold check for ${threshold.type}
  return { passed: true, level: "L1", id: "${fp.rule_id || fp.id}", skipped: true, reason: "Threshold type not yet supported" };`;
  }

  return `export function ${fnName}(context) {${body}
}`;
}

/**
 * 生成 pattern 类型的检查代码
 */
function generatePatternCheck(fp) {
  const fnName = `check_${fp.rule_id || fp.id}`;
  const desc = fp.description || "";

  // 尝试从描述中提取关键词
  const keywords = [];
  const quoteMatches = desc.match(/["""']([^"""']+)["""']/g);
  if (quoteMatches) {
    for (const m of quoteMatches) {
      keywords.push(m.replace(/["""']/g, ""));
    }
  }

  // 如果没有提取到关键词，使用 description 中的关键短语
  if (keywords.length === 0) {
    const phrases = desc.split(/[,，.。;；]/).filter((s) => s.trim().length > 2);
    if (phrases.length > 0) keywords.push(phrases[0].trim().slice(0, 20));
  }

  const keywordChecks = keywords.map((kw) => `context.html.includes("${kw}")`).join(" || ");
  const checkLogic = keywordChecks || "false";

  return `export function ${fnName}(context) {
  const forbidden = [${keywords.map((k) => `"${k}"`).join(", ")}];
  const found = forbidden.filter((kw) => context.html.includes(kw));
  if (found.length > 0) {
    return {
      passed: false,
      level: "L1",
      id: "${fp.rule_id || fp.id}",
      message: \`Forbidden pattern detected: "\${found.join(", ")}"\`,
      details: { found },
    };
  }
  return { passed: true, level: "L1", id: "${fp.rule_id || fp.id}" };
}`;
}

/**
 * 生成 semantic 类型的子代理脚本
 */
function generateSemanticAgent(fp) {
  const fnName = `check_${fp.rule_id || fp.id}`;
  return `export function ${fnName}(context) {
  // Semantic check — requires deeper understanding.
  // This is a generated scaffold. Enhance with LLM or heuristics as needed.
  const text = context.md || context.html;

  // TODO: Add semantic analysis logic based on:
  //   ${fp.description.replace(/"/g, '\\"').slice(0, 100)}

  return {
    passed: true,
    level: "L2",
    id: "${fp.rule_id || fp.id}",
    skipped: true,
    reason: "Semantic check scaffold — implement heuristic or agent logic",
  };
}`;
}

/**
 * 生成 agent 类型的子代理脚本
 */
function generateAgent(fp) {
  const fnName = `check_${fp.rule_id || fp.id}`;
  return `export function ${fnName}(context) {
  // Agent-based check — spawn external process or call LLM.
  // This is a generated scaffold.
  return {
    passed: true,
    level: "L2",
    id: "${fp.rule_id || fp.id}",
    skipped: true,
    reason: "Agent check scaffold — implement subprocess or API call",
  };
}`;
}

/**
 * 根据摩擦点生成检查代码
 */
export function generateCheck(fp) {
  const checkType = inferCheckType(fp.description, fp.category);
  const threshold = checkType === "threshold" ? extractThreshold(fp.description) : null;

  let code = "";
  let agentType = null;

  switch (checkType) {
    case "threshold":
      code = generateThresholdCheck(fp, threshold);
      break;
    case "pattern":
      code = generatePatternCheck(fp);
      break;
    case "image":
      code = generateAgent(fp); // 图像检查通常需要外部工具，用 agent 骨架
      agentType = "image";
      break;
    case "semantic":
      code = generateSemanticAgent(fp);
      agentType = "semantic";
      break;
    default:
      code = generateAgent(fp);
      agentType = "generic";
  }

  const ruleId = fp.rule_id || fp.id;
  const fileName = `${ruleId}.mjs`;

  return {
    ruleId,
    checkType,
    agentType,
    fileName,
    filePath: path.join(CHECKS_DIR, fileName),
    code,
    register: {
      id: ruleId,
      name: fp.category || ruleId,
      description: fp.description,
      auto_detect: true,
      check_fn: `preflight-checks.${ruleId}`,
      block_on_fail: true,
      origin_friction: fp.id,
      autopoiesis: true,
    },
  };
}

/**
 * 将生成的检查写入文件并注册到 push_rules.json
 */
export function persistCheck(generated) {
  // 1. 写入检查文件
  fs.mkdirSync(CHECKS_DIR, { recursive: true });
  fs.writeFileSync(generated.filePath, generated.code, "utf8");

  // 2. 注册到 push_rules.json
  let rules = {};
  try {
    rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
  } catch {
    rules = { l1_mandatory_checks: {}, l2_warning_checks: {}, autopoiesis: {} };
  }

  if (!rules.l1_mandatory_checks) rules.l1_mandatory_checks = {};

  // 避免重复注册
  if (!rules.l1_mandatory_checks[generated.ruleId]) {
    rules.l1_mandatory_checks[generated.ruleId] = generated.register;
    rules.autopoiesis = rules.autopoiesis || {};
    rules.autopoiesis.evolution_count = (rules.autopoiesis.evolution_count || 0) + 1;
    rules.autopoiesis.last_evolution = new Date().toISOString();
    fs.writeFileSync(RULES_PATH, JSON.stringify(rules, null, 2), "utf8");
  }

  return generated.filePath;
}

/**
 * 从摩擦点列表批量生成并持久化
 */
export function generateChecksFromFrictionPoints(frictionPoints) {
  const results = [];
  for (const fp of frictionPoints) {
    // 只处理有 description 且未被注册过的摩擦点
    if (!fp.description || fp.description === "undefined") continue;
    const generated = generateCheck(fp);
    const persistedPath = persistCheck(generated);
    results.push({ ruleId: generated.ruleId, type: generated.checkType, path: persistedPath });
  }
  return results;
}

// ── CLI 测试 ──
function main() {
  const testFp = {
    id: "f999",
    category: "测试",
    description: "文章字数不得超过 5000 字",
    resolution: "自动截断",
    rule_id: "test_max_chars",
  };
  const generated = generateCheck(testFp);
  console.log("Generated check type:", generated.checkType);
  console.log("Code:\n", generated.code);
  console.log("Register:", JSON.stringify(generated.register, null, 2));
}

const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
  (fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
);
if (isMain) {
  main();
}

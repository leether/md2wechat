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
const TESTS_DIR = path.resolve(CHECKS_DIR, "__tests__");
const AUDIT_DIR = path.resolve(__dirname, "..", "docs", "evolution-audit");
const SNAPSHOTS_DIR = path.resolve(__dirname, "evolution-snapshots");
const RULES_PATH = path.resolve(__dirname, "push_rules.json");

function ruleIdOf(fp) {
  return String(fp.rule_id || fp.id).replace(/[^a-zA-Z0-9_]/g, "_");
}

export function checkFunctionName(ruleId) {
  return `check_${String(ruleId).replace(/[^a-zA-Z0-9_$]/g, "_")}`;
}

function js(value) {
  return JSON.stringify(String(value));
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function safePathPart(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function extractPatternKeywords(description = "") {
  const keywords = [];
  const quoteMatches = description.match(/["""']([^"""']+)["""']/g);
  if (quoteMatches) {
    for (const m of quoteMatches) {
      keywords.push(m.replace(/["""']/g, ""));
    }
  }

  if (keywords.length === 0) {
    const phrases = description.split(/[,，.。;；]/).filter((s) => s.trim().length > 2);
    if (phrases.length > 0) keywords.push(phrases[0].trim().slice(0, 20));
  }

  return keywords;
}

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
  const ruleId = ruleIdOf(fp);
  const fnName = checkFunctionName(ruleId);
  const ruleIdLiteral = js(ruleId);
  let body = "";

  if (!threshold) {
    body = `
  return { passed: true, level: "OBSERVATION", enforcement: "observe", id: ${ruleIdLiteral}, skipped: true, reason: "No concrete threshold could be inferred" };`;
    return `export function ${fnName}(context) {${body}
}`;
  }

  if (threshold.type === "max_chars") {
    body = `
  const text = context.html.replace(/<[^>]+>/g, "");
  const len = Array.from(text).length;
  if (len > ${threshold.value}) {
    return {
      passed: false,
      level: "OBSERVATION",
      enforcement: "observe",
      id: ${ruleIdLiteral},
      message: \`Content exceeds ${threshold.value} characters: got \${len}\`,
      actual: len,
      limit: ${threshold.value},
    };
  }
  return { passed: true, level: "OBSERVATION", enforcement: "observe", id: ${ruleIdLiteral}, actual: len };`;
  } else if (threshold.type === "max_bytes") {
    body = `
  const bytes = Buffer.byteLength(context.html, "utf8");
  if (bytes > ${threshold.value}) {
    return {
      passed: false,
      level: "OBSERVATION",
      enforcement: "observe",
      id: ${ruleIdLiteral},
      message: \`Content exceeds ${threshold.value} bytes: got \${bytes}\`,
      actual: bytes,
      limit: ${threshold.value},
    };
  }
  return { passed: true, level: "OBSERVATION", enforcement: "observe", id: ${ruleIdLiteral}, actual: bytes };`;
  } else {
    body = `
  // TODO: Implement threshold check for ${threshold.type}
  return { passed: true, level: "OBSERVATION", enforcement: "observe", id: ${ruleIdLiteral}, skipped: true, reason: "Threshold type not yet supported" };`;
  }

  return `export function ${fnName}(context) {${body}
}`;
}

/**
 * 生成 pattern 类型的检查代码
 */
function generatePatternCheck(fp) {
  const ruleId = ruleIdOf(fp);
  const fnName = checkFunctionName(ruleId);
  const ruleIdLiteral = js(ruleId);
  const desc = fp.description || "";
  const keywords = extractPatternKeywords(desc);

  return `export function ${fnName}(context) {
  const forbidden = [${keywords.map((k) => js(k)).join(", ")}];
  const found = forbidden.filter((kw) => context.html.includes(kw));
  if (found.length > 0) {
    return {
      passed: false,
      level: "OBSERVATION",
      enforcement: "observe",
      id: ${ruleIdLiteral},
      message: \`Forbidden pattern detected: "\${found.join(", ")}"\`,
      details: { found },
    };
  }
  return { passed: true, level: "OBSERVATION", enforcement: "observe", id: ${ruleIdLiteral} };
}`;
}

/**
 * 生成 semantic 类型的子代理脚本
 */
function generateSemanticAgent(fp) {
  const ruleId = ruleIdOf(fp);
  const fnName = checkFunctionName(ruleId);
  return `export function ${fnName}(context) {
  // Semantic check — requires deeper understanding.
  // This is a generated scaffold. Enhance with LLM or heuristics as needed.
  const text = context.md || context.html;

  // TODO: Add semantic analysis logic based on:
  //   ${fp.description.replace(/"/g, '\\"').slice(0, 100)}

  return {
    passed: true,
    level: "OBSERVATION",
    enforcement: "observe",
    id: ${js(ruleId)},
    skipped: true,
    reason: "Semantic check scaffold — implement heuristic or agent logic",
  };
}`;
}

/**
 * 生成 agent 类型的子代理脚本
 */
function generateAgent(fp) {
  const ruleId = ruleIdOf(fp);
  const fnName = checkFunctionName(ruleId);
  return `export function ${fnName}(context) {
  // Agent-based check — spawn external process or call LLM.
  // This is a generated scaffold.
  return {
    passed: true,
    level: "OBSERVATION",
    enforcement: "observe",
    id: ${js(ruleId)},
    skipped: true,
    reason: "Agent check scaffold — implement subprocess or API call",
  };
}`;
}

function generateCompanionTest({ fp, ruleId, fileName, checkType, threshold }) {
  const fnName = checkFunctionName(ruleId);
  const baseContext = `{ html: "<p>safe body</p>", md: "safe body", mdPath: "", htmlDir: "", title: "title", author: "author", digest: "digest" }`;
  const assertions = [
    `const smoke = ${fnName}(${baseContext});`,
    `assert.equal(typeof smoke.passed, "boolean");`,
    `assert.equal(smoke.id, ${js(ruleId)});`,
    `assert.equal(smoke.enforcement, "observe");`,
  ];

  if (checkType === "threshold" && threshold?.type === "max_chars") {
    assertions.push(
      `const fail = ${fnName}({ ...${baseContext}, html: "<p>" + "x".repeat(${threshold.value + 1}) + "</p>" });`,
      `assert.equal(fail.passed, false);`,
      `assert.equal(fail.level, "OBSERVATION");`,
    );
  } else if (checkType === "threshold" && threshold?.type === "max_bytes") {
    assertions.push(
      `const fail = ${fnName}({ ...${baseContext}, html: "x".repeat(${threshold.value + 1}) });`,
      `assert.equal(fail.passed, false);`,
      `assert.equal(fail.level, "OBSERVATION");`,
    );
  } else if (checkType === "pattern") {
    const keyword = extractPatternKeywords(fp.description || "")[0];
    if (keyword) {
      assertions.push(
        `const fail = ${fnName}({ ...${baseContext}, html: ${js(`<p>${keyword}</p>`)} });`,
        `assert.equal(fail.passed, false);`,
        `assert.deepEqual(fail.details.found, [${js(keyword)}]);`,
      );
    }
  } else {
    assertions.push(`assert.equal(smoke.skipped, true);`);
  }

  return `import assert from "node:assert/strict";
import { ${fnName} } from "../${fileName}";

${assertions.join("\n")}
`;
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function createRollbackSnapshot(generated, timestamp) {
  const snapshotDir = path.join(SNAPSHOTS_DIR, `${timestamp}-${safePathPart(generated.ruleId)}`);
  fs.mkdirSync(snapshotDir, { recursive: true });
  const files = [];

  if (copyIfExists(RULES_PATH, path.join(snapshotDir, "push_rules.before.json"))) {
    files.push("push_rules.before.json");
  }
  const safeRuleId = safePathPart(generated.ruleId);
  if (copyIfExists(generated.filePath, path.join(snapshotDir, `${safeRuleId}.before.mjs`))) {
    files.push(`${safeRuleId}.before.mjs`);
  }
  if (copyIfExists(generated.testPath, path.join(snapshotDir, `${safeRuleId}.test.before.mjs`))) {
    files.push(`${safeRuleId}.test.before.mjs`);
  }

  const manifest = {
    timestamp,
    rule_id: generated.ruleId,
    snapshot_dir: snapshotDir,
    files,
    rollback_hint: "Restore push_rules.before.json to harness/push_rules.json and remove or restore generated check/test files listed in the audit record.",
  };
  fs.writeFileSync(path.join(snapshotDir, "rollback.json"), JSON.stringify(manifest, null, 2), "utf8");
  return { snapshotDir, files };
}

function writeEvolutionAudit(generated, timestamp, rollback, registeredLayer) {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  const auditPath = path.join(AUDIT_DIR, `${timestamp}-${safePathPart(generated.ruleId)}.json`);
  const audit = {
    timestamp,
    rule_id: generated.ruleId,
    check_type: generated.checkType,
    agent_type: generated.agentType,
    registered_layer: registeredLayer,
    enforcement: generated.register.enforcement,
    block_on_fail: generated.register.block_on_fail,
    generated_files: {
      check: path.relative(path.resolve(__dirname, ".."), generated.filePath),
      test: path.relative(path.resolve(__dirname, ".."), generated.testPath),
    },
    rollback_snapshot: path.relative(path.resolve(__dirname, ".."), rollback.snapshotDir),
    rollback_files: rollback.files,
    register: generated.register,
  };
  fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), "utf8");
  return auditPath;
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

  const ruleId = ruleIdOf(fp);
  const fileName = `${ruleId}.mjs`;
  const testFileName = `${ruleId}.test.mjs`;
  const testCode = generateCompanionTest({ fp, ruleId, fileName, checkType, threshold });

  return {
    ruleId,
    checkType,
    agentType,
    fileName,
    filePath: path.join(CHECKS_DIR, fileName),
    testFileName,
    testPath: path.join(TESTS_DIR, testFileName),
    code,
    testCode,
    register: {
      id: ruleId,
      name: fp.category || ruleId,
      description: fp.description,
      auto_detect: true,
      check_fn: `preflight-checks.${ruleId}`,
      enforcement: "observe",
      isolation: true,
      block_on_fail: false,
      origin_friction: fp.id,
      autopoiesis: true,
      generated_test: `preflight-checks/__tests__/${testFileName}`,
    },
  };
}

/**
 * 将生成的检查写入文件并注册到 push_rules.json
 */
export function persistCheck(generated) {
  const timestamp = timestampForPath();
  const rollback = createRollbackSnapshot(generated, timestamp);

  // 1. 写入检查文件和配套测试
  fs.mkdirSync(CHECKS_DIR, { recursive: true });
  fs.mkdirSync(TESTS_DIR, { recursive: true });
  fs.writeFileSync(generated.filePath, generated.code, "utf8");
  fs.writeFileSync(generated.testPath, generated.testCode, "utf8");

  // 2. 注册到 push_rules.json
  let rules = {};
  try {
    rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
  } catch {
    rules = { l1_mandatory_checks: {}, l2_warning_checks: {}, observation_checks: {}, autopoiesis: {} };
  }

  if (!rules.l1_mandatory_checks) rules.l1_mandatory_checks = {};
  if (!rules.observation_checks) rules.observation_checks = {};

  let registeredLayer = "existing";
  const l1Exists = Boolean(rules.l1_mandatory_checks[generated.ruleId]);
  const observedExists = Boolean(rules.observation_checks[generated.ruleId]);

  // 新生成规则默认进入 observation，不直接进入 L1。
  if (!l1Exists && !observedExists) {
    rules.observation_checks[generated.ruleId] = {
      ...generated.register,
      audit_required: true,
      rollback_required: true,
    };
    rules.autopoiesis = rules.autopoiesis || {};
    rules.autopoiesis.evolution_count = (rules.autopoiesis.evolution_count || 0) + 1;
    rules.autopoiesis.last_evolution = new Date().toISOString();
    rules.autopoiesis.default_generated_enforcement = "observe";
    rules.autopoiesis.generated_tests_required = true;
    rules.autopoiesis.audit_required = true;
    rules.autopoiesis.rollback_snapshots = true;
    fs.writeFileSync(RULES_PATH, JSON.stringify(rules, null, 2), "utf8");
    registeredLayer = "observation_checks";
  }

  const auditPath = writeEvolutionAudit(generated, timestamp, rollback, registeredLayer);
  return { checkPath: generated.filePath, testPath: generated.testPath, auditPath, rollbackSnapshot: rollback.snapshotDir, registeredLayer };
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
    const persisted = persistCheck(generated);
    results.push({ ruleId: generated.ruleId, type: generated.checkType, ...persisted });
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
  console.log("Test:\n", generated.testCode);
  console.log("Register:", JSON.stringify(generated.register, null, 2));
}

const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
  (fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
);
if (isMain) {
  main();
}

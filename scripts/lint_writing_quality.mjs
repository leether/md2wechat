#!/usr/bin/env node
/**
 * lint_writing_quality.mjs — 写作质量质检脚本
 *
 * 从 khazix-writer 的四层质控体系中抽取可自动化的部分，
 * 对 Markdown 文件进行扫描，输出质检报告。
 *
 * L1 硬性规则：违规直接报错（阻止渲染）
 * L2 风格一致性：违规输出警告（不阻止渲染）
 *
 * 用法：
 *   node lint_writing_quality.mjs --input article.md [--rules ./rules.json] [--strict]
 *
 * --strict: L2 警告也视为错误
 */

import fs from "node:fs";
import path from "node:path";

// ─── CLI 参数解析 ──────────────────────────────────────────
function parseCliArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && argv[i + 1]) args.input = argv[++i];
    else if (argv[i] === "--rules" && argv[i + 1]) args.rules = argv[++i];
    else if (argv[i] === "--strict") args.strict = true;
    else if (argv[i] === "--help" || argv[i] === "-h") args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`
lint_writing_quality.mjs — 写作质量质检（基于 khazix-writer 四层质控体系）

用法：
  node lint_writing_quality.mjs --input <markdown> [--rules <rules.json>] [--strict]

参数：
  --input   输入 Markdown 文件路径（必需）
  --rules   规则文件路径（默认同目录下 references/khazix-writer/rules.json）
  --strict  L2 警告也视为错误
  --help    显示帮助
`);
}

// ─── 规则加载 ──────────────────────────────────────────────
function loadRules(rulesPath) {
  const defaultPath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "references",
    "khazix-writer",
    "rules.json",
  );

  const resolved = rulesPath || defaultPath;
  if (!fs.existsSync(resolved)) {
    console.warn(`⚠️ 规则文件不存在: ${resolved}，跳过写作质检`);
    return null;
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

// ─── 预处理：剥离 Markdown 指令行和代码块 ──────────────────

function stripMarkdownDirectives(markdown) {
  const lines = markdown.split("\n");
  const proseLines = [];
  let inCodeBlock = false;

  for (const line of lines) {
    // 围栏代码块
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // :::wechat-card / :::wechat-hero / :::wechat-image 等指令行
    if (/^:::[a-zA-Z]/.test(line.trim())) continue;

    // 键值对指令行（title: / tone: / src: / alt: / caption:）
    if (/^(title|tone|src|alt|caption|kicker)\s*:/i.test(line.trim())) continue;

    // summary: 元数据
    if (/^summary\s*:/i.test(line.trim())) continue;

    // 表格分隔行
    if (/^\|[-:\s|]+\|$/.test(line.trim())) continue;

    // 空行保留（段落边界）
    proseLines.push(line);
  }

  return proseLines.join("\n");
}

// ─── L1 硬性规则扫描 ──────────────────────────────────────

function scanBannedWords(text, rules) {
  const hits = [];
  for (const word of rules.l1_banned_words) {
    const regex = new RegExp(word, "g");
    let match;
    while ((match = regex.exec(text)) !== null) {
      const line = text.slice(0, match.index).split("\n").length;
      const replacement = rules.l1_banned_words_replacements[word] || "（请替换）";
      hits.push({ word, line, replacement });
    }
  }
  return hits;
}

function scanBannedPunctuation(text, rules) {
  const hits = [];
  const punctuationRules = rules.l1_banned_punctuation || [];
  for (const rule of punctuationRules) {
    const regex = new RegExp(rule.char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    let match;
    while ((match = regex.exec(text)) !== null) {
      const line = text.slice(0, match.index).split("\n").length;
      hits.push({ char: rule.char, reason: rule.reason, replacement: rule.replacement, line });
    }
  }
  return hits;
}

function scanL2Punctuation(text, rules) {
  const hits = [];
  const punctuationRules = rules.l2_banned_punctuation || [];
  for (const rule of punctuationRules) {
    const regex = new RegExp(rule.char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    let match;
    while ((match = regex.exec(text)) !== null) {
      const line = text.slice(0, match.index).split("\n").length;
      hits.push({ char: rule.char, reason: rule.reason, replacement: rule.replacement, line });
    }
  }
  return hits;
}

function scanBannedStructures(text, rules) {
  const hits = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    for (const pattern of rules.l1_banned_structures) {
      if (new RegExp(pattern).test(line)) {
        hits.push({ pattern, line: i + 1, excerpt: line.slice(0, 80) });
      }
    }
  }
  return hits;
}

function scanVagueToolNames(text, rules) {
  const hits = [];
  for (const phrase of rules.l1_banned_vague_tools) {
    const regex = new RegExp(phrase, "g");
    let match;
    while ((match = regex.exec(text)) !== null) {
      const line = text.slice(0, match.index).split("\n").length;
      hits.push({ phrase, line });
    }
  }
  return hits;
}

function scanParagraphLength(text, maxChars) {
  const hits = [];
  const paragraphs = text.split(/\n\s*\n/);
  let currentLine = 1;
  for (const para of paragraphs) {
    const plainText = para.replace(/[#*>`\[\]!|()-]/g, "").trim();
    if (plainText.length > maxChars) {
      const startLine = currentLine;
      hits.push({
        startLine,
        charCount: plainText.length,
        maxChars,
        excerpt: plainText.slice(0, 60) + "...",
      });
    }
    currentLine += para.split("\n").length;
  }
  return hits;
}

// ─── L2 风格一致性扫描 ────────────────────────────────────

function scanOpening(lines, rules) {
  const warnings = [];
  // 检查前 10 行是否有宏大叙事开头
  const opening = lines.slice(0, 10).join(" ");
  for (const pattern of rules.l2_no_go_openings) {
    if (new RegExp(pattern).test(opening)) {
      warnings.push({
        type: "宏大叙事开头",
        pattern,
        detail: "开头应从具体的当下事件切入，不要宏大叙事",
      });
    }
  }
  return warnings;
}

function scanColloquialUsage(text, rules) {
  let count = 0;
  const found = [];
  for (const expr of rules.l2_colloquial_expressions) {
    const regex = new RegExp(expr);
    if (regex.test(text)) {
      count++;
      found.push(expr);
    }
  }
  return {
    count,
    minimum: rules.l2_min_colloquial_expressions,
    found,
    passed: count >= rules.l2_min_colloquial_expressions,
  };
}

function scanSentenceRhythm(text, rules) {
  const warnings = [];
  // 提取纯文本段落（去掉 markdown 语法行）
  const proseLines = text
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#") && !l.trim().startsWith(">") && !l.trim().startsWith("```") && !l.trim().startsWith("|") && !l.trim().startsWith("- ") && !l.trim().startsWith(":::"));

  let consecutiveSimilar = 0;
  let prevLen = 0;
  for (const line of proseLines) {
    const clean = line.replace(/[#*>`\[\]!|()-]/g, "").trim();
    if (!clean) continue;
    const len = clean.length;
    if (prevLen > 0 && Math.abs(len - prevLen) < rules.l2_sentence_variance_threshold) {
      consecutiveSimilar++;
      if (consecutiveSimilar >= rules.l2_max_consecutive_similar_length) {
        warnings.push({
          type: "句长节奏单一",
          detail: `连续 ${consecutiveSimilar + 1} 句句长方差 < ${rules.l2_sentence_variance_threshold}（${len}字附近），节奏呆板`,
        });
        break;
      }
    } else {
      consecutiveSimilar = 0;
    }
    prevLen = len;
  }
  return warnings;
}

function scanShortSentenceBreaks(text, rules) {
  // 检测极短句独立成段（≤10 字的段落）
  const paragraphs = text.split(/\n\s*\n/);
  let shortBreakCount = 0;
  for (const para of paragraphs) {
    const clean = para.replace(/[#*>`\[\]!|()-]/g, "").trim();
    if (clean.length > 0 && clean.length <= 10) {
      shortBreakCount++;
    }
  }
  return {
    count: shortBreakCount,
    minimum: rules.l2_min_short_sentence_breaks,
    passed: shortBreakCount >= rules.l2_min_short_sentence_breaks,
  };
}

function scanEmotionPunctuation(text, rules) {
  const found = [];
  for (const ep of rules.l2_emotion_punctuation) {
    if (text.includes(ep)) found.push(ep);
  }
  return { found, passed: found.length > 0 };
}

function scanOverFormatting(text, rules) {
  const warnings = [];
  // 大段加粗：连续 >2 行加粗
  const lines = text.split("\n");
  let consecutiveBold = 0;
  for (const line of lines) {
    if (/^\*\*.+\*\*$/.test(line.trim()) || /^\*\*.+\*\*$/.test(line.trim())) {
      consecutiveBold++;
      if (consecutiveBold > rules.l2_min_bold_lines_before_flag) {
        warnings.push({ type: "过度加粗", detail: "连续加粗行过多，公众号长文不建议大量加粗" });
        break;
      }
    } else {
      consecutiveBold = 0;
    }
  }
  return warnings;
}

function scanKnowledgeOutputBannedPhrases(text, rules) {
  const hits = [];
  for (const pattern of rules.l3_check_patterns) {
    if (!pattern.banned_phrases) continue;
    for (const phrase of pattern.banned_phrases) {
      const regex = new RegExp(phrase, "g");
      let match;
      while ((match = regex.exec(text)) !== null) {
        const line = text.slice(0, match.index).split("\n").length;
        hits.push({ phrase, line, checkId: pattern.id, description: pattern.description });
      }
    }
  }
  return hits;
}

// ─── 主扫描逻辑 ────────────────────────────────────────────

export function lintWritingQuality(markdown, rulesPath, options = {}) {
  const rules = loadRules(rulesPath);
  if (!rules) {
    return { passed: true, skipped: true, summary: "规则文件不存在，跳过写作质检" };
  }

  const text = markdown;
  const prose = stripMarkdownDirectives(text); // 剥离指令行，只扫描正文
  const lines = text.split("\n");

  // L1 扫描（只扫描正文，不扫描 Markdown 指令行）
  const l1 = {
    bannedWords: scanBannedWords(prose, rules),
    bannedPunctuation: scanBannedPunctuation(prose, rules),
    bannedStructures: scanBannedStructures(prose, rules),
    vagueTools: scanVagueToolNames(prose, rules),
    longParagraphs: scanParagraphLength(prose, rules.l1_max_paragraph_chars),
  };

  const l1TotalHits =
    l1.bannedWords.length +
    l1.bannedPunctuation.length +
    l1.bannedStructures.length +
    l1.vagueTools.length +
    l1.longParagraphs.length;

  // L2 扫描
  const l2Punctuation = scanL2Punctuation(prose, rules);
  const l2 = {
    opening: scanOpening(lines, rules),
    colloquial: scanColloquialUsage(prose, rules),
    sentenceRhythm: scanSentenceRhythm(prose, rules),
    shortBreaks: scanShortSentenceBreaks(prose, rules),
    emotionPunctuation: scanEmotionPunctuation(prose, rules),
    overFormatting: scanOverFormatting(prose, rules),
    punctuation: l2Punctuation,
  };

  const l2Warnings = [
    ...l2.opening,
    ...l2.sentenceRhythm,
    ...l2.overFormatting,
    ...l2Punctuation.map((h) => ({ type: "建议替代标点", detail: `第${h.line}行: ${h.reason}` })),
    ...(l2.colloquial.passed ? [] : [{ type: "口语化表达不足", detail: `仅使用 ${l2.colloquial.count}/${l2.colloquial.minimum} 个口语化词组` }]),
    ...(l2.shortBreaks.passed ? [] : [{ type: "句式断裂不足", detail: `仅 ${l2.shortBreaks.count}/${l2.shortBreaks.minimum} 处极短句独立成段` }]),
    ...(l2.emotionPunctuation.passed ? [] : [{ type: "情绪标点缺失", detail: "未使用。。。/？？？/= = 等情绪标点" }]),
  ];

  // L3 可自动扫描部分
  const l3Auto = {
    knowledgeBanned: scanKnowledgeOutputBannedPhrases(prose, rules),
  };

  const l1Passed = l1TotalHits === 0;
  const l2Passed = l2Warnings.length === 0;
  const overallPassed = options.strict ? l1Passed && l2Passed : l1Passed;

  return {
    passed: overallPassed,
    l1: { ...l1, passed: l1Passed, totalHits: l1TotalHits },
    l2: { ...l2, warnings: l2Warnings, passed: l2Passed },
    l3: l3Auto,
    rules,
  };
}

// ─── 报告格式化 ────────────────────────────────────────────

export function formatReport(result) {
  if (result.skipped) return `⚠️ ${result.summary}`;

  const lines = [];

  lines.push("━━━ 写作质量质检报告 ━━━");
  lines.push("");

  // L1
  lines.push(`L1 硬性规则 ${result.l1.passed ? "✅" : "❌"}`);
  if (result.l1.bannedWords.length > 0) {
    lines.push(`  禁用词：${result.l1.bannedWords.length}处`);
    for (const h of result.l1.bannedWords) {
      lines.push(`    - 第${h.line}行: "${h.word}" → ${h.replacement}`);
    }
  }
  if (result.l1.bannedPunctuation.length > 0) {
    lines.push(`  禁用标点：${result.l1.bannedPunctuation.length}处`);
    for (const h of result.l1.bannedPunctuation) {
      lines.push(`    - 第${h.line}行: ${h.reason}`);
    }
  }
  if (result.l1.bannedStructures.length > 0) {
    lines.push(`  结构套话：${result.l1.bannedStructures.length}处`);
    for (const h of result.l1.bannedStructures) {
      lines.push(`    - 第${h.line}行: "${h.excerpt}"`);
    }
  }
  if (result.l1.vagueTools.length > 0) {
    lines.push(`  空泛工具名：${result.l1.vagueTools.length}处`);
    for (const h of result.l1.vagueTools) {
      lines.push(`    - 第${h.line}行: "${h.phrase}"`);
    }
  }
  if (result.l1.longParagraphs.length > 0) {
    lines.push(`  超长段落：${result.l1.longParagraphs.length}处`);
    for (const h of result.l1.longParagraphs) {
      lines.push(`    - 第${h.startLine}行: ${h.charCount}字 (上限${h.maxChars}字)`);
    }
  }
  if (result.l1.passed) lines.push("  全部通过 ✅");

  lines.push("");

  // L2
  lines.push(`L2 风格一致性 ${result.l2.passed ? "✅" : "⚠️"}`);
  if (result.l2.warnings.length > 0) {
    for (const w of result.l2.warnings) {
      lines.push(`  ⚠️ ${w.type}: ${w.detail}`);
    }
  }
  // 补充正面信息
  const col = result.l2.colloquial;
  lines.push(`  口语化词组: ${col.count}/${col.minimum} ${col.passed ? "✅" : "⚠️"}`);
  const sb = result.l2.shortBreaks;
  lines.push(`  句式断裂: ${sb.count}/${sb.minimum} ${sb.passed ? "✅" : "⚠️"}`);
  const ep = result.l2.emotionPunctuation;
  lines.push(`  情绪标点: ${ep.found.length > 0 ? ep.found.join("、") + " ✅" : "未使用 ⚠️"}`);
  if (result.l2.passed) lines.push("  全部通过 ✅");

  lines.push("");

  // L3 可自动扫描部分
  lines.push(`L3 内容质量（自动扫描部分）`);
  if (result.l3.knowledgeBanned.length > 0) {
    for (const h of result.l3.knowledgeBanned) {
      lines.push(`  ⚠️ 教科书式科普: 第${h.line}行 "${h.phrase}"`);
    }
  } else {
    lines.push("  教科书式科普短语: 未检测到 ✅");
  }
  lines.push("  ⚠️ L3 其余检查项（观点支撑/文化升维/同理心）需人工审读");

  lines.push("");
  lines.push(`总评: ${result.passed ? "✅ 通过" : "❌ 需返工"}`);

  return lines.join("\n");
}

// ─── CLI 入口 ──────────────────────────────────────────────

function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.help || !args.input) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ 文件不存在: ${inputPath}`);
    process.exit(1);
  }

  const markdown = fs.readFileSync(inputPath, "utf8");
  const result = lintWritingQuality(markdown, args.rules, { strict: args.strict });

  console.log(formatReport(result));

  if (!result.passed) {
    process.exit(1);
  }
}

// 支持直接运行
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMainModule) main();

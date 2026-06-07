#!/usr/bin/env node
/**
 * Source Verification Agent
 * 自动核对文章中的精确数字是否与原始素材一致。
 *
 * 策略：
 * 1. 从 HTML 提取所有精确数字（百分比、金额、版本号、日期、倍数等）
 * 2. 从 MD（如果有）提取同样的数字集合
 * 3. 比较两者的数字集合，找出 MD 中没有但 HTML 中出现的"新增数字"
 * 4. 对"新增数字"进行风险评级：高风险的精确数字标记为待确认
 *
 * 输出：JSON 到 stdout 最后一行
 */

import fs from "node:fs";

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function htmlToVisibleText(html) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function extractPreciseNumbers(text) {
  const numbers = [];

  // 百分比：23.5%、100%
  const pctMatches = text.match(/\d+\.?\d*%/g) || [];
  for (const m of pctMatches) numbers.push({ type: "percentage", value: m, context: extractContext(text, m) });

  // 金额：¥123.45、$1000、1234元
  const currencyMatches = text.match(/[¥$€]\d+[\d,.]*/g) || [];
  for (const m of currencyMatches) numbers.push({ type: "currency", value: m, context: extractContext(text, m) });

  // 版本号：v1.2.3、V2.0、4.9.0
  const versionMatches = text.match(/v?\d+\.\d+(\.\d+)?/gi) || [];
  for (const m of versionMatches) {
    // 过滤掉简单的年份（2024、2025）
    if (/^\d{4}$/.test(m)) continue;
    numbers.push({ type: "version", value: m, context: extractContext(text, m) });
  }

  // 日期：2024-06-07、2024/06/07、2024年6月7日
  const dateMatches = text.match(/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?/g) || [];
  for (const m of dateMatches) numbers.push({ type: "date", value: m, context: extractContext(text, m) });

  // 人数/倍数：123人、10倍、3x
  const unitMatches = text.match(/\d+[\d,.]*\s*[人个倍xX]/g) || [];
  for (const m of unitMatches) numbers.push({ type: "unit", value: m, context: extractContext(text, m) });

  // 去重
  const seen = new Set();
  return numbers.filter((n) => {
    const key = `${n.type}:${n.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractContext(text, target) {
  const idx = text.indexOf(target);
  if (idx === -1) return "";
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + target.length + 30);
  return text.slice(start, end).replace(/\s+/g, " ");
}

function main() {
  const ctxPath = process.argv[2];
  if (!ctxPath || !fs.existsSync(ctxPath)) {
    console.log(JSON.stringify({ passed: true, skipped: true, reason: "No context provided" }));
    process.exit(0);
  }

  const ctx = JSON.parse(fs.readFileSync(ctxPath, "utf8"));
  const html = htmlToVisibleText(ctx.html || "");
  const mdPath = ctx.mdPath;

  const htmlNumbers = extractPreciseNumbers(html);

  let mdNumbers = [];
  if (mdPath && fs.existsSync(mdPath)) {
    const md = fs.readFileSync(mdPath, "utf8");
    mdNumbers = extractPreciseNumbers(md);
  }

  const mdValues = new Set(mdNumbers.map((n) => n.value));
  const suspicious = htmlNumbers.filter((n) => !mdValues.has(n.value));

  // 风险评级：只有"高精确度"的数字才标记为风险
  // 简单启发：百分比、版本号、精确金额 是高风险；普通计数（如"3个"）是低风险
  const highRiskTypes = new Set(["percentage", "version", "currency"]);
  const highRisk = suspicious.filter((n) => highRiskTypes.has(n.type));

  if (highRisk.length > 0) {
    const details = highRisk.map((n) => ({
      value: n.value,
      type: n.type,
      context: n.context,
      risk: "High precision number not found in source MD. Verify it was not invented from memory.",
    }));

    console.log(JSON.stringify({
      passed: false,
      id: "source_verification",
      message: `Found ${highRisk.length} high-precision number(s) in HTML not present in source MD: ${highRisk.map((n) => n.value).join(", ")}`,
      details,
      stats: { htmlNumbers: htmlNumbers.length, mdNumbers: mdNumbers.length, suspicious: suspicious.length, highRisk: highRisk.length },
    }));
    process.exit(0);
  }

  console.log(JSON.stringify({
    passed: true,
    id: "source_verification",
    message: `Verified ${htmlNumbers.length} number(s) against source. No high-risk invented numbers detected.`,
    stats: { htmlNumbers: htmlNumbers.length, mdNumbers: mdNumbers.length, suspicious: suspicious.length, highRisk: highRisk.length },
  }));
}

main();

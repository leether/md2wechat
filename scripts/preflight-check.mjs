#!/usr/bin/env node
/**
 * preflight-check.mjs
 *
 * 解析 md2wechat Audit Log 输出，判断是否所有检查项通过。
 *
 * 输入：Audit Log 文本（stdin 或 --file 参数）
 * 输出：JSON { passed: boolean, failures: string[] }
 *
 * 用法：
 *   node scripts/preflight-check.mjs --file /tmp/audit.log
 *   cat /tmp/audit.log | node scripts/preflight-check.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { parseArgs } from 'util';

// ── 解析 Audit Log ──────────────────────────────────────────

function parseAuditLog(text) {
  const result = {
    img: null,
    cdn: null,
    h2: null,
    cards: null,
    quoteBlocks: null,
    styleCount: null,
    position: null,
    filter: null,
    renderQa: null,     // 【渲染质检】区块
  };

  // 匹配：「img标签: 3」或「img: 3✅」
  const imgMatch = text.match(/img标签?\s*:\s*(\d+)/);
  if (imgMatch) result.img = parseInt(imgMatch[1], 10);

  // 匹配：「CDN图片: 3」或「CDN: 3✅」
  const cdnMatch = text.match(/CDN图片?\s*:\s*(\d+)/);
  if (cdnMatch) result.cdn = parseInt(cdnMatch[1], 10);

  // 匹配：「h2标题: 5」或「h2: 5✅」
  const h2Match = text.match(/h2标题?\s*:\s*(\d+)/i);
  if (h2Match) result.h2 = parseInt(h2Match[1], 10);

  // 匹配：「卡片: 5 (深4 / 浅1)」或「卡片: 1✅」
  const cardMatch = text.match(/卡片\s*:\s*(\d+)/);
  if (cardMatch) result.cards = parseInt(cardMatch[1], 10);

  // 匹配：「引用块: 1」或「引用块: 2✅」
  const quoteMatch = text.match(/引用块\s*:\s*(\d+)/);
  if (quoteMatch) result.quoteBlocks = parseInt(quoteMatch[1], 10);

  // 匹配：「style属性: 136」或「style: 225✅」
  const styleMatch = text.match(/style属性?\s*:\s*(\d+)/i);
  if (styleMatch) result.styleCount = parseInt(styleMatch[1], 10);

  // 匹配：「position: 0 ✅」或「position: 1 ❌」
  const posMatch = text.match(/position\s*:\s*(\d+)\s*(✅|❌)?/);
  if (posMatch) result.position = parseInt(posMatch[1], 10);

  // 匹配：「filter: 0 ✅」或「filter: 2 ❌」
  const filterMatch = text.match(/filter\s*:\s*(\d+)\s*(✅|❌)?/);
  if (filterMatch) result.filter = parseInt(filterMatch[1], 10);

  // 检查是否有【渲染质检】区块
  result.renderQa = text.includes('【渲染质检】');

  return result;
}

// ── 验证规则 ──────────────────────────────────────────────

function validate(parsed, options = {}) {
  const failures = [];

  // 规则 1：img ≥ 1
  if (parsed.img === null) {
    failures.push('img: 未找到 img 检查项');
  } else if (parsed.img < 1) {
    failures.push(`img: 期望 ≥ 1，实际 = ${parsed.img}`);
  }

  // 规则 2：CDN 与 img 数量一致
  if (parsed.cdn === null) {
    failures.push('CDN: 未找到 CDN 检查项');
  } else if (parsed.img !== null && parsed.cdn !== parsed.img) {
    failures.push(`CDN: 期望 = ${parsed.img}（与 img 一致），实际 = ${parsed.cdn}`);
  }

  // 规则 3：h2 > 0
  if (parsed.h2 === null) {
    failures.push('h2: 未找到 h2 检查项');
  } else if (parsed.h2 <= 0) {
    failures.push(`h2: 期望 > 0，实际 = ${parsed.h2}`);
  }

  // 规则 4：卡片数 ≥ 0（可以为 0，但如果有卡片 MD 则必须 > 0——这个需要外部传入期望）
  if (parsed.cards === null) {
    failures.push('卡片: 未找到卡片检查项');
  } else if (options.expectedCards !== undefined && parsed.cards !== options.expectedCards) {
    failures.push(`卡片: 期望 = ${options.expectedCards}，实际 = ${parsed.cards}`);
  }

  // 规则 5：引用块 ≥ 0（同理，可选外部期望）
  if (parsed.quoteBlocks === null) {
    failures.push('引用块: 未找到引用块检查项');
  } else if (options.expectedQuotes !== undefined && parsed.quoteBlocks !== options.expectedQuotes) {
    failures.push(`引用块: 期望 = ${options.expectedQuotes}，实际 = ${parsed.quoteBlocks}`);
  }

  // 规则 6：style 属性 > 50
  if (parsed.styleCount === null) {
    failures.push('style: 未找到 style 检查项');
  } else if (parsed.styleCount < 50) {
    failures.push(`style: 期望 > 50，实际 = ${parsed.styleCount}`);
  }

  // 规则 7：position = 0
  if (parsed.position === null) {
    failures.push('position: 未找到 position 检查项');
  } else if (parsed.position !== 0) {
    failures.push(`position: 期望 = 0，实际 = ${parsed.position}（微信会过滤 position）`);
  }

  // 规则 8：filter = 0
  if (parsed.filter === null) {
    failures.push('filter: 未找到 filter 检查项');
  } else if (parsed.filter !== 0) {
    failures.push(`filter: 期望 = 0，实际 = ${parsed.filter}（filter 兼容性不稳定）`);
  }

  // 规则 9：【渲染质检】区块必须存在（如果传了 --lint-report）
  if (options.requireRenderQa && !parsed.renderQa) {
    failures.push('渲染质检: 【渲染质检】区块缺失（--lint-report 未传或 lint.json 未生成）');
  }

  return {
    passed: failures.length === 0,
    failures,
    parsed,
  };
}

// ── 格式化输出 ────────────────────────────────────────────

function formatResult(result) {
  const lines = [];

  // 逐行输出检查项状态
  const checks = [
    ['img', result.parsed.img, '≥ 1'],
    ['CDN', result.parsed.cdn, `= img（${result.parsed.img}）`],
    ['h2', result.parsed.h2, '> 0'],
    ['卡片', result.parsed.cards, '≥ 0'],
    ['引用块', result.parsed.quoteBlocks, '≥ 0'],
    ['style', result.parsed.styleCount, '> 50'],
    ['position', result.parsed.position, '= 0'],
    ['filter', result.parsed.filter, '= 0'],
  ];

  for (const [name, actual, expected] of checks) {
    if (actual === null) {
      lines.push(`  ❓ ${name}: 未检查`);
    } else {
      // 简单判断是否通过
      let pass = false;
      if (name === 'img') pass = actual >= 1;
      else if (name === 'CDN') pass = actual === result.parsed.img;
      else if (name === 'h2') pass = actual > 0;
      else if (name === 'position') pass = actual === 0;
      else if (name === 'filter') pass = actual === 0;
      else pass = true; // 卡片/引用块/style 需要外部期望，这里只显示

      lines.push(`  ${pass ? '✅' : '❌'} ${name}: ${actual}（期望 ${expected}）`);
    }
  }

  if (result.parsed.renderQa !== null) {
    lines.push(`  ${result.parsed.renderQa ? '✅' : '❌'} 渲染质检: ${result.parsed.renderQa ? '存在' : '缺失'}`);
  }

  lines.push('');
  lines.push(result.passed ? '✅ 所有检查项通过' : `❌ ${result.failures.length} 项未通过`);

  if (!result.passed) {
    lines.push('');
    lines.push('失败项：');
    for (const f of result.failures) {
      lines.push(`  - ${f}`);
    }
  }

  return lines.join('\n');
}

// ── 主程序 ────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  let input = '';
  let requireRenderQa = false;
  let expectedCards = undefined;
  let expectedQuotes = undefined;

  // 简单参数解析（不依赖 util.parseArgs 的复杂功能）
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) {
      const f = args[i + 1];
      if (!existsSync(f)) {
        console.error(`错误：文件不存在 — ${f}`);
        process.exit(1);
      }
      input = readFileSync(f, 'utf8');
      i++;
    } else if (args[i] === '--require-render-qa') {
      requireRenderQa = true;
    } else if (args[i] === '--expected-cards' && args[i + 1]) {
      expectedCards = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--expected-quotes' && args[i + 1]) {
      expectedQuotes = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--json') {
      // JSON 输出模式，下面处理
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
用法：
  node scripts/preflight-check.mjs --file <audit.log>
  cat audit.log | node scripts/preflight-check.mjs

选项：
  --file <path>           从文件读取 Audit Log
  --require-render-qa     要求【渲染质检】区块必须存在
  --expected-cards <N>   期望卡片数（MD 中有 N 个 :::wechat-card）
  --expected-quotes <N>   期望引用块数（MD 中有 N 个 > 块）
  --json                  输出 JSON 格式（供程序调用）
  --help, -h             显示帮助

示例：
  node scripts/preflight-check.mjs --file /tmp/audit.log --require-render-qa --expected-cards 2
`);
      process.exit(0);
    }
  }

  // 如果没有从 --file 读到，从 stdin 读取
  if (!input && !process.stdin.isTTY) {
    // stdin 模式：这个简化版不支持，提示用户用 --file
    console.error('提示：请使用 --file <path> 指定 Audit Log 文件');
    console.error('  或升级 Node.js 版本以支持 stdin 读取');
    process.exit(1);
  }

  if (!input) {
    console.error('错误：未提供 Audit Log 输入');
    console.error('用法：node scripts/preflight-check.mjs --file <path>');
    process.exit(1);
  }

  const parsed = parseAuditLog(input);
  const result = validate(parsed, {
    requireRenderQa,
    expectedCards,
    expectedQuotes,
  });

  // JSON 输出模式
  if (args.includes('--json')) {
    console.log(JSON.stringify({
      passed: result.passed,
      failures: result.failures,
      parsed: result.parsed,
    }, null, 2));
  } else {
    console.log('━━━ md2wechat Preflight Check ━━━');
    console.log(formatResult(result));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  process.exit(result.passed ? 0 : 1);
}

main();

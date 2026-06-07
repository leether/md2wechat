import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseArgs, printHelp, requireArg } from "./lib/memory-lib.mjs";
import { lintWritingQuality, formatReport as formatWritingReport } from "./lint_writing_quality.mjs";
import { loadLivingMemory, formatRiskWarnings } from "../harness/memory-loader.mjs";

// ── 轻量 .env 读取（与 create_wechat_draft.mjs 的 readEnvFile 一致） ──
function readEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const pairs = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf("=");
    if (sep === -1) continue;
    const key = trimmed.slice(0, sep).trim();
    let value = trimmed.slice(sep + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    pairs[key] = value;
  }
  return pairs;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseInline(markdown) {
  const placeholders = [];
  let html = escapeHtml(markdown);

  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const token = `__CODE_${placeholders.length}__`;
    placeholders.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
  });

  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  for (let i = 0; i < placeholders.length; i += 1) {
    html = html.replace(`__CODE_${i}__`, placeholders[i]);
  }

  return html;
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function matchUnorderedList(line) {
  return String(line || "").match(/^(\s*)[-*+]\s+(.*)$/);
}

function isUnorderedList(line) {
  return Boolean(matchUnorderedList(line));
}

function matchOrderedList(line) {
  return String(line || "").match(/^(\s*)\d+\.\s+(.*)$/);
}

function isOrderedList(line) {
  return Boolean(matchOrderedList(line));
}

function lineIndent(line) {
  return String(line || "").match(/^\s*/)?.[0]?.length ?? 0;
}

function isTableRow(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.includes("|", 1);
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function looksLikeTableSeparator(line) {
  if (!isTableRow(line)) {
    return false;
  }
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function collectList(lines, startIndex, ordered, baseIndent = null) {
  const items = [];
  let index = startIndex;
  const firstMatch = ordered ? matchOrderedList(lines[startIndex]) : matchUnorderedList(lines[startIndex]);
  const listIndent = baseIndent ?? (firstMatch ? firstMatch[1].length : 0);

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const match = ordered ? matchOrderedList(line) : matchUnorderedList(line);
    if (match && match[1].length === listIndent) {
      const item = {
        text: match[2].trim(),
        children: [],
      };
      index += 1;

      while (index < lines.length) {
        const candidate = lines[index];
        const trimmed = candidate.trim();
        if (!trimmed) {
          index += 1;
          continue;
        }

        if (
          /^:::[a-zA-Z0-9_-]+(\s+.+)?$/.test(trimmed) ||
          /^(#{1,6})\s+/.test(trimmed) ||
          /^>\s?/.test(trimmed) ||
          /^-{3,}$/.test(trimmed) ||
          /^```/.test(trimmed)
        ) {
          break;
        }

        const candidateIndent = lineIndent(candidate);
        if (candidateIndent <= listIndent) {
          break;
        }

        if (isUnorderedList(candidate)) {
          const child = collectList(lines, index, false, candidateIndent);
          item.children.push(child.block);
          index = child.nextIndex;
          continue;
        }

        if (isOrderedList(candidate)) {
          const child = collectList(lines, index, true, candidateIndent);
          item.children.push(child.block);
          index = child.nextIndex;
          continue;
        }

        item.text = `${item.text} ${trimmed}`;
        index += 1;
      }

      items.push(item);
      continue;
    }
    break;
  }

  return { block: { type: ordered ? "ol" : "ul", items }, nextIndex: index };
}

function collectTable(lines, startIndex) {
  const header = splitTableRow(lines[startIndex]);
  const rows = [];
  let index = startIndex + 2;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      break;
    }
    if (!isTableRow(line) || looksLikeTableSeparator(line)) {
      break;
    }
    rows.push(splitTableRow(line));
    index += 1;
  }

  return {
    block: { type: "table", header, rows },
    nextIndex: index,
  };
}

function collectParagraph(lines, startIndex) {
  const parts = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      break;
    }

    if (
      /^:::[a-zA-Z0-9_-]+(\s+.+)?$/.test(line.trim()) ||
      /^(#{1,6})\s+/.test(line) ||
      isUnorderedList(line) ||
      isOrderedList(line) ||
      /^>\s?/.test(line) ||
      /^-{3,}$/.test(line.trim()) ||
      /^```/.test(line.trim())
    ) {
      break;
    }

    parts.push(line.trim());
    index += 1;
  }

  return { block: { type: "p", text: parts.join(" ") }, nextIndex: index };
}

function collectDirective(lines, startIndex) {
  const rawDirectiveLine = lines[startIndex].trim();
  // 支持两种语法：
  //   :::wechat-card              → directiveName = "wechat-card"
  //   :::wechat-card dark         → directiveName = "wechat-card", extra = "dark"（映射到 tone）
  const directiveMatch = rawDirectiveLine.match(/^:::([a-zA-Z0-9_-]+)(?:\s+(.+))?$/);
  if (!directiveMatch) {
    throw new Error(`Invalid directive syntax: ${rawDirectiveLine}`);
  }
  const directiveName = directiveMatch[1];
  const shorthandExtra = directiveMatch[2] || "";
  const fields = {};
  const contentLines = [];
  let index = startIndex + 1;

  const allowedFieldsByDirective = {
    "wechat-image": new Set(["src", "alt", "caption", "slot"]),
    "wechat-hero": new Set(["src", "alt", "headline", "subheadline", "kicker"]),
    "wechat-card": new Set(["title", "tone"]),
  };

  const allowedFields = allowedFieldsByDirective[directiveName];
  if (!allowedFields) {
    throw new Error(`Unsupported directive: :::${directiveName}`);
  }

  // 处理简写：:::wechat-card dark → tone: dark
  if (directiveName === "wechat-card" && shorthandExtra) {
    const toneKeywords = ["dark", "light"];
    if (toneKeywords.includes(shorthandExtra)) {
      fields.tone = shorthandExtra;
    } else {
      // 非法 tone 值，仍然当 tone 写入以便后续提示
      fields.tone = shorthandExtra;
    }
  }

  while (index < lines.length) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (line === ":::") {
      index += 1;
      break;
    }

    if (line) {
      const separator = line.indexOf(":");
      const key = separator === -1 ? "" : line.slice(0, separator).trim();
      if (separator !== -1 && allowedFields.has(key)) {
        fields[key] = line.slice(separator + 1).trim();
      } else {
        contentLines.push(rawLine);
      }
    } else {
      contentLines.push(rawLine);
    }

    index += 1;
  }

  if (directiveName === "wechat-image") {
    if (!fields.src) {
      throw new Error("Invalid :::wechat-image block: missing src");
    }

    return {
      block: {
        type: "image",
        src: fields.src,
        alt: fields.alt || "",
        caption: fields.caption || "",
        slot: fields.slot || "",
      },
      nextIndex: index,
    };
  }

  if (directiveName === "wechat-hero") {
    if (!fields.src || !fields.headline) {
      throw new Error("Invalid :::wechat-hero block: missing src or headline");
    }

    return {
      block: {
        type: "hero",
        src: fields.src,
        alt: fields.alt || "",
        kicker: fields.kicker || "",
        headline: fields.headline || "",
        subheadline: fields.subheadline || "",
      },
      nextIndex: index,
    };
  }

  return {
    block: {
      type: "card",
      title: fields.title || "",
      tone: fields.tone || "dark",
      contentLines,
    },
    nextIndex: index,
  };
}

function collectBlockquote(lines, startIndex) {
  const contentLines = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      // 空行在引用块内部：如果下一条仍是引用则保留作为段落分隔
      if (index + 1 < lines.length && /^>\s?/.test(lines[index + 1])) {
        contentLines.push("");
        index += 1;
        continue;
      }
      break;
    }

    if (!/^>\s?/.test(line)) {
      break;
    }

    contentLines.push(line.replace(/^>\s?/, ""));
    index += 1;
  }

  // 二次解析（去掉引用前缀后的内容）
  const innerMarkdown = contentLines.join("\n");
  const { blocks: innerBlocks } = parseMarkdown(innerMarkdown);

  return { block: { type: "blockquote", blocks: innerBlocks }, nextIndex: index };
}

function collectCodeBlock(lines, startIndex) {
  const openLine = lines[startIndex].trim();
  const langMatch = openLine.match(/^```(\w*)/);
  const lang = langMatch ? langMatch[1] : "";
  const codeLines = [];
  let index = startIndex + 1;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "```") {
      index += 1;
      break;
    }
    codeLines.push(line);
    index += 1;
  }

  return {
    block: { type: "code", lang, code: codeLines.join("\n") },
    nextIndex: index,
  };
}

function collectWechatImage(lines, startIndex) {
  const fields = {};
  let index = startIndex + 1;

  while (index < lines.length) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (line === ":::") {
      index += 1;
      break;
    }

    if (line) {
      const separator = line.indexOf(":");
      if (separator !== -1) {
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (key) {
          fields[key] = value;
        }
      }
    }

    index += 1;
  }

  if (!fields.src) {
    throw new Error("Invalid :::wechat-image block: missing src");
  }

  return {
    block: {
      type: "image",
      src: fields.src,
      alt: fields.alt || "",
      caption: fields.caption || "",
      slot: fields.slot || "",
    },
    nextIndex: index,
  };
}

function parseMarkdown(markdown) {
  const normalized = markdown.replace(/\r/g, "");
  const allLines = normalized.split("\n");

  // ── 提取摘要元数据 ──
  let summary = "";
  let index = 0;
  if (allLines[0] && allLines[0].startsWith("summary:")) {
    summary = allLines[0].replace(/^summary:\s*/, "").trim();
    index = 1;
    while (index < allLines.length && !allLines[index].trim()) {
      index += 1;
    }
  }

  const lines = allLines;
  const blocks = [];

  while (index < lines.length) {
    const rawLine = lines[index];
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^:::[a-zA-Z0-9_-]+(\s+.+)?$/.test(line.trim())) {
      const result = collectDirective(lines, index);
      blocks.push(result.block);
      index = result.nextIndex;
      continue;
    }

    if (/^```/.test(line.trim())) {
      const result = collectCodeBlock(lines, index);
      blocks.push(result.block);
      index = result.nextIndex;
      continue;
    }

    if (isTableRow(line) && index + 1 < lines.length && looksLikeTableSeparator(lines[index + 1])) {
      const result = collectTable(lines, index);
      blocks.push(result.block);
      index = result.nextIndex;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        depth: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    // Markdown image: ![alt](url)
    const imageMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (imageMatch) {
      blocks.push({
        type: "image",
        alt: imageMatch[1],
        src: imageMatch[2],
      });
      index += 1;
      continue;
    }

    if (isUnorderedList(line)) {
      const result = collectList(lines, index, false);
      blocks.push(result.block);
      index = result.nextIndex;
      continue;
    }

    if (isOrderedList(line)) {
      const result = collectList(lines, index, true);
      blocks.push(result.block);
      index = result.nextIndex;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const result = collectBlockquote(lines, index);
      blocks.push(result.block);
      index = result.nextIndex;
      continue;
    }

    if (/^-{3,}$/.test(line.trim())) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }

    const result = collectParagraph(lines, index);
    blocks.push(result.block);
    index = result.nextIndex;
  }

  return { blocks, summary };
}

function isStandaloneCodeParagraph(text) {
  return /^`[^`]+`[。！？.!?]?$/.test(text.trim());
}

function renderParagraph(text) {
  if (isStandaloneCodeParagraph(text)) {
    const inner = text.trim().replace(/^`|`[。！？.!?]?$/g, "");
    return [
      '<div style="margin:22px 0;padding:14px 16px;border-left:3px solid #1f2329;background:#f7f7f5;">',
      `<p style="margin:0;color:#171717;font-weight:700;line-height:1.8;">${parseInline(inner)}</p>`,
      "</div>",
    ].join("");
  }

  return `<p style="margin:0 0 18px;">${parseInline(text)}</p>`;
}

function renderImage(block) {
  const captionHtml = block.caption
    ? `<p style="margin:10px 0 0;color:#7a7f87;font-size:13px;line-height:1.8;text-align:center;">${parseInline(block.caption)}</p>`
    : "";

  return [
    '<div style="margin:30px 0 28px;">',
    `<img src="${escapeAttribute(block.src)}" alt="${escapeAttribute(block.alt || "")}" style="display:block;width:100%;height:auto;border-radius:14px;">`,
    captionHtml,
    "</div>",
  ]
    .filter(Boolean)
    .join("");
}

function parseCardContent(lines) {
  const items = [];
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("- ")) {
      const listItems = [];
      while (index < lines.length) {
        const listLine = lines[index].trim();
        if (!listLine.startsWith("- ")) {
          break;
        }
        listItems.push(listLine.replace(/^- /, "").trim());
        index += 1;
      }
      items.push({ type: "ul", items: listItems });
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length) {
      const paragraphLine = lines[index].trim();
      if (!paragraphLine) {
        break;
      }
      if (paragraphLine.startsWith("- ")) {
        break;
      }
      paragraphLines.push(paragraphLine);
      index += 1;
    }
    items.push({ type: "p", text: paragraphLines.join(" ") });
  }

  return items;
}

function renderHero(block) {
  // 微信安全：不使用 position/filter/gradient/inset
  // 改为「图片 + 深色文字卡片」上下排列，避免任何定位布局
  const kickerHtml = block.kicker
    ? `<p style="margin:0 0 10px;color:#ffe8c7;font-size:12px;font-weight:700;letter-spacing:1.4px;">${parseInline(block.kicker)}</p>`
    : "";
  const subheadlineHtml = block.subheadline
    ? `<p style="margin:12px 0 0;color:rgba(255,255,255,0.92);font-size:15px;line-height:1.75;">${parseInline(block.subheadline)}</p>`
    : "";

  return [
    '<div style="margin:0 0 28px;">',
    '<div style="overflow:hidden;border-radius:24px 24px 0 0;">',
    `<img src="${escapeAttribute(block.src)}" alt="${escapeAttribute(block.alt || "")}" style="display:block;width:100%;height:auto;">`,
    "</div>",
    '<div style="padding:22px 24px;border-radius:0 0 24px 24px;background:#1b1818;">',
    kickerHtml,
    `<h2 style="margin:0;color:#ffffff;font-size:30px;line-height:1.18;font-weight:800;letter-spacing:0.1px;">${parseInline(block.headline)}</h2>`,
    subheadlineHtml,
    "</div>",
    "</div>",
  ].join("");
}

function renderCard(block) {
  const tone = block.tone || "dark";
  const tones = {
    dark: {
      box: "margin:26px 0;padding:22px 22px 18px;border:1.5px solid rgba(132,156,255,0.9);border-radius:22px;background:#3a3333;box-shadow:0 10px 24px rgba(0,0,0,0.08);",
      title: "margin:0 0 14px;color:#e48a58;font-size:16px;line-height:1.4;font-weight:800;",
      body: "color:#ffffff;",
    },
    light: {
      box: "margin:26px 0;padding:20px 22px;border-radius:22px;background:#fff8f1;border:1px solid rgba(224,138,88,0.24);",
      title: "margin:0 0 12px;color:#d87946;font-size:16px;line-height:1.4;font-weight:800;",
      body: "color:#3b302d;",
    },
  };
  const palette = tones[tone] || tones.dark;
  const bodyItems = parseCardContent(block.contentLines)
    .map((item) => {
      if (item.type === "ul") {
        return [
          '<ul style="margin:0;padding:0;list-style:none;">',
          item.items
            .map(
              (listItem) =>
                `<li style="margin:0 0 12px;font-size:17px;line-height:1.85;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor;opacity:0.72;vertical-align:middle;margin-right:10px;"></span>${parseInline(listItem)}</li>`,
            )
            .join(""),
          "</ul>",
        ].join("");
      }

      return `<p style="margin:0 0 14px;font-size:17px;line-height:1.88;">${parseInline(item.text)}</p>`;
    })
    .join("");

  return [
    `<div style="${palette.box}">`,
    block.title ? `<p style="${palette.title}">${parseInline(block.title)}</p>` : "",
    `<div style="${palette.body}">${bodyItems}</div>`,
    "</div>",
  ]
    .filter(Boolean)
    .join("");
}

function renderListBlock(block, nestingLevel = 0, variant = "body") {
  if (variant === "summary") {
    const items = block.items
      .map((item) => `<li>${parseInline(item.text || "")}</li>`)
      .join("");
    return [
      '<p><strong>核心结论：</strong></p>',
      `<ul>${items}</ul>`,
    ].join("");
  }

  const tag = block.type === "ol" ? "ol" : "ul";
  const padding = block.type === "ol" ? `${24 - Math.min(nestingLevel, 2) * 2}px` : `${22 - Math.min(nestingLevel, 2) * 2}px`;
  const marginBottom = nestingLevel === 0 ? "18px" : "10px";
  const items = block.items
    .map((item) => {
      const childrenHtml = (item.children || [])
        .map((child) => renderListBlock(child, nestingLevel + 1, variant))
        .join("");
      return `<li style="margin:0 0 10px;color:#4d4f55;">${parseInline(item.text || "")}${childrenHtml}</li>`;
    })
    .join("");
  return `<${tag} style="margin:0 0 ${marginBottom};padding-left:${padding};font-size:16px;line-height:1.9;">${items}</${tag}>`;
}

function renderList(block, variant = "body") {
  return renderListBlock(block, 0, variant);
}

function normalizeTableCells(cells, expectedLength) {
  const normalized = [...cells];
  while (normalized.length < expectedLength) {
    normalized.push("");
  }
  return normalized.slice(0, expectedLength);
}

function renderTable(block) {
  const columnCount = Math.max(
    block.header.length,
    ...block.rows.map((row) => row.length),
  );
  if (columnCount === 0) {
    return "";
  }

  const headerCells = normalizeTableCells(block.header, columnCount)
    .map(
      (cell) =>
        `<th style="padding:12px 10px;border:1px solid rgba(208,120,74,0.24);background:#fff3ea;color:#9f5d36;font-size:14px;line-height:1.6;font-weight:800;text-align:left;vertical-align:top;">${parseInline(cell)}</th>`,
    )
    .join("");

  const bodyRows = block.rows
    .map((row, rowIndex) => {
      const background = rowIndex % 2 === 0 ? "#ffffff" : "#fffaf5";
      const cells = normalizeTableCells(row, columnCount)
        .map(
          (cell) =>
            `<td style="padding:12px 10px;border:1px solid rgba(208,120,74,0.18);background:${background};color:#3f454d;font-size:14px;line-height:1.7;vertical-align:top;">${parseInline(cell)}</td>`,
        )
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return [
    '<div style="margin:24px 0 22px;">',
    '<div style="overflow:hidden;border-radius:18px;border:1px solid rgba(208,120,74,0.18);box-shadow:0 8px 18px rgba(208,120,74,0.08);">',
    '<table style="width:100%;border-collapse:collapse;table-layout:fixed;background:#ffffff;">',
    `<thead><tr>${headerCells}</tr></thead>`,
    `<tbody>${bodyRows}</tbody>`,
    "</table>",
    "</div>",
    "</div>",
  ].join("");
}

function renderHeading(block, counters) {
  if (block.depth === 1) {
    return "";
  }

  if (block.depth === 2) {
    counters.h2 += 1;
    return [
      '<div style="margin:44px 0 22px;text-align:center;">',
      '<div style="display:inline-block;max-width:100%;padding:14px 28px;border-radius:18px;background:#d0784a;box-shadow:0 12px 24px rgba(208,120,74,0.22);">',
      `<h2 style="margin:0;color:#ffffff;font-size:25px;line-height:1.4;font-weight:800;">${parseInline(block.text)}</h2>`,
      "</div>",
      "</div>",
    ].join("");
  }

  return [
    '<div style="margin:28px 0 14px;padding:0 0 10px 12px;border-left:4px solid #d67f4f;border-bottom:1px dashed rgba(214,127,79,0.72);">',
    `<h3 style="margin:0;color:#d67f4f;font-size:18px;line-height:1.65;font-weight:800;">${parseInline(block.text)}</h3>`,
    "</div>",
  ].join("");
}

function renderBlockquote(block) {
  const innerHtml = block.blocks
    .map((b) => {
      if (b.type === "p") return renderParagraph(b.text);
      if (b.type === "ul" || b.type === "ol") return renderList(b);
      if (b.type === "blockquote") return renderBlockquote(b);
      if (b.type === "code") return renderCode(b);
      if (b.type === "table") return renderTable(b);
      if (b.type === "hr") return renderHr();
      return "";
    })
    .join("");

  return [
    '<blockquote style="margin:24px 0;padding:14px 16px;border-left:3px solid rgba(23,23,23,0.72);background:#f7f7f5;border-radius:8px;">',
    innerHtml,
    "</blockquote>",
  ].join("");
}

function renderCode(block) {
  const codeHtml = escapeHtml(block.code);
  return [
    '<div style="margin:18px 0;padding:14px 16px;background:#1b1e23;border-radius:12px;overflow-x:auto;">',
    `<pre style="margin:0;padding:0;background:transparent;"><code style="font-size:14px;line-height:1.7;color:#e6e6e6;white-space:pre;">${codeHtml}</code></pre>`,
    "</div>",
  ].join("");
}

function renderHr() {
  return '<div style="margin:32px auto;width:72px;height:1px;background:rgba(23,23,23,0.14);"></div>';
}

// ── Markdown 源码级指令校验 ──────────────────────────────────────
// 检测以 ::: 开头但可能未被正确解析的指令行
function lintMarkdownDirectives(markdown) {
  const warnings = [];
  const lines = markdown.replace(/\r/g, "").split("\n");

  // 已知指令名
  const knownDirectives = new Set(["wechat-image", "wechat-hero", "wechat-card"]);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // 匹配 :::xxx 或 :::xxx yyy 格式
    const directiveMatch = trimmed.match(/^:::([a-zA-Z0-9_-]+)(?:\s+(.+))?$/);
    if (!directiveMatch) continue;

    const directiveName = directiveMatch[1];
    const extra = directiveMatch[2] || "";

    if (!knownDirectives.has(directiveName)) {
      warnings.push({
        line: i + 1,
        rule: `未知指令 :::${directiveName}，可能拼写错误或缺少支持`,
        source: trimmed,
      });
      continue;
    }

    // 检查 :::wechat-card 后面的简写 tone 是否合法
    if (directiveName === "wechat-card" && extra) {
      const validTones = ["dark", "light"];
      if (!validTones.includes(extra)) {
        warnings.push({
          line: i + 1,
          rule: `:::wechat-card 简写 tone 值 "${extra}" 不是合法值（应为 dark 或 light）`,
          source: trimmed,
        });
      }
    }

    // 检查 :::wechat-hero / :::wechat-image 后面是否有额外内容（不支持简写）
    if ((directiveName === "wechat-hero" || directiveName === "wechat-image") && extra) {
      warnings.push({
        line: i + 1,
        rule: `:::${directiveName} 不支持行内简写，多余内容 "${extra}" 会被忽略`,
        source: trimmed,
      });
    }

    // 检查缺少关闭 ::: 的指令块
    if (knownDirectives.has(directiveName)) {
      let foundClose = false;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === ":::") {
          foundClose = true;
          break;
        }
        // 遇到另一个指令开始，说明当前块未关闭
        if (/^:::[a-zA-Z0-9_-]+/.test(lines[j].trim())) {
          break;
        }
      }
      if (!foundClose) {
        warnings.push({
          line: i + 1,
          rule: `:::${directiveName} 缺少关闭标记 :::`,
          source: trimmed,
        });
      }
    }
  }

  return warnings;
}

function formatDirectiveLintReport(warnings) {
  if (warnings.length === 0) {
    return "✅ Markdown 指令格式校验通过";
  }
  const lines = ["⚠️ Markdown 指令格式校验发现以下问题："];
  for (const w of warnings) {
    lines.push(`   🟡 第 ${w.line} 行：${w.rule}`);
    lines.push(`      ${w.source}`);
  }
  return lines.join("\n");
}

function renderFooter(options) {
  if (!options.footerNote && !options.footerCta && !options.footerQrSrc) {
    return "";
  }

  const sections = [renderHr(), '<div style="margin:0;padding-top:6px;text-align:center;">'];

  if (options.footerNote) {
    sections.push(
      `<p style="margin:0 0 10px;color:#8b8f97;font-size:15px;line-height:1.9;">${parseInline(options.footerNote)}</p>`,
    );
  }

  if (options.footerQrTitle) {
    sections.push(
      `<p style="margin:0 0 12px;color:#23252b;font-size:18px;line-height:1.7;font-weight:800;">${parseInline(options.footerQrTitle)}</p>`,
    );
  }

  if (options.footerQrSrc) {
    sections.push(
      [
        '<div style="margin:0 auto 12px;max-width:240px;">',
        `<img src="${escapeAttribute(options.footerQrSrc)}" alt="${escapeAttribute(options.footerQrAlt || "")}" style="display:block;width:100%;height:auto;border-radius:16px;box-shadow:0 10px 24px rgba(0,0,0,0.08);">`,
        "</div>",
      ].join(""),
    );
  }

  if (options.footerCta) {
    sections.push(
      `<p style="margin:0 0 8px;color:#4b4f56;font-size:15px;line-height:1.9;">${parseInline(options.footerCta)}</p>`,
    );
  }

  if (options.footerQrHint) {
    sections.push(
      `<p style="margin:0;color:#8b8f97;font-size:14px;line-height:1.85;">${parseInline(options.footerQrHint)}</p>`,
    );
  }

  sections.push("</div>");
  return sections.join("");
}

function splitPrelude(blocks) {
  const filtered = blocks.filter((block) => !(block.type === "heading" && block.depth === 1));
  const firstH2Index = filtered.findIndex((block) => block.type === "heading" && block.depth === 2);

  if (firstH2Index === -1) {
    return { prelude: filtered, rest: [] };
  }

  return {
    prelude: filtered.slice(0, firstH2Index),
    rest: filtered.slice(firstH2Index),
  };
}

function renderPrelude(prelude, options) {
  if (!prelude.length && !options.kicker) {
    return "";
  }

  const hasHero = prelude.some((block) => block.type === "hero");
  const leadParagraphs = [];
  const bodyPieces = [];

  for (const block of prelude) {
    if (block.type === "p") {
      if (!hasHero && leadParagraphs.length < 2) {
        leadParagraphs.push(block.text);
      } else {
        bodyPieces.push(renderParagraph(block.text));
      }
    } else if (block.type === "image") {
      bodyPieces.push(renderImage(block));
    } else if (block.type === "hero") {
      bodyPieces.push(renderHero(block));
    } else if (block.type === "card") {
      bodyPieces.push(renderCard(block));
    } else if (block.type === "ul" || block.type === "ol") {
      bodyPieces.push(renderList(block, "summary"));
    } else if (block.type === "table") {
      bodyPieces.push(renderTable(block));
    } else if (block.type === "blockquote") {
      bodyPieces.push(renderBlockquote(block));
    } else if (block.type === "code") {
      bodyPieces.push(renderCode(block));
    } else if (block.type === "hr") {
      bodyPieces.push(renderHr());
    }
  }

  const heroBits = [];
  if (leadParagraphs[0]) {
    heroBits.push(
      `<div style="margin:0 0 10px;"><p style="margin:0;color:#171717;font-size:30px;line-height:1.38;font-weight:800;">${parseInline(leadParagraphs[0])}</p></div>`,
    );
  }
  if (leadParagraphs[1]) {
    heroBits.push(
      `<div><p style="margin:0;color:#4b4f56;font-size:18px;line-height:1.9;">${parseInline(leadParagraphs[1])}</p></div>`,
    );
  }

  const heroSection = heroBits.length
    ? [
        '<div style="margin:0 0 18px;">',
        heroBits.join(""),
        "</div>",
      ].join("")
    : "";

  const kickerMarkup = options.kicker
    ? [
        '<div style="margin:0 0 16px;">',
        `<p style="margin:0;color:#7b8088;font-size:12px;letter-spacing:1.6px;font-weight:700;">${escapeHtml(options.kicker)}</p>`,
        "</div>",
      ].join("")
    : "";

  return `<div style="margin:0 0 34px;">${kickerMarkup}${heroSection}${bodyPieces.join("")}</div>`;
}

function renderBody(blocks, options) {
  const counters = { h2: 0 };
  const sections = [];
  const { prelude, rest } = splitPrelude(blocks);

  sections.push('<div style="color:#4b4f56;font-size:17px;line-height:1.95;">');
  sections.push(renderPrelude(prelude, options));

  for (const block of rest) {
    if (block.type === "heading") {
      sections.push(renderHeading(block, counters));
      continue;
    }
    if (block.type === "p") {
      sections.push(renderParagraph(block.text));
      continue;
    }
    if (block.type === "image") {
      sections.push(renderImage(block));
      continue;
    }
    if (block.type === "hero") {
      sections.push(renderHero(block));
      continue;
    }
    if (block.type === "card") {
      sections.push(renderCard(block));
      continue;
    }
    if (block.type === "ul" || block.type === "ol") {
      sections.push(renderList(block));
      continue;
    }
    if (block.type === "table") {
      sections.push(renderTable(block));
      continue;
    }
    if (block.type === "blockquote") {
      sections.push(renderBlockquote(block));
      continue;
    }
    if (block.type === "code") {
      sections.push(renderCode(block));
      continue;
    }
    if (block.type === "hr") {
      sections.push(renderHr());
    }
  }

  const footerHtml = renderFooter(options);
  if (footerHtml) {
    sections.push(footerHtml);
  }

  sections.push("</div>");
  return sections.filter(Boolean).join("\n");
}

function buildHtmlDocument(bodyContent) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>微信公众号文章</title>
</head>
<body style="margin:0;background:#ffffff;padding:20px 16px 28px;">
  <!-- ⚠️ 标题请在微信公众号编辑器中单独填写，HTML 中已自动移除 H1 标题 -->
  <div style="max-width:677px;margin:0 auto;">
${bodyContent}
  </div>
</body>
</html>
`;
}

// ── 微信 HTML 白名单校验 ──────────────────────────────────────
// 扫描渲染后的 HTML，检测会被微信过滤的属性和标签
function lintWechatHtml(html) {
  const errors = [];
  const warnings = [];

  // ── 提取所有 style="..." 属性值，只对这些值做 CSS 属性检查 ──
  // 避免误报正文文字中出现的 CSS 属性名（如 "被 position: absolute 背刺"）
  const styleValues = [];
  const styleRegex = /style="([^"]*)"/gi;
  let styleMatch;
  while ((styleMatch = styleRegex.exec(html)) !== null) {
    styleValues.push(styleMatch[1]);
  }
  const allStyleValues = styleValues.join("\n");

  // ── 致命错误（会被微信直接删除） ──

  // CSS 属性类规则：只在 style 属性值中检查
  const fatalStyleRules = [
    { pattern: /position\s*:\s*(absolute|fixed|sticky)/gi, desc: "position:absolute/fixed/sticky 会被微信删除" },
    { pattern: /position\s*:\s*relative/gi, desc: "position:relative 可能被微信删除" },
    { pattern: /filter\s*:/gi, desc: "filter 属性兼容性不稳定，可能被删除" },
    { pattern: /linear-gradient|radial-gradient/gi, desc: "渐变背景兼容性不确定，Dark Mode 下会被转纯色" },
    { pattern: /inset\s*:/gi, desc: "inset CSS 简写在微信中兼容性未知" },
    { pattern: /!important/gi, desc: "!important 会干扰微信 Dark Mode 算法" },
    { pattern: /font-family/gi, desc: "自定义 font-family 不推荐，iOS 17+ 有字间距差异" },
    { pattern: /transform\s*:/gi, desc: "transform 兼容性不稳定，transform-origin 在 iOS 无效" },
    { pattern: /animation\s*:/gi, desc: "CSS animation 在微信中支持有限" },
    { pattern: /transition\s*:/gi, desc: "CSS transition 在微信中支持有限" },
    { pattern: /calc\s*\(/gi, desc: "calc() 在微信中不稳定" },
  ];

  // 标签/属性类规则：在整个 HTML 中检查（不会误报正文文字）
  const fatalTagRules = [
    { pattern: /<style[\s>]/gi, desc: "<style> 标签会被微信删除，只能用内联 style" },
    { pattern: /<script[\s>]/gi, desc: "<script> 标签会被微信删除" },
    { pattern: /\bon\w+\s*=/gi, desc: "事件属性（onclick 等）会被微信剥除" },
    { pattern: /<iframe[\s>]/gi, desc: "<iframe> 会被微信删除（仅腾讯视频源例外）" },
    { pattern: /<form[\s>]/gi, desc: "<form> 会被微信删除" },
    { pattern: /<input[\s>]/gi, desc: "<input> 会被微信删除" },
    { pattern: /\bid\s*=/gi, desc: "id 属性会被微信删除" },
  ];

  // 对 style 属性值做 CSS 规则检查
  for (const rule of fatalStyleRules) {
    rule.pattern.lastIndex = 0;
    const matches = allStyleValues.match(rule.pattern);
    if (matches) {
      // position:relative 降级为警告而非致命错误
      if (/position\s*:\s*relative/i.test(matches[0])) {
        warnings.push({ rule: rule.desc, count: matches.length });
      } else {
        errors.push({ rule: rule.desc, count: matches.length });
      }
    }
  }

  // 对整个 HTML 做标签/属性检查
  for (const rule of fatalTagRules) {
    rule.pattern.lastIndex = 0;
    const matches = html.match(rule.pattern);
    if (matches) {
      // id= 和 事件属性 不在 style 里，降级为警告（实际影响较小）
      if (/\bid\s*=/.test(rule.pattern.source) || /\bon\w+\s*=/.test(rule.pattern.source)) {
        warnings.push({ rule: rule.desc, count: matches.length });
      } else {
        errors.push({ rule: rule.desc, count: matches.length });
      }
    }
  }

  return { errors, warnings, passed: errors.length === 0 };
}

function formatLintReport(result) {
  const lines = [];
  if (result.passed) {
    lines.push("✅ 微信 HTML 校验通过（无致命错误）");
  } else {
    lines.push("❌ 微信 HTML 校验未通过，发现以下致命问题：");
    for (const err of result.errors) {
      lines.push(`   🔴 ${err.rule} (×${err.count})`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("⚠️ 兼容性警告：");
    for (const warn of result.warnings) {
      lines.push(`   🟡 ${warn.rule} (×${warn.count})`);
    }
  }
  return lines.join("\n");
}

// ── GEO 合规检查（Generative Engine Optimization） ──

function lintGeoCompliance(markdown, title = "") {
  const l1 = [];
  const l2 = [];

  // L1: 摘要缺失
  const summaryMatch = markdown.match(/^summary:\s*(.+)/m);
  if (!summaryMatch) {
    l1.push("MD 第一行缺少 summary: xxx，AI 搜索无法提取文章摘要");
  } else {
    const summary = summaryMatch[1].trim();

    // L2: 摘要过短
    if (summary.length < 20) {
      l2.push(`摘要过短（${summary.length}字），建议加入具体结论或数据`);
    }

    // L2: 摘要无数据（缺少数字、列表标记或判断词）
    const hasData = /\d/.test(summary);
    const hasList = /[①②③④⑤⑥⑦⑧⑨⑩]|\d+\./.test(summary);
    const hasConclusion = /是|为|等于|在于|核心|关键|本质|最|第一|首先/.test(summary);
    if (!hasData && !hasList && !hasConclusion) {
      l2.push("摘要过于概括，缺少可被 AI 引用的具体结论或数据（建议加入数字、步骤或判断词）");
    }
  }

  // L1: 标题检查
  if (!title || title.trim().length === 0) {
    l1.push("缺少文章标题，请使用 --title <text> 指定，或在文件名中体现");
  } else {
    const t = title.trim();
    if (t.length > 30) {
      l1.push(`标题过长（${t.length}字），微信标题限制 30 字，建议精简`);
    }
    // L2: 标题过短或疑似纯文件名
    if (t.length < 8) {
      l2.push(`标题过短（${t.length}字），建议包含核心搜索词以提升 AI 发现概率`);
    }
    // 检查是否像无意义的文件名（全小写、无中文）
    if (/^[a-z0-9\s]+$/.test(t)) {
      l2.push("标题疑似从文件名推断，缺少中文搜索词，建议用 --title 指定语义明确的标题");
    }
  }

  // L1: 零结构化
  const hasListStructure = /(^|\n)\s*[-*]\s+/.test(markdown) || /:::wechat-card/.test(markdown);
  if (!hasListStructure) {
    l1.push("正文中缺少列表结构（卡片列表或 - 列表），AI 无法结构化提取内容");
  }

  // L2: H2 过于模糊
  const h2Titles = [...markdown.matchAll(/^##\s+(.+)$/gm)].map(m => m[1].trim());
  const vagueWords = ["感悟", "随笔", "碎碎念", "杂谈", "心情", "随想", "漫谈", "有感", "杂感"];
  for (const title of h2Titles) {
    const isVague = vagueWords.some(w => title.includes(w));
    if (isVague) {
      l2.push(`H2 标题"${title}"过于模糊，建议包含具体主题或搜索词`);
    }
  }

  // L2: 零引用块
  const hasBlockquote = /(^|\n)\s*>/.test(markdown);
  if (!hasBlockquote) {
    l2.push("缺少引用块（>），建议至少添加一个可被 AI 引用的核心观点");
  }

  // L2: 零卡片
  const hasCards = /:::wechat-card/.test(markdown);
  if (!hasCards) {
    l2.push("缺少卡片结构（:::wechat-card），建议用卡片呈现核心论点");
  }

  return { l1, l2 };
}

function formatGeoReport(result) {
  const lines = ["━━━ GEO 合规检查报告 ━━━", ""];

  if (result.l1.length === 0) {
    lines.push("L1 硬性规则 ✅");
    lines.push("  全部通过 ✅");
  } else {
    lines.push("L1 硬性规则 ❌");
    for (const item of result.l1) {
      lines.push(`  ❌ ${item}`);
    }
  }

  lines.push("");

  if (result.l2.length === 0) {
    lines.push("L2 GEO 建议 ✅");
    lines.push("  全部通过 ✅");
  } else {
    lines.push("L2 GEO 建议 ⚠️");
    for (const item of result.l2) {
      lines.push(`  ⚠️ ${item}`);
    }
  }

  lines.push("");

  const passed = result.l1.length === 0;
  const hasL2 = result.l2.length > 0;
  if (passed && !hasL2) {
    lines.push("总评: ✅ 通过");
  } else if (passed && hasL2) {
    lines.push(`总评: ⚠️ 通过（${result.l2.length} 个 L2 警告）`);
  } else {
    lines.push(`总评: ❌ 未通过（${result.l1.length} 处硬性违规）`);
  }

  return lines.join("\n");
}

export function renderWechatEditorial(markdown, options = {}) {
  const { blocks, summary } = parseMarkdown(markdown);
  const bodyContent = renderBody(blocks, {
    kicker: options.kicker || "",
    footerNote: options.footerNote || "",
    footerCta: options.footerCta || "",
    footerQrSrc: options.footerQrSrc || "",
    footerQrAlt: options.footerQrAlt || "",
    footerQrTitle: options.footerQrTitle || "",
    footerQrHint: options.footerQrHint || "",
  });
  let html = buildHtmlDocument(bodyContent);
  if (summary) {
    html = html.replace("<body", `<!-- WECHAT_SUMMARY: ${escapeHtml(summary)} -->\n<body`);
  }
  return html;
}

function detectCtaSignals(markdown) {
  const lines = markdown.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,6}\s*(最后|结语|加入我们|关注我们|关于我们|联系|总结|结论)/i.test(trimmed)) {
      return true;
    }
  }

  if (/\b(扫码|二维码|交流群|关注.*公众号|加入我们)\b/i.test(markdown)) {
    return true;
  }

  const tail = markdown.slice(-400);
  if (/\b(点赞|在看|转发|星标|关注|加入|我们下次再见|谢谢你看|觉得不错|推荐|欢迎|留言)\b/i.test(tail)) {
    return true;
  }

  return false;
}

function normalizeOutputPath(inputPath, explicitOutput) {
  if (explicitOutput) {
    return path.resolve(process.cwd(), explicitOutput);
  }

  const absoluteInput = path.resolve(process.cwd(), inputPath);
  const ext = path.extname(absoluteInput);
  return absoluteInput.slice(0, absoluteInput.length - ext.length) + ".html";
}

function writeLintReportOut(lintReport, outPath) {
  if (!outPath) return;
  const absPath = path.resolve(process.cwd(), outPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(lintReport, null, 2));
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.help) {
    printHelp([
      "Usage: node scripts/render_wechat_editorial.mjs --input <file.md> [options]",
      "",
      "Options:",
      "  --input <path>         Source markdown file",
      "  --output <path>        Output HTML file",
      "  --title <text>         Article title for GEO lint (overrides filename inference)",
      "  --kicker <text>        Small centered line above the opening section",
      "  --footer-note <text>   Small centered footer note",
      "  --footer-cta <text>    Small centered CTA line",
      "  --footer-qr <path>     Footer QR image path (overrides .env FOOTER_QR_PATH)",
      "  --footer-qr-alt <text> Footer QR alt text",
      "  --footer-qr-title <text> Footer QR title (overrides .env FOOTER_QR_TITLE)",
      "  --footer-qr-hint <text> Footer QR hint (overrides .env FOOTER_QR_HINT)",
      "  --no-footer            Skip CTA/footer check (use when article has no QR)",
      "  --env <path>           Override .env path (default: .env in cwd)",
      "  --no-writing-lint      Skip writing quality lint (L1 banned words/punctuation)",
      "  --writing-rules <path> Custom rules.json path (default: references/khazix-writer/rules.json)",
      "  --strict-writing       Treat L2 warnings as errors",
      "  --no-geo-lint          Skip GEO compliance lint (summary/structure/AI-readability)",
      "  --strict-geo           Treat GEO L2 warnings as errors",
      "  --no-preflight         Skip local preflight after rendering (not recommended)",
      "  --lint-report-out <path> Write structured lint results to JSON file",
      "  --help                 Show help",
    ]);
    return 0;
  }

  const inputPath = requireArg(args, "input", "Missing required argument --input <file.md>");
  const absoluteInput = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(absoluteInput)) {
    throw new Error(`Input markdown not found: ${absoluteInput}`);
  }

  const outputPath = normalizeOutputPath(inputPath, args.output);
  const markdown = fs.readFileSync(absoluteInput, "utf8");

  // ── 活记忆风险提示（自动加载历史教训） ──
  const livingMemory = loadLivingMemory();
  const riskWarnings = formatRiskWarnings(livingMemory);
  if (riskWarnings) {
    console.log(riskWarnings);
  }

  // 初始化 lint 报告收集器
  const lintReport = {
    version: "1.0",
    timestamp: new Date().toISOString(),
    source: absoluteInput,
    writing: null,
    geo: null,
    markdownDirectives: null,
    wechatHtml: null,
  };
  const lintReportOut = args["lint-report-out"] ? String(args["lint-report-out"]) : "";

  // 推断标题：命令行 > 文件名
  const inferredTitle = args.title
    ? String(args.title)
    : path.basename(absoluteInput, path.extname(absoluteInput)).replace(/[-_]/g, " ");

  // ── 读取 .env 中的 footer 配置（命令行参数优先） ──
  const envPath = args.env
    ? path.resolve(process.cwd(), args.env)
    : path.resolve(process.cwd(), ".env");
  const envFromFile = readEnvFile(envPath);

  // ── CTA 护栏：检测到二维码/扫码/交流群信号时的处理 ──
  // 命令行 > .env 配置 > 无 footer（降级警告）
  const footerQr = args["footer-qr"] || envFromFile.FOOTER_QR_PATH || "";
  const footerCta = args["footer-cta"] || envFromFile.FOOTER_CTA || "";
  const footerQrTitle = args["footer-qr-title"] || envFromFile.FOOTER_QR_TITLE || "";
  const footerQrHint = args["footer-qr-hint"] || envFromFile.FOOTER_QR_HINT || "";

  const hasCta = detectCtaSignals(markdown);
  const hasFooterQr = Boolean(footerQr);
  if (hasCta && !hasFooterQr && !args["no-footer"]) {
    // 有 CTA 信号但没有配置 footer → 降级为警告而非报错
    // 原因：开源用户可能不需要尾部二维码，不应该阻止渲染
    console.warn(
      `⚠️  CTA 护栏警告：检测到 Markdown 中包含 CTA/二维码/交流群等信号，但未配置 footer。\n` +
      `   - 命令行：--footer-qr <path> [--footer-cta <text>] [--footer-qr-title <text>] [--footer-qr-hint <text>]\n` +
      `   - .env：FOOTER_QR_PATH / FOOTER_CTA / FOOTER_QR_TITLE / FOOTER_QR_HINT\n` +
      `   - 跳过检查：--no-footer\n` +
      `   文章将不带尾部 footer 继续渲染。`,
    );
  }

  // ── 写作质量质检（基于 khazix-writer 四层质控体系） ──
  if (!args["no-writing-lint"]) {
    const writingRulesPath = args["writing-rules"] || undefined;
    const writingResult = lintWritingQuality(markdown, writingRulesPath, {
      strict: args["strict-writing"],
    });
    lintReport.writing = {
      passed: writingResult.passed,
      l1Passed: writingResult.l1?.passed ?? true,
      l1Hits: writingResult.l1?.totalHits ?? 0,
      l2Passed: writingResult.l2?.passed ?? true,
      l2Warnings: writingResult.l2?.warnings?.length ?? 0,
      skipped: writingResult.skipped || false,
    };
    console.log(formatWritingReport(writingResult));
    if (!writingResult.passed) {
      writeLintReportOut(lintReport, lintReportOut);
      throw new Error(
        `❌ 渲染被拦截：写作质量 L1 检查未通过（${writingResult.l1.totalHits}处硬性违规）。\n` +
        `   请修复上方报告中的 L1 问题后重新渲染。\n` +
        `   如需跳过写作质检，使用 --no-writing-lint 参数。`,
      );
    }
  } else {
    lintReport.writing = { skipped: true };
  }

  // ── GEO 合规检查（生成式引擎优化） ──
  if (!args["no-geo-lint"]) {
    const geoResult = lintGeoCompliance(markdown, inferredTitle);
    const geoPassed = geoResult.l1.length === 0 && !(args["strict-geo"] && geoResult.l2.length > 0);
    lintReport.geo = {
      passed: geoPassed,
      l1Passed: geoResult.l1.length === 0,
      l1Count: geoResult.l1.length,
      l2Count: geoResult.l2.length,
      strict: args["strict-geo"] || false,
    };
    console.log(formatGeoReport(geoResult));
    if (!geoPassed) {
      writeLintReportOut(lintReport, lintReportOut);
      const level = args["strict-geo"] ? "L1/L2" : "L1";
      throw new Error(
        `❌ 渲染被拦截：GEO 合规 ${level} 检查未通过。\n` +
        `   请修复上方报告中的问题后重新渲染。\n` +
        `   如需跳过 GEO 检查，使用 --no-geo-lint 参数。`,
      );
    }
  } else {
    lintReport.geo = { skipped: true };
  }

  const html = renderWechatEditorial(markdown, {
    kicker: args.kicker ? String(args.kicker) : "",
    footerNote: args["footer-note"] ? String(args["footer-note"]) : "",
    footerCta: footerCta,
    footerQrSrc: footerQr,
    footerQrAlt: args["footer-qr-alt"] ? String(args["footer-qr-alt"]) : "",
    footerQrTitle: footerQrTitle,
    footerQrHint: footerQrHint,
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html);

  // 渲染前先做 Markdown 源码级指令校验
  const directiveWarnings = lintMarkdownDirectives(markdown);
  lintReport.markdownDirectives = {
    passed: directiveWarnings.length === 0,
    warningCount: directiveWarnings.length,
    warnings: directiveWarnings.map((w) => ({ line: w.line, rule: w.rule })),
  };
  console.log(formatDirectiveLintReport(directiveWarnings));
  if (directiveWarnings.length > 0) {
    console.error("\n⚠️  Markdown 源码中存在指令格式问题，部分卡片可能未正确渲染。");
  }

  // 渲染后自动校验微信 HTML 合规性
  const lintResult = lintWechatHtml(html);
  lintReport.wechatHtml = {
    passed: lintResult.passed,
    errorCount: lintResult.errors.length,
    warningCount: lintResult.warnings.length,
    errors: lintResult.errors,
    warnings: lintResult.warnings,
  };
  console.log(outputPath);
  console.log(formatLintReport(lintResult));

  if (!lintResult.passed) {
    console.error("\n⚠️  输出 HTML 包含微信会过滤的内容，请检查上方致命错误列表。");
  }

  // 写入结构化 lint 报告（供 create_wechat_draft.mjs 读取合并到 Audit Log）
  writeLintReportOut(lintReport, lintReportOut);

  // ── 自动调用本地 preflight（完整闭环） ──
  if (!args["no-preflight"]) {
    const preflightScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../harness/preflight.mjs");
    if (fs.existsSync(preflightScript)) {
      console.log("\n🔍 自动调用本地 preflight...");
      const preflightResult = spawnSync(
        process.execPath,
        [preflightScript, "--html", outputPath, "--md", absoluteInput, "--json"],
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      );
      let preflightReport;
      try {
        preflightReport = JSON.parse(preflightResult.stdout);
      } catch {
        preflightReport = { ok: false, error: "Failed to parse preflight output", raw: preflightResult.stdout };
      }
      if (!preflightReport.ok) {
        console.error("\n❌ Preflight 检查未通过，推送被阻断。请修复上方问题后重新渲染。");
        console.error("   如需跳过 preflight，使用 --no-preflight 参数（不推荐）。");
        return 3;
      }
      console.log("✅ Preflight 通过。");
    } else {
      console.warn("⚠️  preflight.mjs 未找到，跳过自动检查。");
    }
  }

  return lintResult.passed ? 0 : 2;
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

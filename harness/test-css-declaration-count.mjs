#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { countCssDeclarations as countInPreflight, runPreflight } from "./preflight.mjs";
import {
  analyzeDraftContent,
  countCssDeclarations as countInDraftVerifier,
} from "../scripts/create_wechat_draft.mjs";

// 取自真实误报（2026-11）：参考文献英文标题里的 "predisposition:" 含子串 "position:"，
// 旧的裸字符串匹配把它数成了 1 处 position 样式。
const REF_WITH_PREDISPOSITION =
  '<li style="margin:0;color:#4d4f55;">Schultz KAP, et al. DICER1-related tumor predisposition: identification of at-risk individuals. <em>Clin Cancer Res</em> 30, 5681-5692 (2024).</li>';

const cases = [
  ["style 内 position:absolute", '<div style="position:absolute;top:0">x</div>', "position", 1],
  ["style 内冒号后带空格", '<section style="position: absolute">x</section>', "position", 1],
  ["分号之后的 position:fixed", '<p style="color:red;position:fixed">x</p>', "position", 1],
  ["冒号前带空格的 position :relative", '<p style="color:red; position :relative">x</p>', "position", 1],
  ["单引号属性值", "<div style='position:sticky'>x</div>", "position", 1],
  ["同一段 HTML 两处违规", '<div style="position:absolute"></div><span style="position:relative"></span>', "position", 2],
  ["参考文献标题 predisposition: 不是样式", REF_WITH_PREDISPOSITION, "position", 0],
  ["正文里的 disposition:", "<p>tumor disposition: a review</p>", "position", 0],
  ["标签属性值里的 predisposition:", '<li title="tumor predisposition: identification">x</li>', "position", 0],
  ["没有任何样式", "<p>plain text</p>", "position", 0],
  ["filter 真实违规", '<div style="filter:blur(2px)">x</div>', "filter", 1],
  ["filter 正文英文", "<p>high-pass filter: design</p>", "filter", 0],
];

for (const [name, html, property, expected] of cases) {
  assert.equal(countInPreflight(html, property), expected, `preflight: ${name}`);
  assert.equal(countInDraftVerifier(html, property), expected, `create_wechat_draft: ${name}`);
}

// 端到端：推送后回检（这个函数运行在 relay 上，结果写进 audit.log）
const cleanDraft = analyzeDraftContent(`<ol>${REF_WITH_PREDISPOSITION}</ol>`);
assert.equal(cleanDraft.positionCount, 0);
assert.equal(cleanDraft.filterCount, 0);
const dirtyDraft = analyzeDraftContent(`<div style="position:absolute">${REF_WITH_PREDISPOSITION}</div>`);
assert.equal(dirtyDraft.positionCount, 1);

// 端到端：本地 preflight（推送前阻断）
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "md2wechat-css-count-"));
try {
  const mdPath = path.join(tmpRoot, "article.md");
  fs.writeFileSync(mdPath, "---\nno_image: true\n---\n\n扫码加入讨论。", "utf8");
  let seq = 0;
  const run = async (body) => {
    const htmlPath = path.join(tmpRoot, `article-${seq++}.html`);
    fs.writeFileSync(htmlPath, `<html><body>${body}</body></html>`, "utf8");
    return runPreflight({ htmlPath, mdPath, allowLocalImagePaths: true, skipImageCheck: true });
  };

  const clean = await run(`<ol>${REF_WITH_PREDISPOSITION}</ol>`);
  assert.equal(clean.l1.failures.some((item) => item.id === "html_compliance"), false);

  const dirty = await run('<p style="position:absolute">x</p>');
  assert.equal(dirty.ok, false);
  assert.equal(dirty.l1.failures.some((item) => item.id === "html_compliance"), true);
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log("CSS declaration count tests passed.");

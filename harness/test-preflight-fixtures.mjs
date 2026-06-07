#!/usr/bin/env node
import assert from "node:assert/strict";
import { countMarkdownTables, countWechatCardDirectives } from "./preflight.mjs";
import { extractPreciseNumbers, htmlToVisibleText } from "./agents/source-verification.mjs";

const markdown = `
\`\`\`markdown
:::wechat-card
| fake | table |
|------|-------|
\`\`\`

Inline code should not count: \`:::wechat-card\`.

:::wechat-card
title: Real card
- body
:::

| A | B |
|---|---|
| 1 | 2 |

:::wechat-card
title: Card with ignored table
| Hidden | Table |
|--------|-------|
:::
`;

assert.equal(countWechatCardDirectives(markdown), 2);
assert.equal(countMarkdownTables(markdown), 1);

const html = `
<html>
  <head>
    <style>.metric { width: 320px } .fake::after { content: "99.9%" }</style>
    <script>window.fakeVersion = "v9.9.9";</script>
  </head>
  <body>
    <p>Visible conversion improved by 23.5% in v2.1.</p>
  </body>
</html>`;

const visible = htmlToVisibleText(html);
assert.equal(visible.includes("99.9%"), false);
assert.equal(visible.includes("v9.9.9"), false);
assert.equal(visible.includes("23.5%"), true);

const values = extractPreciseNumbers(visible).map((n) => n.value);
assert.equal(values.includes("23.5%"), true);
assert.equal(values.includes("v2.1"), true);
assert.equal(values.includes("99.9%"), false);
assert.equal(values.includes("v9.9.9"), false);

console.log("Preflight fixture tests passed.");

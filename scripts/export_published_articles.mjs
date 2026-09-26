#!/usr/bin/env node
// 导出公众号「已发表」全量文章列表（appmsgpublish 后台接口，含已删除标记与阅读数快照）。
//
// 原理（借鉴高星 repo wechat-article/wechat-article-exporter 的 mp 平台登录路线）：
//   在持久化 Playwright Chromium 会话里，用同源页内 fetch 调
//   /cgi-bin/appmsgpublish?sub=list_ex&begin=N&count=M&token=T&f=json&ajax=1
//   页内 fetch 自动携带完整 cookie + 指纹，绕过 curl 直调的会话绑定校验（ret 200003 invalid session）。
//
// 用法：
//   node scripts/export_published_articles.mjs --login --out published.json   # 首次/会话过期：开可见浏览器等扫码
//   node scripts/export_published_articles.mjs --out published.json           # 日常：headless 直拉
//
// 会话目录：<repo>/.mp-session/（cookie 长效；失效时重跑 --login）。
// 注意：接口路径是 /cgi-bin/appmsgpublish（/misc/appmsgpublish 在当前后台版本 404，2026-09-26 实测）。

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, "..", ".mp-session");
const HOME_URL = "https://mp.weixin.qq.com/";
const API = "https://mp.weixin.qq.com/cgi-bin/appmsgpublish";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--login") args.login = true;
    else if (k === "--out") args.out = argv[++i];
    else if (k === "--count") args.count = Number(argv[++i]);
  }
  args.out = args.out || "published-articles.json";
  args.count = Math.min(args.count || 10, 10); // 后台单页上限 10（实测）
  return args;
}

function extractToken(url) {
  const m = /[?&]token=(\d+)/.exec(url || "");
  return m ? m[1] : null;
}

function flatten(pageJson) {
  const items = [];
  for (const it of pageJson.publish_list || []) {
    let info;
    try { info = JSON.parse(it.publish_info); } catch { continue; }
    const t = info?.sent_info?.time;
    const time = t ? new Date(t * 1000).toLocaleString("sv-GB", { timeZone: "Asia/Shanghai" }).replace(" ", " ") : null;
    const arts = info?.appmsg_info || [];
    if (!arts.length) {
      items.push({ title: "(群发/非图文)", time, publish_type: it.publish_type, is_deleted: null, read_num: null, like_num: null, link: "", appmsgid: null });
      continue;
    }
    for (const a of arts) {
      items.push({
        title: a.title, time, publish_type: it.publish_type,
        is_deleted: a.is_deleted, read_num: a.read_num, like_num: a.like_num, old_like_num: a.old_like_num,
        link: (a.content_url || "").replace(/\\\//g, "/"), appmsgid: a.appmsgid,
      });
    }
  }
  return items;
}

const args = parseArgs(process.argv);
fs.mkdirSync(SESSION_DIR, { recursive: true });
const ctx = await chromium.launchPersistentContext(SESSION_DIR, {
  headless: !args.login,
  viewport: { width: 1280, height: 800 },
});

try {
  // persistent context 自带一个 about:blank 首页，直接复用；避免多开被当弹窗关掉
  let page = ctx.pages()[0] || (await ctx.newPage());
  page.on("close", () => console.error("warning: page closed by user; continuing on a new page"));
  await page.goto(HOME_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

  // 登录检测：URL 带 token 即已登录；否则停在扫码页
  let token = extractToken(page.url());
  const deadline = Date.now() + (args.login ? 240_000 : 5_000);
  while (!token && Date.now() < deadline) {
    await page.waitForTimeout(2_000);
    token = extractToken(page.url());
  }
  if (!token) {
    console.error(args.login ? "超时未登录（未扫码或扫码失败），会话已保留，可重试 --login" : "会话已过期：请先跑 --login 扫码");
    process.exitCode = 2;
  } else {
    console.error(`login ok, token=${token}`);
    const all = [];
    for (let begin = 0; ; begin += args.count) {
      const url = `${API}?sub=list_ex&begin=${begin}&count=${args.count}&token=${token}&f=json&ajax=1`;
      const raw = await page.evaluate(async (u) => {
        const r = await fetch(u, { headers: { Accept: "application/json" } });
        return r.text();
      }, url);
      let pageJson;
      try {
        const outer = JSON.parse(raw);
        if (outer.base_resp?.ret !== 0) throw new Error(`ret=${outer.base_resp?.ret} ${outer.base_resp?.err_msg || ""}`);
        pageJson = JSON.parse(outer.publish_page);
      } catch (e) {
        console.error(`stop at begin=${begin}: ${e.message}`);
        process.exitCode = 1;
        break;
      }
      const items = flatten(pageJson);
      all.push(...items);
      console.error(`begin=${begin} got=${items.length} total_so_far=${all.length}`);
      if (items.length < args.count) break;
      await page.waitForTimeout(1_200); // 翻页节流，防风控
    }
    const out = { schema: "mp-appmsgpublish-export/v1", exported_at: new Date().toISOString(), count: all.length, items: all };
    fs.writeFileSync(args.out, JSON.stringify(out, null, 1));
    console.log(`wrote ${all.length} entries -> ${path.resolve(args.out)}`);
  }
} finally {
  await ctx.close();
}

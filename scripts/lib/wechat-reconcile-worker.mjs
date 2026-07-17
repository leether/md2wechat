import fs from "node:fs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function readEnvFile(envPath) {
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const separator = trimmed.indexOf("=");
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function normalizeAccount(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`WeChat HTTP ${response.status}`);
  return text ? JSON.parse(text) : {};
}

function credentialKeys(account) {
  const normalized = normalizeAccount(account);
  if (!normalized || normalized === "DEFAULT" || normalized === "PRIMARY") {
    return ["WECHAT_MP_APP_ID", "WECHAT_MP_APP_SECRET"];
  }
  return [`WECHAT_${normalized}_APP_ID`, `WECHAT_${normalized}_APP_SECRET`];
}

function firstNewsItem(item) {
  return item?.content?.news_item?.[0] || {};
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envPath = String(args.env || "");
  const account = normalizeAccount(args.account || "");
  if (!envPath || !account) throw new Error("--env and --account are required");
  const env = readEnvFile(envPath);
  const [appIdKey, appSecretKey] = credentialKeys(account);
  const appId = env[appIdKey] || "";
  const appSecret = env[appSecretKey] || "";
  if (!appId || !appSecret) throw new Error(`relay env missing ${appIdKey} or ${appSecretKey}`);

  const tokenResult = await postJson("https://api.weixin.qq.com/cgi-bin/stable_token", {
    grant_type: "client_credential",
    appid: appId,
    secret: appSecret,
    force_refresh: false,
  });
  const token = tokenResult.access_token;
  if (!token) throw new Error(`stable_token failed with errcode ${tokenResult.errcode ?? "unknown"}`);

  const drafts = [];
  let offset = 0;
  const count = 20;
  let total = 0;
  while (true) {
    const page = await postJson(
      `https://api.weixin.qq.com/cgi-bin/draft/batchget?access_token=${encodeURIComponent(token)}`,
      { offset, count, no_content: 1 },
    );
    if (page.errcode && page.errcode !== 0) {
      throw new Error(`draft/batchget failed with errcode ${page.errcode}`);
    }
    total = Number(page.total_count || 0);
    const items = Array.isArray(page.item) ? page.item : [];
    for (const item of items) {
      const news = firstNewsItem(item);
      drafts.push({
        media_id: item.media_id || "",
        title: news.title || "",
        thumb_media_id: news.thumb_media_id || "",
        create_time: news.create_time || item.create_time || null,
        update_time: news.update_time || item.update_time || null,
      });
    }
    offset += items.length;
    if (items.length === 0 || offset >= total) break;
  }

  const publishProbe = await postJson(
    `https://api.weixin.qq.com/cgi-bin/freepublish/batchget?access_token=${encodeURIComponent(token)}`,
    { offset: 0, count: 1, no_content: 1 },
  );

  process.stdout.write(`${JSON.stringify({
    schema_version: "md2wechat-relay-draft-snapshot/v1",
    account,
    queried_at: new Date().toISOString(),
    draft_total: total,
    drafts,
    freepublish: publishProbe.errcode && publishProbe.errcode !== 0
      ? { available: false, errcode: publishProbe.errcode }
      : { available: true, errcode: 0, total_count: Number(publishProbe.total_count || 0) },
  }, null, 2)}\n`);
}

await main().catch((error) => {
  process.stderr.write(`${error.message || String(error)}\n`);
  process.exitCode = 1;
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs, printHelp, requireArg } from "./lib/memory-lib.mjs";

const stableTokenEndpoint = "https://api.weixin.qq.com/cgi-bin/stable_token";
const draftAddEndpoint = "https://api.weixin.qq.com/cgi-bin/draft/add";
const imageAddEndpoint = "https://api.weixin.qq.com/cgi-bin/material/add_material";
const defaultEnvPath = path.resolve(process.cwd(), ".env");
const targetCoverAspectRatio = 2.35;
const targetCoverAspectTolerance = 0.2;
const maxPictureDraftImages = 20;

// ── 纯色占位封面图生成（零 npm 依赖，纯 Node.js + zlib） ──
// 微信草稿箱必须有封面图，没有时自动生成一个纯色占位图
function generatePlaceholderCover(outputPath, options = {}) {
  const W = options.width || 900;
  const H = options.height || 383; // ≈ 2.35:1，微信推荐比例
  const R = options.r ?? 0x1a;
  const G = options.g ?? 0x1a;
  const B = options.b ?? 0x2e;

  // 构建原始扫描线：每行 = filter_byte(0) + W * RGB
  const rowLen = 1 + W * 3;
  const raw = Buffer.alloc(H * rowLen);
  for (let y = 0; y < H; y++) {
    const off = y * rowLen;
    raw[off] = 0; // filter: None
    for (let x = 0; x < W; x++) {
      const px = off + 1 + x * 3;
      raw[px] = R; raw[px + 1] = G; raw[px + 2] = B;
    }
  }

  const compressed = zlib.deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR: width, height, bitDepth=8, colorType=2(RGB)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;

  const chunks = [
    _pngChunk("IHDR", ihdr),
    _pngChunk("IDAT", compressed),
    _pngChunk("IEND", Buffer.alloc(0)),
  ];

  fs.writeFileSync(outputPath, Buffer.concat([sig, ...chunks]));
  return outputPath;
}

function _pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type);
  const crc = _crc32(Buffer.concat([typeB, data]));
  const crcB = Buffer.alloc(4); crcB.writeUInt32BE(crc);
  return Buffer.concat([len, typeB, data, crcB]);
}

// CRC32 查表法（PNG 规范要求）
const _crc32Table = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function _crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ _crc32Table[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function readEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const pairs = {};
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    pairs[key] = value;
  }

  return pairs;
}

function checkExecutionEnvironment(envPath) {
  const env = readEnvFile(envPath);

  if (env.WECHAT_PUBLISH_FORCE_LOCAL === "1" || env.WECHAT_PUBLISH_FORCE_LOCAL === "true") {
    return;
  }

  const allowedHosts = (env.WECHAT_PUBLISH_ALLOWED_HOSTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowedHosts.length > 0) {
    const hostname = os.hostname();
    if (!allowedHosts.includes(hostname)) {
      throw new Error(
        `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `❌ 推送被拦截：当前主机 "${hostname}" 不在 WECHAT_PUBLISH_ALLOWED_HOSTS 白名单中。\n\n` +
        `解决方案（二选一）：\n` +
        `  1. 通过 relay 主机执行推送（推荐）\n` +
        `     scp 文件到 relay 主机，然后 ssh 执行 create_wechat_draft.mjs\n` +
        `  2. 在 .env 中添加 WECHAT_PUBLISH_FORCE_LOCAL=1 强制本地执行\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`,
      );
    }
    return;
  }

  const allowedIps = (env.WECHAT_PUBLISH_ALLOWED_IPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowedIps.length > 0) {
    let publicIp = "";
    try {
      publicIp = execFileSync("curl", ["-s", "--max-time", "3", "ifconfig.me"], { encoding: "utf8" }).trim();
    } catch {
      publicIp = "";
    }

    if (!publicIp || !allowedIps.includes(publicIp)) {
      throw new Error(
        `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `❌ 推送被拦截：当前 IP${publicIp ? ` "${publicIp}"` : "无法获取"} 不在 WECHAT_PUBLISH_ALLOWED_IPS 白名单中。\n\n` +
        `解决方案（二选一）：\n` +
        `  1. 通过 relay 主机执行推送（推荐）\n` +
        `     scp 文件到 relay 主机，然后 ssh 执行 create_wechat_draft.mjs\n` +
        `  2. 在 .env 中添加 WECHAT_PUBLISH_FORCE_LOCAL=1 强制本地执行\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`,
      );
    }
  }
}

function normalizeWechatAccountName(account) {
  return String(account || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function loadWechatCredentials(envPath = defaultEnvPath, account = "") {
  const envFromFile = readEnvFile(envPath);
  const normalizedAccount = normalizeWechatAccountName(account);
  const useDefaultAccount = !normalizedAccount || normalizedAccount === "DEFAULT" || normalizedAccount === "PRIMARY";
  const appIdKey = useDefaultAccount ? "WECHAT_MP_APP_ID" : `WECHAT_${normalizedAccount}_APP_ID`;
  const appSecretKey = useDefaultAccount ? "WECHAT_MP_APP_SECRET" : `WECHAT_${normalizedAccount}_APP_SECRET`;
  const appId = process.env[appIdKey] || envFromFile[appIdKey] || "";
  const appSecret = process.env[appSecretKey] || envFromFile[appSecretKey] || "";

  if (!appId || !appSecret) {
    throw new Error(
      `Missing WeChat credentials. Expected ${appIdKey} and ${appSecretKey} in ${envPath} or the current shell environment.`,
    );
  }

  return { appId, appSecret, envPath, account: normalizedAccount || "DEFAULT" };
}

function postJson(url, payload) {
  let text = "";

  try {
    text = execFileSync(
      "curl",
      [
        "-L",
        "-sS",
        url,
        "-H",
        "Content-Type: application/json",
        "-d",
        JSON.stringify(payload),
      ],
      {
        encoding: "utf8",
      },
    );
  } catch (error) {
    throw new Error(error.stderr?.trim() || error.message);
  }

  let json;

  try {
    json = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`Expected JSON from ${url} but received: ${text.slice(0, 300)}`);
  }

  return json;
}

function postMultipart(url, formArgs) {
  let text = "";

  try {
    text = execFileSync(
      "curl",
      [
        "-L",
        "-sS",
        url,
        ...formArgs.flatMap((value) => ["-F", value]),
      ],
      {
        encoding: "utf8",
      },
    );
  } catch (error) {
    throw new Error(error.stderr?.trim() || error.message);
  }

  let json;

  try {
    json = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`Expected JSON from ${url} but received: ${text.slice(0, 300)}`);
  }

  return json;
}

function getStableAccessToken({ appId, appSecret }) {
  const payload = {
    grant_type: "client_credential",
    appid: appId,
    secret: appSecret,
    force_refresh: false,
  };

  const json = postJson(stableTokenEndpoint, payload);

  if (!json.access_token) {
    throw new Error(`Failed to get access token: ${JSON.stringify(json)}`);
  }

  return json.access_token;
}

function guessMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  if (ext === ".gif") {
    return "image/gif";
  }
  return "image/jpeg";
}

function isRemoteImageSource(src) {
  const normalized = String(src || "").trim();
  if (!normalized) {
    return false;
  }

  return /^(?:https?:)?\/\//i.test(normalized);
}

function isUploadableImageSource(src) {
  const normalized = String(src || "").trim();
  if (!normalized) {
    return false;
  }

  return !/^data:/i.test(normalized);
}

function uploadWechatMaterial({ accessToken, imagePath, type = "image" }) {
  const absolutePath = path.resolve(imagePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`WeChat material not found: ${absolutePath}`);
  }

  const url = `${imageAddEndpoint}?access_token=${encodeURIComponent(accessToken)}&type=${encodeURIComponent(type)}`;
  const formValue = `media=@${absolutePath};type=${guessMimeType(absolutePath)}`;
  return postMultipart(url, [formValue]);
}

function uploadWechatInlineImage({ accessToken, imagePath }) {
  const json = uploadWechatMaterial({ accessToken, imagePath, type: "image" });

  if (!json.url) {
    throw new Error(`Failed to upload inline image: ${JSON.stringify(json)}`);
  }

  return json;
}

function inferRemoteImageExtension(src) {
  try {
    const parsed = new URL(/^https?:\/\//i.test(src) ? src : `https:${src}`);
    const ext = path.extname(parsed.pathname).toLowerCase();
    if ([".png", ".webp", ".gif", ".jpg", ".jpeg"].includes(ext)) {
      return ext === ".jpeg" ? ".jpg" : ext;
    }
  } catch {
    // Ignore parse failures and fall back to jpg.
  }

  return ".jpg";
}

function downloadRemoteImage(src) {
  const normalized = /^https?:\/\//i.test(src) ? src : `https:${src}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-inline-"));
  const filePath = path.join(tempDir, `inline${inferRemoteImageExtension(normalized)}`);

  try {
    execFileSync("curl", ["-L", "-sS", "-o", filePath, normalized], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(error.stderr?.trim() || `Failed to download inline image: ${normalized}`);
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    throw new Error(`Downloaded inline image is empty: ${normalized}`);
  }

  return filePath;
}

function rewriteLocalImageSources(content, { htmlPath, accessToken }) {
  const imageDir = path.dirname(htmlPath);
  const uploads = new Map();
  const pattern = /(<img\b[^>]*\bsrc=")([^"]+)(")/gi;

  return content.replace(pattern, (_, prefix, src, suffix) => {
    if (!isUploadableImageSource(src)) {
      return `${prefix}${src}${suffix}`;
    }

    const uploadKey = isRemoteImageSource(src) ? src : path.resolve(imageDir, src);
    if (!uploads.has(uploadKey)) {
      let imagePath = "";

      if (isRemoteImageSource(src)) {
        imagePath = downloadRemoteImage(src);
      } else {
        const pathCandidates = [
          path.resolve(imageDir, src),
          path.resolve(process.cwd(), src),
        ];
        imagePath = pathCandidates.find((candidate) => fs.existsSync(candidate)) || "";
        if (!imagePath) {
          throw new Error(`Inline image not found: ${pathCandidates[0]}`);
        }
      }

      uploads.set(uploadKey, uploadWechatInlineImage({ accessToken, imagePath }).url);
    }

    return `${prefix}${uploads.get(uploadKey)}${suffix}`;
  });
}

function countChars(value) {
  return Array.from(String(value || "")).length;
}

function assertMaxChars(value, limit, label) {
  if (!value) {
    return;
  }

  const length = countChars(value);
  if (length > limit) {
    throw new Error(`${label} exceeds ${limit} characters: got ${length}`);
  }
}

function readTextFile(filePath, label) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`${label} not found: ${absolutePath}`);
  }
  return {
    absolutePath,
    content: fs.readFileSync(absolutePath, "utf8"),
  };
}

function extractImageSources(html) {
  const pattern = /<img\b[^>]*\bsrc="([^"]+)"/gi;
  const images = [];
  let match;

  while ((match = pattern.exec(html))) {
    images.push(String(match[1]).trim());
  }

  return images;
}

function classifyImageSource(src) {
  if (/^data:/i.test(src)) {
    return "data";
  }
  if (isRemoteImageSource(src)) {
    return "remote";
  }
  return "local";
}

function summarizeImageSources(imageSources) {
  const summary = {
    total: imageSources.length,
    local: 0,
    remote: 0,
    data: 0,
  };

  for (const src of imageSources) {
    const kind = classifyImageSource(src);
    summary[kind] += 1;
  }

  return summary;
}

function resolveLocalImagePath(imageDir, src) {
  const pathCandidates = [
    path.resolve(imageDir, src),
    path.resolve(process.cwd(), src),
  ];

  return pathCandidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function readPngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readGifDimensions(buffer) {
  if (buffer.length < 10 || buffer.toString("ascii", 0, 3) !== "GIF") {
    return null;
  }
  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  };
}

function readJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    const blockLength = buffer.readUInt16BE(offset + 2);
    if (blockLength < 2 || offset + 2 + blockLength > buffer.length) {
      break;
    }

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isStartOfFrame) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + blockLength;
  }

  return null;
}

function readWebpDimensions(buffer) {
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }

  const chunkType = buffer.toString("ascii", 12, 16);
  if (chunkType === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }

  return null;
}

function getImageDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  return (
    readPngDimensions(buffer) ||
    readJpegDimensions(buffer) ||
    readGifDimensions(buffer) ||
    readWebpDimensions(buffer)
  );
}

function formatCropNumber(value) {
  const clamped = Math.min(1, Math.max(0, value));
  if (clamped === 0 || clamped === 1) {
    return String(clamped);
  }
  return clamped.toFixed(4).replace(/0+$/g, "").replace(/\.$/g, "");
}

function buildCenteredCropForAspectRatio({ width, height, targetAspectRatio }) {
  if (!width || !height || !targetAspectRatio || width <= 0 || height <= 0 || targetAspectRatio <= 0) {
    return "";
  }

  const aspectRatio = width / height;
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return "";
  }

  if (Math.abs(aspectRatio - targetAspectRatio) < 0.0001) {
    return "0_0_1_1";
  }

  if (aspectRatio > targetAspectRatio) {
    const normalizedWidth = targetAspectRatio / aspectRatio;
    const left = (1 - normalizedWidth) / 2;
    const right = 1 - left;
    return `${formatCropNumber(left)}_0_${formatCropNumber(right)}_1`;
  }

  const normalizedHeight = aspectRatio / targetAspectRatio;
  const top = (1 - normalizedHeight) / 2;
  const bottom = 1 - top;
  return `0_${formatCropNumber(top)}_1_${formatCropNumber(bottom)}`;
}

function buildPreflightIssue(code, message, details = {}) {
  return { code, message, ...details };
}

function buildSuggestedText(value, limit) {
  if (!value) {
    return "";
  }
  return truncateChars(String(value), limit);
}

function normalizeTitleCandidate(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[：:]\s*[：:]+/g, "：")
    .replace(/\s+([：:])/g, "$1")
    .trim();
}

function buildProductPrefix(title) {
  const match = String(title || "").match(/^[A-Za-z0-9][A-Za-z0-9 .+\-]*/);
  return match ? match[0].trim() : "";
}

function generateTitleSuggestions(title, limit) {
  const normalized = normalizeTitleCandidate(title);
  const suggestions = [];
  const seen = new Set();
  const push = (candidate) => {
    const clean = normalizeTitleCandidate(candidate);
    if (!clean || seen.has(clean) || countChars(clean) > limit) {
      return;
    }
    seen.add(clean);
    suggestions.push(clean);
  };

  const productPrefix = buildProductPrefix(normalized);
  const parts = normalized.split(/[：:]/).map((part) => part.trim()).filter(Boolean);
  const tail = parts.length > 1 ? parts[parts.length - 1] : "";
  const tailWithoutOwner = tail ? tail.replace(/^[^的]{1,20}的\s*/, "") : "";

  push(normalized);
  if (productPrefix && tailWithoutOwner) {
    push(`${productPrefix} 的 ${tailWithoutOwner}`);
    push(`${productPrefix} ${tailWithoutOwner}`);
  }
  if (tail) {
    push(tail);
  }

  const withoutRangePrefix = normalized.replace(/^(.+?)从.+?到.+?[：:]\s*/, "$1");
  if (withoutRangePrefix !== normalized) {
    push(withoutRangePrefix);
  }

  if (productPrefix) {
    const stopwordRemoved = normalized
      .replace(/^.+?[：:]\s*/, "")
      .replace(/^Anthropic 的\s*/i, "")
      .replace(/^OpenAI 的\s*/i, "")
      .replace(/^Google 的\s*/i, "");
    if (stopwordRemoved) {
      push(`${productPrefix} 的 ${stopwordRemoved}`);
      push(`${productPrefix} ${stopwordRemoved}`);
    }
  }

  push(buildSuggestedText(normalized, limit));

  return suggestions.slice(0, 5);
}

function extractTitleFromMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const heading = lines.find((line) => line.trim().startsWith("# "));
  return heading ? heading.trim().replace(/^# /, "").trim() : "";
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateChars(value, limit) {
  return Array.from(value).slice(0, limit).join("");
}

function extractBodyHtml(html) {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return (match ? match[1] : html).trim();
}

function normalizeWechatHtml(html, { stripInlineStyles = false } = {}) {
  let content = extractBodyHtml(html);
  content = content.replace(/<!--[\s\S]*?-->/g, "");

  if (stripInlineStyles) {
    content = content.replace(/\sstyle=(".*?"|'.*?')/gis, "");
  }

  return content.replace(/>\s+</g, "><").replace(/\s{2,}/g, " ").trim();
}

function compactWechatHtml(html, { keepInlineStyles = false } = {}) {
  // 始终保留内联样式——微信的排版完全依赖内联 style，
  // 自动剥除会导致所有格式丢失，代价远超字符超限的风险。
  // 字符超限由 preflight 改为警告，由微信 API 做最终校验。
  return normalizeWechatHtml(html, { stripInlineStyles: false });
}

function parseBooleanNumber(value, defaultValue = 0) {
  if (value === undefined || value === false) {
    return defaultValue;
  }

  if (value === true) {
    return 1;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return 1;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return 0;
  }

  throw new Error(`Expected boolean-like value but received: ${value}`);
}

function buildDraftArticle({
  html,
  title,
  author,
  digest,
  contentSourceUrl,
  thumbMediaId,
  needOpenComment,
  onlyFansCanComment,
  crop2351,
  crop11,
  keepInlineStyles,
}) {
  const content = compactWechatHtml(html, { keepInlineStyles });
  if (!content) {
    throw new Error("HTML content is empty after normalization.");
  }

  // 从 HTML comment 中提取 WECHAT_SUMMARY 作为 digest
  const summaryMatch = html.match(/<!--\s*WECHAT_SUMMARY:\s*(.*?)\s*-->/);
  const summaryFromHtml = summaryMatch ? summaryMatch[1].trim() : "";

  const plainText = stripHtml(content);
  const resolvedDigest = digest || summaryFromHtml || truncateChars(plainText, 54);

  const article = {
    title,
    content,
    thumb_media_id: thumbMediaId,
    need_open_comment: needOpenComment,
    only_fans_can_comment: onlyFansCanComment,
  };

  if (author) {
    article.author = author;
  }
  if (resolvedDigest) {
    article.digest = resolvedDigest;
  }
  if (contentSourceUrl) {
    article.content_source_url = contentSourceUrl;
  }
  if (crop2351) {
    article.pic_crop_235_1 = crop2351;
  }
  if (crop11) {
    article.pic_crop_1_1 = crop11;
  }

  return article;
}

function parseImageListArg(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function derivePictureDraftTitle(imagePaths) {
  const first = imagePaths[0] || "";
  const stem = first ? path.basename(first, path.extname(first)) : "";
  return stem || `贴图 ${new Date().toISOString().slice(0, 10)}`;
}

function buildPictureDraftArticle({
  title,
  author,
  digest,
  content,
  needOpenComment,
  onlyFansCanComment,
}) {
  const resolvedContent = String(content || digest || title || "").trim();
  if (!resolvedContent) {
    throw new Error("Picture draft content is empty. Pass --description or --content.");
  }

  const article = {
    article_type: "newspic",
    title,
    content: resolvedContent,
    need_open_comment: needOpenComment,
    only_fans_can_comment: onlyFansCanComment,
  };

  if (author) {
    article.author = author;
  }
  if (digest) {
    article.digest = digest;
  }

  return article;
}

function runWechatDraftPreflight(plan) {
  const article = plan.payload.articles[0];
  const blocking = [];
  const warnings = [];
  const info = {};

  info.account = plan.account || "default";
  info.envPath = plan.envPath;
  info.htmlPath = plan.htmlPath;

  try {
    const credentials = loadWechatCredentials(plan.envPath, plan.account);
    info.credentials = { account: credentials.account, ok: true };
  } catch (error) {
    blocking.push(
      buildPreflightIssue("missing_credentials", error.message, {
        account: plan.account || "default",
      }),
    );
    info.credentials = { ok: false };
  }

  const titleChars = countChars(article.title);
  info.titleChars = titleChars;
  if (titleChars > 32) {
    const titleSuggestions = generateTitleSuggestions(article.title, 32);
    blocking.push(
      buildPreflightIssue("title_too_long", `Title exceeds 32 characters: got ${titleChars}`, {
        suggestedTitle: titleSuggestions[0] || buildSuggestedText(article.title, 32),
        suggestedTitles: titleSuggestions,
      }),
    );
  }

  const digestChars = countChars(article.digest || "");
  info.digestChars = digestChars;
  if (digestChars > 128) {
    blocking.push(
      buildPreflightIssue("digest_too_long", `Digest exceeds 128 characters: got ${digestChars}`, {
        suggestedDigest: buildSuggestedText(article.digest, 128),
      }),
    );
  }

  const authorChars = countChars(article.author || "");
  info.authorChars = authorChars;
  if (authorChars > 16) {
    blocking.push(
      buildPreflightIssue("author_too_long", `Author exceeds 16 characters: got ${authorChars}`, {
        suggestedAuthor: buildSuggestedText(article.author, 16),
      }),
    );
  }

  const contentChars = countChars(article.content);
  const contentBytes = Buffer.byteLength(article.content, "utf8");
  info.contentChars = contentChars;
  info.contentBytes = contentBytes;
  if (contentChars >= 20000) {
    // 字符超限改为警告而非硬阻——微信排版完全依赖内联 style，
    // 自动剥除代价远超超限风险。让微信 API 做最终校验。
    warnings.push(
      buildPreflightIssue(
        "content_chars_exceeded",
        `HTML content exceeds WeChat's 20000-character limit: got ${contentChars}`,
      ),
    );
  }
  if (contentBytes >= 1024 * 1024) {
    warnings.push(
      buildPreflightIssue(
        "content_bytes_exceeded",
        `HTML content exceeds WeChat's 1MB limit: got ${contentBytes} bytes`,
      ),
    );
  }

  if (plan.isPictureDraft) {
    info.pictureDraft = {
      imageCount: plan.pictureImagePaths.length,
      imagePaths: [],
    };
    if (plan.pictureImagePaths.length === 0) {
      blocking.push(
        buildPreflightIssue(
          "missing_picture_images",
          "Picture draft requires at least one image. Pass --images <path1,path2,...>.",
        ),
      );
    }
    if (plan.pictureImagePaths.length > maxPictureDraftImages) {
      blocking.push(
        buildPreflightIssue(
          "too_many_picture_images",
          `Picture draft supports at most ${maxPictureDraftImages} images: got ${plan.pictureImagePaths.length}`,
        ),
      );
    }

    for (const imagePath of plan.pictureImagePaths) {
      const absolutePath = path.resolve(imagePath);
      const imageInfo = {
        path: absolutePath,
        exists: fs.existsSync(absolutePath),
      };
      if (!imageInfo.exists) {
        blocking.push(
          buildPreflightIssue("missing_picture_image", `Picture image not found: ${absolutePath}`, {
            path: absolutePath,
          }),
        );
      } else {
        imageInfo.bytes = fs.statSync(absolutePath).size;
        imageInfo.mimeType = guessMimeType(absolutePath);
        imageInfo.dimensions = getImageDimensions(absolutePath);
      }
      info.pictureDraft.imagePaths.push(imageInfo);
    }

    if (!article.digest) {
      warnings.push(
        buildPreflightIssue(
          "missing_picture_digest",
          "Picture draft has no digest; description will rely only on the正文文本。",
        ),
      );
    }
  } else if (plan.thumbImagePath) {
    const coverPath = path.resolve(plan.thumbImagePath);
    if (!fs.existsSync(coverPath)) {
      blocking.push(
        buildPreflightIssue("missing_cover_image", `Cover image not found: ${coverPath}`),
      );
    } else {
      const coverStats = fs.statSync(coverPath);
      const dimensions = getImageDimensions(coverPath);
      const coverInfo = {
        path: coverPath,
        bytes: coverStats.size,
        mimeType: guessMimeType(coverPath),
        dimensions: dimensions || null,
      };
      if (dimensions && dimensions.height > 0) {
        const aspectRatio = Number((dimensions.width / dimensions.height).toFixed(4));
        const recommendedCrop2351 = buildCenteredCropForAspectRatio({
          width: dimensions.width,
          height: dimensions.height,
          targetAspectRatio: targetCoverAspectRatio,
        });
        coverInfo.aspectRatio = aspectRatio;
        coverInfo.targetAspectRatio = targetCoverAspectRatio;
        coverInfo.recommendedCrop2351 = recommendedCrop2351;
        info.recommendedCoverCrop2351 = recommendedCrop2351;
        if (Math.abs(aspectRatio - targetCoverAspectRatio) > targetCoverAspectTolerance) {
          warnings.push(
            buildPreflightIssue(
              "cover_aspect_ratio_off",
              `Cover aspect ratio ${aspectRatio} is not close to target ${targetCoverAspectRatio}`,
              {
                path: coverPath,
                suggestedCrop2351: recommendedCrop2351,
                suggestedArg: recommendedCrop2351 ? `--crop-235-1 ${recommendedCrop2351}` : "",
              },
            ),
          );
        }
      } else {
        warnings.push(
          buildPreflightIssue(
            "cover_dimensions_unknown",
            `Could not determine cover dimensions for ${coverPath}`,
          ),
        );
      }
      info.cover = coverInfo;
    }
  } else if (!article.thumb_media_id || article.thumb_media_id === "__UPLOAD_THUMB_IMAGE_AT_RUNTIME__") {
    // 占位图已在主流程自动生成，这里不需要 blocking
    // 但如果走到这个分支说明流程异常，加个 warning
    warnings.push(
      buildPreflightIssue(
        "placeholder_cover_used",
        "No explicit cover image provided; a solid-color placeholder will be used. Replace in WeChat editor.",
      ),
    );
  } else {
    info.cover = { thumbMediaId: article.thumb_media_id, source: "thumb_media_id" };
  }

  if (!plan.isPictureDraft) {
    const imageSources = extractImageSources(article.content);
    info.inlineImages = {
      summary: summarizeImageSources(imageSources),
      sources: [],
    };
    const imageDir = path.dirname(plan.htmlPath);
    for (const src of imageSources) {
      const kind = classifyImageSource(src);
      const imageInfo = { src, kind };
      if (kind === "local") {
        const resolvedPath = resolveLocalImagePath(imageDir, src);
        imageInfo.resolvedPath = resolvedPath || "";
        imageInfo.exists = Boolean(resolvedPath);
        if (!resolvedPath) {
          blocking.push(
            buildPreflightIssue("missing_inline_local_image", `Inline image not found: ${src}`, {
              src,
            }),
          );
        }
      } else if (kind === "data") {
        blocking.push(
          buildPreflightIssue(
            "unsupported_data_image",
            "Inline data: image sources are not supported for WeChat upload.",
            { src },
          ),
        );
      } else if (kind === "remote") {
        warnings.push(
          buildPreflightIssue(
            "remote_inline_image",
            `Remote inline image will be downloaded and re-uploaded to WeChat: ${src}`,
            { src },
          ),
        );
      }
      info.inlineImages.sources.push(imageInfo);
    }

    if (info.inlineImages.summary.total > 8) {
      warnings.push(
        buildPreflightIssue(
          "many_inline_images",
          `Article contains ${info.inlineImages.summary.total} inline images; verify mobile reading density.`,
        ),
      );
    }
  }

  if (!plan.isPictureDraft && !article.pic_crop_235_1) {
    warnings.push(
      buildPreflightIssue(
        "missing_cover_crop_235_1",
        "No --crop-235-1 provided; WeChat will use its default crop for the cover.",
        {
          suggestedCrop2351: info.recommendedCoverCrop2351 || "",
          suggestedArg: info.recommendedCoverCrop2351
            ? `--crop-235-1 ${info.recommendedCoverCrop2351}`
            : "",
        },
      ),
    );
  }

  return {
    ok: blocking.length === 0,
    blocking,
    warnings,
    info,
  };
}

function formatPreflightReport(report) {
  return JSON.stringify(report, null, 2);
}

export function resolveDraftPlan(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.help) {
    return { help: true };
  }

  const isPictureDraft = Boolean(args["picture-draft"]);
  const imagePaths = parseImageListArg(args.images);

  let absoluteHtmlPath = "";
  let html = "";
  if (!isPictureDraft) {
    const htmlPath = requireArg(args, "html", "Missing required argument --html <file.html>");
    const htmlFile = readTextFile(htmlPath, "HTML file");
    absoluteHtmlPath = htmlFile.absolutePath;
    html = htmlFile.content;
  }

  let title = args.title ? String(args.title).trim() : "";
  if (!title && args["source-md"]) {
    const { content: markdown } = readTextFile(args["source-md"], "Markdown source");
    title = extractTitleFromMarkdown(markdown);
  }

  if (!title && isPictureDraft) {
    title = derivePictureDraftTitle(imagePaths);
  }

  if (!title) {
    throw new Error(
      "Missing article title. Pass --title, or pass --source-md so the script can read the first H1 as title.",
    );
  }

  const explicitThumbMediaId = args["thumb-media-id"] ? String(args["thumb-media-id"]).trim() : "";
  let thumbImagePath = args["thumb-image"] ? path.resolve(process.cwd(), String(args["thumb-image"]).trim()) : "";
  if (!isPictureDraft && !explicitThumbMediaId && !thumbImagePath) {
    // 自动生成纯色占位封面图（微信草稿箱必须有封面图）
    thumbImagePath = path.join(os.tmpdir(), `wechat-placeholder-cover-${Date.now()}.png`);
    generatePlaceholderCover(thumbImagePath);
    console.warn(
      `⚠️  未提供封面图，已自动生成纯色占位图：${thumbImagePath}\n` +
      `   建议在微信公众号后台替换为正式封面图。如需自定义，使用 --thumb-image <path>。`,
    );
  }

  const draftArticle = isPictureDraft
    ? buildPictureDraftArticle({
        title,
        author: args.author ? String(args.author).trim() : "",
        digest: args.digest ? String(args.digest).trim() : "",
        content: args.description
          ? String(args.description).trim()
          : args.content
            ? String(args.content).trim()
            : "",
        needOpenComment: parseBooleanNumber(args["open-comment"], 0),
        onlyFansCanComment: parseBooleanNumber(args["fans-only-comment"], 0),
      })
    : buildDraftArticle({
        html,
        title,
        author: args.author ? String(args.author).trim() : "",
        digest: args.digest ? String(args.digest).trim() : "",
        contentSourceUrl: args["content-source-url"] ? String(args["content-source-url"]).trim() : "",
        thumbMediaId: explicitThumbMediaId || "__UPLOAD_THUMB_IMAGE_AT_RUNTIME__",
        needOpenComment: parseBooleanNumber(args["open-comment"], 0),
        onlyFansCanComment: parseBooleanNumber(args["fans-only-comment"], 0),
        crop2351: args["crop-235-1"] ? String(args["crop-235-1"]).trim() : "",
        crop11: args["crop-1-1"] ? String(args["crop-1-1"]).trim() : "",
        keepInlineStyles: Boolean(args["keep-inline-styles"]),
      });

  return {
    help: false,
    dryRun: Boolean(args["dry-run"]),
    preflight: Boolean(args.preflight),
    isPictureDraft,
    account: args.account ? String(args.account).trim() : "",
    envPath: args.env ? path.resolve(process.cwd(), args.env) : defaultEnvPath,
    htmlPath: absoluteHtmlPath,
    sourceMdPath: args["source-md"] ? path.resolve(process.cwd(), args["source-md"]) : "",
    thumbImagePath,
    pictureImagePaths: imagePaths.map((imagePath) => path.resolve(process.cwd(), imagePath)),
    payload: {
      articles: [draftArticle],
    },
  };
}

export async function createWechatDraft(argv = process.argv.slice(2)) {
  const plan = resolveDraftPlan(argv);

  // ── 执行环境护栏：检查是否在白名单主机/IP上 ──
  checkExecutionEnvironment(plan.envPath);

  if (plan.help) {
    printHelp([
      "Usage: node scripts/create_wechat_draft.mjs --html <file.html> (--thumb-media-id <media_id> | --thumb-image <path>) [options]",
      "   or: node scripts/create_wechat_draft.mjs --picture-draft --images <a.png,b.png,...> [options]",
      "",
      "Required:",
      "  --html <path>                 WeChat-ready HTML file",
      "  --picture-draft               Create a picture-message draft instead of an HTML article draft",
      "  --images <a,b,c>              Local image files for picture draft, up to 20 images",
      "",
      "Cover image (optional — auto-generates a solid-color placeholder if omitted):",
      "  --thumb-media-id <id>        Permanent cover image media_id",
      "  --thumb-image <path>         Local image file to upload as the cover material",
      "",
      "Optional metadata:",
      "  --title <text>               Article title; overrides --source-md",
      "  --source-md <path>           Read first H1 from Markdown as title",
      "  --author <text>              Article author",
      "  --digest <text>              Article digest; defaults to正文前54字",
      "  --description <text>         Picture draft caption text; falls back to --content or digest",
      "  --content <text>             Explicit body text for picture draft",
      "  --content-source-url <url>   'Read more' URL",
      "  --account <name>             Named WeChat account, e.g. my_account",
      "  --open-comment <0|1>         Enable comments",
      "  --fans-only-comment <0|1>    Restrict comments to followers",
      "  --crop-235-1 <coords>        Optional cover crop, e.g. 0.1_0_1_0.5",
      "  --crop-1-1 <coords>          Optional square cover crop",
      "  --env <path>                 Override .env path",
      "  --keep-inline-styles         Keep existing style= attrs instead of compacting HTML",
      "  --preflight                  Run publish checks and print a structured report",
      "  --dry-run                    Print resolved payload without calling WeChat",
      "  --help                       Show help",
    ]);
    return 0;
  }

  const preflightReport = runWechatDraftPreflight(plan);

  if (plan.preflight) {
    console.log(formatPreflightReport(preflightReport));
    return preflightReport.ok ? 0 : 1;
  }

  if (plan.dryRun) {
    console.log(
      JSON.stringify(
        {
          account: plan.account || "default",
          envPath: plan.envPath,
          htmlPath: plan.htmlPath,
          sourceMdPath: plan.sourceMdPath || undefined,
          thumbImagePath: plan.thumbImagePath || undefined,
          preflight: preflightReport,
          payload: plan.payload,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (!preflightReport.ok) {
    throw new Error(`WeChat draft preflight failed:\n${formatPreflightReport(preflightReport)}`);
  }

  const credentials = loadWechatCredentials(plan.envPath, plan.account);
  const accessToken = getStableAccessToken(credentials);
  if (plan.isPictureDraft) {
    const imageList = plan.pictureImagePaths.map((imagePath) => {
      const uploadResult = uploadWechatMaterial({ accessToken, imagePath, type: "image" });
      if (!uploadResult.media_id) {
        throw new Error(`Failed to upload picture draft image: ${JSON.stringify(uploadResult)}`);
      }
      return { image_media_id: uploadResult.media_id };
    });
    plan.payload.articles[0].image_info = { image_list: imageList };
  } else if (plan.thumbImagePath) {
    const uploadResult = uploadWechatMaterial({ accessToken, imagePath: plan.thumbImagePath, type: "image" });
    if (!uploadResult.media_id) {
      throw new Error(`Failed to upload cover image: ${JSON.stringify(uploadResult)}`);
    }
    plan.payload.articles[0].thumb_media_id = uploadResult.media_id;
  }
  if (!plan.isPictureDraft) {
    plan.payload.articles[0].content = rewriteLocalImageSources(plan.payload.articles[0].content, {
      htmlPath: plan.htmlPath,
      accessToken,
    });
  }
  const url = `${draftAddEndpoint}?access_token=${encodeURIComponent(accessToken)}`;
  const result = postJson(url, plan.payload);

  if (result.errcode && result.errcode !== 0) {
    throw new Error(`WeChat draft/add failed: ${JSON.stringify(result)}`);
  }

  console.log(
    JSON.stringify(
      {
        media_id: result.media_id || "",
        errcode: result.errcode || 0,
        errmsg: result.errmsg || "ok",
        title: plan.payload.articles[0].title,
        account: credentials.account,
        thumb_media_id: plan.payload.articles[0].thumb_media_id,
        htmlPath: plan.htmlPath,
      },
      null,
      2,
    ),
  );
  return 0;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  createWechatDraft().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

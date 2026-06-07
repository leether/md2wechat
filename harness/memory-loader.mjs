import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * memory-loader.mjs — 活记忆加载器
 *
 * 读取 docs/LESSONS_LEARNED.md 的 YAML frontmatter，提取有实质内容的摩擦点，
 * 供 preflight.mjs 和 render_wechat_editorial.mjs 在运行时自动感知历史教训。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LESSONS_PATH = path.resolve(__dirname, "../docs/LESSONS_LEARNED.md");

let _cache = null;
let _cacheMtime = null;

function stripQuotes(s) {
  if (!s) return s;
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * 轻量 YAML frontmatter 解析
 * 只处理 LESSONS_LEARNED.md 的实际格式：
 * ---
 * key: value
 * key: "value"
 * array:
 *   - key: value
 *     key: value
 * ---
 */
function parseYamlFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  if (!lines[0] || lines[0].trim() !== "---") return null;

  const endIdx = lines.slice(1).findIndex((l) => l.trim() === "---");
  if (endIdx === -1) return null;

  const yamlLines = lines.slice(1, endIdx + 1);
  const result = { friction_points: [] };

  let i = 0;
  while (i < yamlLines.length) {
    const line = yamlLines[i];
    const trimmed = line.trim();

    // 数组项开始：- key: value
    if (trimmed.startsWith("- ")) {
      // 这是一个数组项（可能是简单值或对象）
      const afterDash = trimmed.slice(2).trim();
      const kv = afterDash.match(/^([\w_]+):\s*(.*)$/);
      if (kv) {
        // 对象数组项的开始
        const obj = {};
        obj[kv[1]] = stripQuotes(kv[2]);
        i++;
        // 继续读取同对象的后续字段（缩进更大）
        while (i < yamlLines.length) {
          const nextLine = yamlLines[i];
          const nextTrimmed = nextLine.trim();
          // 遇到新的数组项或分隔线或空行（在对象之后）则停止
          if (nextTrimmed.startsWith("- ")) break;
          if (nextTrimmed === "---") break;
          if (nextTrimmed === "" && i + 1 < yamlLines.length && yamlLines[i + 1].trim().startsWith("- ")) {
            i++;
            break;
          }
          if (nextTrimmed === "") {
            i++;
            continue;
          }
          // 键值对
          const nextKv = nextTrimmed.match(/^([\w_]+):\s*(.*)$/);
          if (nextKv) {
            obj[nextKv[1]] = stripQuotes(nextKv[2]);
          }
          i++;
        }
        result.friction_points.push(obj);
        continue;
      }
      // 简单值数组项
      i++;
      continue;
    }

    // 顶层键值对
    const topKv = trimmed.match(/^([\w_]+):\s*(.*)$/);
    if (topKv) {
      const k = topKv[1];
      const v = stripQuotes(topKv[2]);
      if (k !== "friction_points") {
        result[k] = v;
      }
      i++;
      continue;
    }

    i++;
  }

  return result;
}

/**
 * 加载活记忆（带缓存）
 */
export function loadLivingMemory(lessonsPath = DEFAULT_LESSONS_PATH) {
  try {
    const stat = fs.statSync(lessonsPath);
    if (_cache && _cacheMtime === stat.mtimeMs) {
      return _cache;
    }

    const content = fs.readFileSync(lessonsPath, "utf8");
    const frontmatter = parseYamlFrontmatter(content);

    if (!frontmatter) {
      return { loaded: false, reason: "no_yaml_frontmatter", friction_points: [] };
    }

    // 过滤出有实质内容的摩擦点（description 非空且不是 undefined）
    const validFps = (frontmatter.friction_points || []).filter(
      (fp) => fp.description && fp.description.trim().length > 0 && fp.description !== "undefined",
    );

    // 按 timestamp 降序
    const sorted = validFps.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    });

    const recent = sorted.slice(0, 5);
    const highFriction = sorted.filter(
      (fp) => fp.category && !["undefined", ""].includes(fp.category),
    ).slice(0, 3);

    const result = {
      loaded: true,
      evolution_count: frontmatter.evolution_count || validFps.length,
      last_updated: frontmatter.last_updated || "",
      total_friction_points: validFps.length,
      recent_friction_points: recent,
      high_friction_points: highFriction,
      all_categories: [...new Set(validFps.map((fp) => fp.category).filter(Boolean))],
    };

    _cache = result;
    _cacheMtime = stat.mtimeMs;
    return result;
  } catch (e) {
    return { loaded: false, reason: e.message, friction_points: [] };
  }
}

/**
 * 格式化风险提示（供渲染器启动时打印）
 */
export function formatRiskWarnings(memory) {
  if (!memory.loaded || memory.high_friction_points.length === 0) {
    return "";
  }

  const lines = [];
  lines.push("");
  lines.push("━━━ 🧠 活记忆风险提示 ━━━");
  lines.push(`已加载 ${memory.total_friction_points} 条历史摩擦点，最近高摩擦类别：${memory.all_categories.slice(0, 3).join("、") || "无"}`);
  lines.push("");
  for (const fp of memory.high_friction_points) {
    lines.push(`  ⚡ [${fp.id}] ${fp.category || "未分类"}: ${fp.description}`);
    if (fp.resolution) lines.push(`     → ${fp.resolution}`);
  }
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━");
  return lines.join("\n");
}

/**
 * 格式化 L3 人工确认附加项（供 preflight 附加到报告）
 */
export function formatL3MemoryItems(memory) {
  if (!memory.loaded || memory.recent_friction_points.length === 0) {
    return [];
  }

  return memory.recent_friction_points.map((fp) => ({
    level: "L3",
    id: `memory_${fp.id}`,
    message: `[活记忆] ${fp.description}${fp.resolution ? ` → ${fp.resolution}` : ""}`,
    source: "living_memory",
    friction_id: fp.id,
    category: fp.category,
    auto_detect: false,
  }));
}

// ── CLI 测试入口 ──
function main() {
  const memory = loadLivingMemory();
  console.log(formatRiskWarnings(memory));
  const l3Items = formatL3MemoryItems(memory);
  if (l3Items.length > 0) {
    console.log("\nL3 附加项:");
    for (const item of l3Items) {
      console.log(`  ${item.id}: ${item.message}`);
    }
  }
  console.log("\n" + JSON.stringify({
    loaded: memory.loaded,
    evolution_count: memory.evolution_count,
    last_updated: memory.last_updated,
    total_friction_points: memory.total_friction_points,
    recent_count: memory.recent_friction_points.length,
    high_count: memory.high_friction_points.length,
    categories: memory.all_categories,
  }, null, 2));
}

const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
  (fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
);
if (isMain) {
  main();
}

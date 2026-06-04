#!/usr/bin/env bash
# =============================================================================
# 隐私门禁 — 扫描仓库中的敏感信息
#
# 用法：./scripts/privacy-check.sh [--full]
#   --full    全量扫描（CI 模式）
#   无参数     扫描 git diff（pre-push 模式，仅检查即将推送的变更）
#
# P0 阻断项（命中任一项返回退出码 1）：
#   - API 密钥（OpenAI/GitHub/Slack/AWS 等已知格式）
#   - 私钥（PEM/SSH）
#   - JWT Token
#   - 通用凭据赋值（SECRET/TOKEN/PASSWORD/API_KEY 后跟非占位值）
#   - 内网 IP
# =============================================================================

set -euo pipefail

MODE="${1:-}"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

blocked=0
warned=0

# 排除列表
EXCLUDE=(
  ':!scripts/privacy-check.sh'
  ':!.env.example'
  ':!.git/**'
  ':!node_modules/**'
  ':!.github/workflows/privacy-check.yml'
  ':!references/khazix-writer/**'
)

# =============================================================================
# 执行 git grep，返回匹配行数
# =============================================================================

run_grep() {
  local pattern="$1"
  if [ "$MODE" = "--full" ]; then
    git grep -n --color=never -P "$pattern" -- "${EXCLUDE[@]}" 2>/dev/null || true
  else
    local files
    files=$(git diff --cached --name-only 2>/dev/null || git diff --name-only HEAD~1..HEAD 2>/dev/null || true)
    if [ -n "$files" ]; then
      echo "$files" | xargs -r git grep -n --color=never -P "$pattern" -- 2>/dev/null || true
    fi
  fi
}

block() {
  local desc="$1" pattern="$2"
  local matches
  matches=$(run_grep "$pattern")
  if [ -n "$matches" ]; then
    echo -e "${RED}[BLOCKED]${NC} $desc"
    echo "$matches"
    echo ""
    blocked=$((blocked + $(echo "$matches" | wc -l | tr -d ' ')))
  fi
}

warn() {
  local desc="$1" pattern="$2"
  local matches
  matches=$(run_grep "$pattern")
  if [ -n "$matches" ]; then
    echo -e "${YELLOW}[WARN]${NC}  $desc"
    echo "$matches"
    echo ""
    warned=$((warned + $(echo "$matches" | wc -l | tr -d ' ')))
  fi
}

# =============================================================================
# 主流程
# =============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  隐私门禁 Privacy Gate"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "--- P0 阻断规则 ---"
block "OpenAI API Key (sk-...)" \
  'sk-(proj-)?[A-Za-z0-9]{20,}'

block "GitHub PAT (ghp_...)" \
  'ghp_[A-Za-z0-9]{36,}'

block "Slack Token (xox[bprs]-...)" \
  'xox[bprs]-[A-Za-z0-9-]{10,}'

block "AWS Access Key (AKIA...)" \
  'AKIA[0-9A-Z]{16}'

block "Private Key (BEGIN...PRIVATE KEY)" \
  '-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'

block "JWT Token (eyJ...eyJ...)" \
  'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]{10,}'

block "Credentials assignment (非占位值)" \
  '(SECRET|TOKEN|PASSWORD|API_KEY|APP_SECRET|ACCESS_KEY)\s*=\s*["\x27]?[a-zA-Z0-9!@#$%^&*()_+\-]{8,}["\x27]?'

block "Internal IP (192.168 / 10.x / 172.16-31)" \
  '(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})'

echo "--- P1 警告规则 ---"
warn "Personal email" \
  '[a-zA-Z0-9._%+-]+@(?!example\.com|test\.com|localhost)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'

warn "CN mobile phone" \
  '1[3-9][0-9]{9}'

# =============================================================================
# 结果
# =============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$blocked" -gt 0 ]; then
  echo -e "${RED}✗ 隐私门禁未通过：发现 $blocked 个 P0 阻断项${NC}"
  echo ""
  echo "  请移除上述敏感信息后重新提交。"
  echo "  如果误报，请在 $0 中更新排除规则。"
  exit 1
fi

if [ "$warned" -gt 0 ]; then
  echo -e "${GREEN}✓${NC} P0 阻断项：0"
  echo -e "${YELLOW}⚠${NC}  P1 警告项：$warned（不阻断，请确认是否需要公开）"
else
  echo -e "${GREEN}✓ 隐私门禁通过 — 未发现敏感信息${NC}"
fi

exit 0

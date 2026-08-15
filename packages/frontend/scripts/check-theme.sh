#!/usr/bin/env bash
# Fails if hardcoded color patterns are reintroduced into src/.
# Allowlist:
#   - bg-black/N (intentional dark scrim regardless of theme)
#   - bg-[#1877F2] (Facebook brand color, immutable)
#   - chart fill="#..." / stroke="#..." (handled via useChartColors)
#   - inline style={{ color: 'rgba(...)' }} (legacy, separate cleanup)

set -euo pipefail

cd "$(dirname "$0")/.."

PATTERNS=(
  'bg-white/[0-9]+'
  'border-white/[0-9]+'
  'hover:bg-white/[0-9]+'
  'hover:border-white/[0-9]+'
  '\btext-white\b'
  'hover:text-white\b'
  'text-\[#a1a4a5\]'
  'text-\[#d4d7d8\]'
  'bg-\[#d1fe17\]'
  'text-\[#d1fe17\]'
  'border-\[#d1fe17\]'
  'hover:bg-\[#d1fe17\]'
  'bg-\[#0a0c0e\]'
  'bg-\[#0f1419\]'
  'bg-\[#151b22\]'
)

JOINED=$(IFS='|'; echo "${PATTERNS[*]}")

# Skip ui/ kit when checking (already swept; uses semantic tokens for non-overlay parts)
MATCHES=$(grep -rEn "$JOINED" src --include="*.tsx" --include="*.ts" \
  | grep -v 'src/components/ui/' \
  | grep -v '// theme-allow' \
  || true)

if [ -n "$MATCHES" ]; then
  echo "❌ Hardcoded color tokens detected. Use semantic tokens (bg-foreground/N, text-muted-foreground, bg-primary, text-accent-readable, etc.)"
  echo ""
  echo "$MATCHES"
  echo ""
  echo "If a usage is intentional (e.g. brand color), append: // theme-allow: <reason>"
  exit 1
fi

echo "✓ No hardcoded color tokens found in src/"

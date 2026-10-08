#!/usr/bin/env bash
# Reports whether local image processing is ready. Read-only: installs nothing.
# Usage: scripts/check-processing.sh [api-base-url]   (default: http://localhost:$PORT from backend/.env, else 5000)

set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }

PORT="$(grep -E '^PORT=' "$BACKEND/.env" 2>/dev/null | tail -1 | cut -d= -f2)"
API="${1:-http://localhost:${PORT:-5000}}"

echo "Local runtimes"
if [[ -x "$BACKEND/python/.venv/bin/python" ]]; then
  ok "Python venv: $("$BACKEND/python/.venv/bin/python" -c 'import platform; print(platform.python_version())'), BiRefNet-Massive $([[ -s "$BACKEND/python/.models/birefnet-massive/model.safetensors" ]] && echo ready || echo missing)"
else
  bad "Python venv missing (run scripts/setup-ml.sh)"
fi
if [[ -x "$BACKEND/vendor/upscayl/upscayl-bin" ]]; then
  ok "upscayl-bin present; models: $(ls "$BACKEND/vendor/upscayl/models" 2>/dev/null | sed -n 's/\.param$//p' | paste -sd, -)"
else
  bad "upscayl-bin missing (run scripts/setup-ml.sh, or set UPSCAYL_BINARY_PATH)"
fi

echo; echo "API ($API)"
if json="$(curl -fsS --max-time 5 "$API/api/health/processors" 2>/dev/null)"; then
  echo "$json" | python3 -c '
import json, sys
d = json.load(sys.stdin)["data"]
bg, up = d["backgroundRemoval"], d["upscaling"]
mark = lambda b: "\033[32m✓\033[0m" if b else "\033[31m✗\033[0m"
print(f"  {mark(bg['"'"'available'"'"'])} Background removal: {bg['"'"'status'"'"']} (model {bg['"'"'model'"'"']})")
gpu = f", GPU {up['"'"'gpu'"'"']}" if up.get("gpu") else ""
why = f" — {up['"'"'message'"'"']}" if up.get("message") else ""
print(f"  {mark(up['"'"'available'"'"'])} Upscaling: {up['"'"'status'"'"']} (model {up['"'"'model'"'"']}{gpu}){why}")
'
else
  bad "API not reachable — start it with 'npm run dev' in backend/"
fi

#!/usr/bin/env bash
# Runs this Mac as the AI server for the live site: background removal, passport photos and upscaling,
# at full quality, reached through Tailscale Funnel (a public HTTPS address for this Mac).
#
#   npm run ai-server        (from the repository root)
#
# Needs: scripts/setup-ml.sh done once, and Tailscale installed and logged in, with Funnel allowed.
# Stop it with Ctrl+C; the tunnel is closed too. Keep the Mac awake while it runs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${AI_SERVER_PORT:-5050}"
SITE="${SITE_URL:-https://imagetools-358n.onrender.com}"

TS="$(command -v tailscale || true)"
[[ -z "$TS" && -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]] && TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
if [[ -z "$TS" ]]; then
  echo "Tailscale isn't installed. Install it (brew install --cask tailscale, or the Mac App Store), log in, then run this again." >&2
  exit 1
fi

echo "Building the API…"
(cd "$ROOT/backend" && npm run build >/dev/null)

cleanup() {
  "$TS" funnel --https=443 off >/dev/null 2>&1 || true
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting the API on port $PORT…"
(
  cd "$ROOT/backend"
  # backend/.env still applies (models, limits); these settings are for serving the live site.
  PORT="$PORT" NODE_ENV=production FRONTEND_URL="$SITE,http://localhost:5173" TRUST_PROXY=1 node dist/server.js
) &
API_PID=$!

for _ in $(seq 1 60); do
  curl -fs "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fs "http://localhost:$PORT/api/health" >/dev/null || { echo "The API didn't start; see the messages above." >&2; exit 1; }

echo "Opening the tunnel…"
"$TS" funnel --bg "$PORT" >/dev/null
ADDRESS="$("$TS" funnel status 2>/dev/null | grep -Eo 'https://[^ ]+' | head -1 | sed 's#/$##')"

echo
echo "  AI server is live at: ${ADDRESS:-(see: tailscale funnel status)}"
echo "  On Render, the site's VITE_AI_API_BASE_URL must be exactly that address."
echo "  Press Ctrl+C to stop."
wait "$API_PID"

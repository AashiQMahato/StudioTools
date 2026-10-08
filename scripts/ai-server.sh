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

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
# Something else on the port (another server, or one left from an earlier run): use the next free one.
if port_busy "$PORT"; then
  taken="$PORT"
  for candidate in $(seq $((PORT + 1)) $((PORT + 49))); do
    port_busy "$candidate" || { PORT="$candidate"; break; }
  done
  [[ "$PORT" == "$taken" ]] && { echo "Ports $taken–$((taken + 49)) are all in use. Set AI_SERVER_PORT to a free one." >&2; exit 1; }
  echo "Port $taken is in use ($(lsof -nP -iTCP:"$taken" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1" pid "$2}')) — using $PORT instead."
fi
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

echo "Starting the API on port ${PORT}…"
(
  cd "$ROOT/backend"
  # backend/.env still applies (models, limits); these settings are for serving the live site.
  # exec: this process becomes the server, so stopping the script stops it too (none left running).
  PORT="$PORT" NODE_ENV=production FRONTEND_URL="$SITE,http://localhost:5173" TRUST_PROXY=1 exec node dist/server.js
) &
API_PID=$!

# Up only when *our* server answers: it must still be running (not exited, e.g. on a port clash).
started=false
for _ in $(seq 1 90); do
  kill -0 "$API_PID" 2>/dev/null || break
  curl -fs "http://localhost:$PORT/api/health" >/dev/null 2>&1 && { started=true; break; }
  sleep 1
done
$started || { echo "The API didn't start; see the messages above." >&2; exit 1; }

echo "Opening the tunnel… (the first time, Tailscale may print a link to allow Funnel — open it, approve, then run this again)"
"$TS" funnel --bg "$PORT"
ADDRESS="$("$TS" funnel status 2>/dev/null | grep -Eo 'https://[^ ]+' | head -1 | sed 's#/$##')"

echo
echo "  AI server is live at: ${ADDRESS:-(see: tailscale funnel status)}"
echo "  On Render, the site's VITE_AI_API_BASE_URL must be exactly that address."
echo "  Press Ctrl+C to stop."
wait "$API_PID"

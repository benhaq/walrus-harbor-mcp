#!/bin/bash
# Quick verification script for harbor-mcp
# This mimics what Claude Code does when connecting to a stdio MCP server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo "🔍 Verifying harbor-mcp server..."
echo ""

# Load .env if present
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

if [ -z "$HARBOR_API_KEY" ]; then
  echo "❌ HARBOR_API_KEY is not set"
  echo "   Please set it in .env or export it"
  exit 1
fi

echo "✅ HARBOR_API_KEY is set (starts with: ${HARBOR_API_KEY:0:8}...)"

if [ -n "$HARBOR_SERVICE_PRIVATE_KEY" ]; then
  echo "✅ HARBOR_SERVICE_PRIVATE_KEY is set"
else
  echo "⚠️  HARBOR_SERVICE_PRIVATE_KEY is not set (some tools will fail)"
fi

echo ""
echo "🚀 Starting harbor-mcp in the background for 8 seconds..."
echo "   (This tests whether the server starts and responds to initialize)"

# Start the server and send a basic initialize request
timeout 8s bash -c '
  echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"verify-script\",\"version\":\"1.0\"}}}" | \
  pnpm exec tsx bin/harbor-mcp.ts 2>/tmp/harbor-mcp-verify.log || true
' || true

echo ""
echo "📋 Last 30 lines of server log (/tmp/harbor-mcp-verify.log):"
echo "------------------------------------------------------------"
tail -30 /tmp/harbor-mcp-verify.log 2>/dev/null || echo "(no log file yet)"

echo ""
echo "✅ Verification complete."
echo ""
echo "Next steps:"
echo "  1. Register this server with its ABSOLUTE path (run from the repo root):"
echo "       claude mcp add --scope user walrus-harbor-mcp -- \"\$(pwd)/bin/harbor-mcp.sh\""
echo "     (other agents: use the path printed by 'echo \"\$(pwd)/bin/harbor-mcp.sh\"')"
echo "  2. Restart Claude Code, then type /mcp to see the server and approve it"
echo "  3. Try calling the 'ping_harbor' or 'list_spaces' tool"

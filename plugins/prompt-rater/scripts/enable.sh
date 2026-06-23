#!/usr/bin/env bash
#
# Wire the bundled prompt-rater status line into the user's Claude Code settings.
# Idempotent; backs up settings.json before editing.
#
set -euo pipefail

# Resolve the plugin root (provided by Claude Code; fall back to script location).
ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SCRIPT="$ROOT/statusline-prompt-rater.js"
SETTINGS="$HOME/.claude/settings.json"
CMD="node \"$SCRIPT\""

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: 'node' is not on your PATH. Install Node.js, then re-run /prompt-rater:enable." >&2
  exit 1
fi

mkdir -p "$HOME/.claude"

if command -v jq >/dev/null 2>&1; then
  if [ -f "$SETTINGS" ]; then
    cp "$SETTINGS" "$SETTINGS.bak"
    tmp="$(mktemp)"
    jq --arg cmd "$CMD" '.statusLine = {type: "command", command: $cmd}' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
    echo "✓ prompt-rater enabled (backup: $SETTINGS.bak)"
  else
    jq -n --arg cmd "$CMD" '{statusLine: {type: "command", command: $cmd}}' > "$SETTINGS"
    echo "✓ prompt-rater enabled (created $SETTINGS)"
  fi
  echo "  status line → $SCRIPT"
  echo "  Takes effect on the next render / restart of Claude Code."
else
  echo "! 'jq' not found — add this to $SETTINGS manually:"
  echo
  echo '  "statusLine": {'
  echo '    "type": "command",'
  echo "    \"command\": \"$CMD\""
  echo '  }'
fi

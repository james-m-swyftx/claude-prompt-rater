#!/usr/bin/env bash
#
# Remove the prompt-rater status line from the user's Claude Code settings.
# Only touches statusLine if it currently points at prompt-rater.
#
set -euo pipefail

SETTINGS="$HOME/.claude/settings.json"

if [ ! -f "$SETTINGS" ]; then
  echo "Nothing to do — $SETTINGS does not exist."
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "! 'jq' not found — remove the \"statusLine\" block from $SETTINGS manually."
  exit 0
fi

if jq -e '.statusLine.command // "" | test("statusline-prompt-rater")' "$SETTINGS" >/dev/null 2>&1; then
  cp "$SETTINGS" "$SETTINGS.bak"
  tmp="$(mktemp)"
  jq 'del(.statusLine)' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
  echo "✓ prompt-rater status line removed (backup: $SETTINGS.bak)"
else
  echo "Your statusLine isn't prompt-rater — leaving it untouched."
fi

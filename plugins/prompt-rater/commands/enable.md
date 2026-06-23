---
description: Turn on the prompt-rater status line (wires it into your settings.json)
allowed-tools: Bash(bash:*)
---

Enabling the prompt-rater status line:

!bash "${CLAUDE_PLUGIN_ROOT}/scripts/enable.sh"

If the script above reported success, tell the user the status line is enabled and
will appear at the bottom on the next render or restart. If it reported an error
(e.g. missing `node` or `jq`), relay the exact fix it printed.

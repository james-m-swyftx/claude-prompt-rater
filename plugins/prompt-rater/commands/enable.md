---
description: Turn on the prompt-rater status line (wires it into your settings.json)
allowed-tools: Bash(bash:*)
---

Enable the prompt-rater status line by running this exact command with the Bash tool:

```
bash "${CLAUDE_PLUGIN_ROOT}/scripts/enable.sh"
```

Then report the result to the user: if it succeeded, tell them the status line is
enabled and will appear at the bottom on the next render or restart. If it printed
an error (e.g. missing `node` or `jq`), relay the exact fix it gave.

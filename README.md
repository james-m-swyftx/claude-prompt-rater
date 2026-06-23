# swyftx-claude-tools — Claude Code plugin marketplace

A small internal marketplace. Currently ships one plugin:

## `prompt-rater`

Adds a status line to the bottom of the Claude Code CLI that **grades your most
recent prompt** — so you get instant feedback on how well you're prompting.

```
Opus 4.8 · platform  ✎ Prompt: A- (87) · strong: context, clear ask · try: add success criteria
```

It scores five things a good prompt has — detail, context (filenames/code/paths),
a clear ask, constraints/output format, and success criteria — minus a penalty for
vague phrasing. **Pure local heuristics: no LLM call, zero latency, zero token cost.**

### Install

```bash
# Add this marketplace (GitHub shorthand once it's pushed, or a local path to test)
/plugin marketplace add <owner>/<repo>

# Install the plugin
/plugin install prompt-rater@swyftx-claude-tools

# Turn the status line on (writes to your ~/.claude/settings.json, with a backup)
/prompt-rater:enable
```

Requires `node` on your PATH (`jq` recommended for safe settings merges).

> **Why the extra `/prompt-rater:enable` step?** Claude Code plugins can't register
> a main-session status line directly — only the user's `settings.json` can. So the
> plugin bundles the script and the enable command wires it in for you. Re-run
> `/prompt-rater:enable` after a plugin update so the path stays current.

### Disable

```bash
/prompt-rater:disable
```

### Layout

```
.claude-plugin/marketplace.json     # marketplace listing
plugins/prompt-rater/
├── .claude-plugin/plugin.json      # plugin manifest
├── statusline-prompt-rater.js      # the status line script
├── commands/{enable,disable}.md    # /prompt-rater:enable | :disable
└── scripts/{enable,disable}.sh     # wire/unwire settings.json
```

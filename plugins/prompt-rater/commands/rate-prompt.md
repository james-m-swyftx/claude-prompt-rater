---
description: Deep, LLM-judged critique of a prompt, using Anthropic's Claude Code expertise rubric
argument-hint: [prompt to rate — omit to rate your previous message]
---

Rate the quality of a prompt written for Claude Code, then return a critique and an improved rewrite.

Ground your judgement in Anthropic's research on Claude Code expertise
(https://www.anthropic.com/research/claude-code-expertise): effectiveness comes
from **domain expertise expressed in the prompt**, not coding skill. The strongest
signals are precise framing, what the author asks Claude to **verify**, clear
delegation of the *what* while leaving the *how* to the agent, and demonstrated
domain context (specific files, rules, edge cases).

## Prompt to rate

$ARGUMENTS

If the section above is empty, rate the user's **most recent message before this
command** (their previous prompt in this conversation) instead.

## Scoring — score each dimension, then sum to /100

1. **Domain context (25)** — references concrete specifics (files, functions, data,
   business rules, constraints) that show the author knows the domain. Generic/vague → low.
2. **Success criteria & verification (25)** — defines what "done" looks like and asks
   Claude to prove it (tests pass, build succeeds, git commit, explicit confirmation).
   No definition of done → low.
3. **Clear delegation — the "what" (20)** — the objective is unambiguous and singular;
   Claude could restate the goal in one sentence.
4. **Right altitude — the "how" (15)** — delegates implementation to Claude (manager-style)
   rather than over-prescribing every step or under-specifying entirely. Both extremes lose points.
5. **Edge cases & scope (15)** — flags error paths / edge cases, or explicitly bounds scope
   (what NOT to touch).

Deduct for vagueness ("fix it", "make it work", unresolved "it/this/that").

## Output — keep it tight

- **Grade: `<letter>` (`<score>`/100)** + a one-line verdict.
- **Per dimension:** one line each — `✓/△/✗ Name n/max — reason`.
- **Top gaps:** the 1–3 highest-leverage things missing, each tied to the expert
  behaviour it reflects.
- **Rewrite:** a concrete, improved prompt that would score ≥90. Use the author's
  real context where known; **do not invent specifics** — mark any guesses as
  `[assumption]`.

Be specific and honest — a mediocre prompt earns a mediocre grade. This is on-demand,
LLM-judged feedback; it complements the always-on heuristic status line.

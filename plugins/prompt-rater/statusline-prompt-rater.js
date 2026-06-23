#!/usr/bin/env node
/**
 * Claude Code status line: rates the quality of your most recent prompt.
 *
 * Reads the session transcript (path supplied on stdin by Claude Code), finds
 * the last prompt YOU typed, and scores it on five dimensions with cheap, fast
 * heuristics (no LLM call — the status line re-renders too often for that).
 *
 * Output: <model · dir>  ✎ Prompt: <grade> (<score>) · strong: … · try: …
 */

'use strict'

const fs = require('fs')

// ---------- read the JSON Claude Code pipes in on stdin ----------
function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

// ---------- pull the last human-typed prompt out of the transcript ----------
function lastUserPrompt(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return ''
  const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (obj.type !== 'user' || obj.isMeta) continue
    const msg = obj.message
    if (!msg || msg.role !== 'user') continue

    let text = ''
    if (typeof msg.content === 'string') {
      text = msg.content
    } else if (Array.isArray(msg.content)) {
      // Skip tool results — those are not prompts the user typed.
      if (msg.content.some((b) => b && b.type === 'tool_result')) continue
      text = msg.content
        .filter((b) => b && b.type === 'text')
        .map((b) => b.text)
        .join('\n')
    }
    const cleaned = stripNoise(text)
    if (cleaned) return cleaned
  }
  return ''
}

// Remove command wrappers / system reminders so we score what you actually wrote.
function stripNoise(text) {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, ' ')
    .replace(/<command-[^>]*>[\s\S]*?<\/command-[^>]*>/gi, ' ')
    .replace(/<local-command-[^>]*>[\s\S]*?<\/local-command-[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------- the rubric ----------
function score(prompt) {
  const t = prompt.toLowerCase()
  const words = prompt.split(/\s+/).filter(Boolean)
  const wc = words.length
  const dims = {}

  // 1. Substance / length (0-25)
  if (wc <= 2) dims.length = 4
  else if (wc <= 6) dims.length = 12
  else if (wc <= 150) dims.length = 25
  else dims.length = 19 // very long prompts often ramble

  // 2. Specificity / concrete referents (0-25)
  let spec = 0
  if (/`[^`]+`/.test(prompt)) spec += 9 // backticked code/identifiers
  if (/[\w-]+\.[a-z]{1,5}\b/.test(prompt)) spec += 7 // filenames / extensions
  if (/[\/\\][\w.-]+/.test(prompt)) spec += 4 // paths
  if (/[a-z][a-zA-Z]*[A-Z]|[a-z]+_[a-z]+/.test(prompt)) spec += 4 // camelCase / snake_case
  if (/["'][^"']{3,}["']/.test(prompt)) spec += 4 // quoted literals
  if (/\b\d+\b/.test(prompt)) spec += 2 // concrete numbers
  dims.specificity = Math.min(25, spec)

  // 3. Clear, actionable ask (0-20)
  const verbs =
    /\b(add|fix|create|build|refactor|explain|write|update|remove|delete|implement|review|test|debug|optimi[sz]e|rename|move|generate|convert|compare|summari[sz]e|analy[sz]e|design|document|investigate|rate|check|find|list)\b/
  let ask = 0
  if (verbs.test(t)) ask += 14
  if (prompt.includes('?')) ask += 6
  dims.ask = Math.min(20, ask)

  // 4. Constraints / output format (0-15)
  const constraints =
    /\b(must|should|don'?t|do not|only|without|instead of|format|return|output|as a|in (?:json|yaml|markdown|typescript|python|bash)|no |avoid|keep it|limit|max(?:imum)?|min(?:imum)?)\b/
  dims.constraints = constraints.test(t) ? 15 : 0

  // 5. Success criteria / examples / verification (0-15)
  const success =
    /\b(for example|e\.g\.|such as|expected|so that|make sure|ensure|verify|test that|should (?:pass|return|equal)|acceptance|definition of done|like this)\b/
  dims.success = success.test(t) ? 15 : 0

  let total =
    dims.length + dims.specificity + dims.ask + dims.constraints + dims.success

  // Vagueness penalty
  const vague =
    /\b(fix it|make it work|do the thing|the stuff|whatever|something like that|as before|you know|etc\b)/
  let penalty = 0
  if (vague.test(t)) penalty += 12
  if (wc <= 3 && !verbs.test(t)) penalty += 6
  total = Math.max(0, total - penalty)

  return { total: Math.round(total), dims, wc }
}

function grade(s) {
  if (s >= 92) return 'A'
  if (s >= 85) return 'A-'
  if (s >= 78) return 'B+'
  if (s >= 70) return 'B'
  if (s >= 62) return 'B-'
  if (s >= 54) return 'C+'
  if (s >= 45) return 'C'
  if (s >= 35) return 'D'
  return 'F'
}

const LABEL = {
  length: 'detail',
  specificity: 'context',
  ask: 'clear ask',
  constraints: 'constraints',
  success: 'success criteria'
}
const MAX = { length: 25, specificity: 25, ask: 20, constraints: 15, success: 15 }
const TIP = {
  length: 'add more detail',
  specificity: 'name the file/symbol',
  ask: 'lead with an action verb',
  constraints: 'state constraints/output format',
  success: 'add success criteria'
}

function strengths(dims) {
  return Object.keys(dims)
    .filter((k) => dims[k] / MAX[k] >= 0.75)
    .map((k) => LABEL[k])
    .slice(0, 2)
}

function weakest(dims) {
  let lo = null
  let loFrac = 1
  for (const k of Object.keys(dims)) {
    const frac = dims[k] / MAX[k]
    if (frac < loFrac) {
      loFrac = frac
      lo = k
    }
  }
  return loFrac < 0.7 ? lo : null
}

// ---------- colour ----------
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
}
function gradeColor(s) {
  if (s >= 78) return C.green
  if (s >= 62) return C.cyan
  if (s >= 45) return C.yellow
  return C.red
}
// A 5-segment meter, filled proportionally to the score and tinted by grade.
function meter(total, col) {
  const filled = Math.max(0, Math.min(5, Math.round(total / 20)))
  return `${col}${'▰'.repeat(filled)}${C.dim}${'▱'.repeat(5 - filled)}${C.reset}`
}

// ---------- main ----------
function main() {
  let data = {}
  try {
    data = JSON.parse(readStdin() || '{}')
  } catch {
    data = {}
  }

  const model = (data.model && data.model.display_name) || 'Claude'
  const dir =
    (data.workspace && data.workspace.current_dir) || data.cwd || ''
  const base = dir ? dir.split('/').pop() : ''
  const left = `${C.dim}${model}${base ? ' · ' + base : ''}${C.reset}`

  const prompt = lastUserPrompt(data.transcript_path)
  if (!prompt) {
    process.stdout.write(`${left}  ${C.dim}✎ awaiting prompt…${C.reset}`)
    return
  }

  const { total, dims } = score(prompt)
  const g = grade(total)
  const col = gradeColor(total)
  const str = strengths(dims)
  const weak = weakest(dims)

  let out =
    `${left}  ${C.dim}✎${C.reset} ` +
    `${col}${C.bold}${g}${C.reset} ${meter(total, col)} ${C.dim}${total}${C.reset}`
  if (str.length) {
    out += `  ${C.green}✓${C.reset} ${C.dim}${str.join(', ')}${C.reset}`
  }
  if (weak) {
    out += `  ${C.yellow}→ ${TIP[weak]}${C.reset}`
  }

  process.stdout.write(out)
}

main()

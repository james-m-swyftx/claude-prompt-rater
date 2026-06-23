#!/usr/bin/env node
/**
 * Claude Code status line.
 *
 * Left → right:
 *   model · dir · git-branch  │  ctx-tokens % ▰meter · $cost · +lines -lines · duration  │  ✎ grade score · HH:MM AEST
 *
 * Prompt grade is a fast local heuristic (no LLM call). Usage/cost/lines/duration
 * come from the JSON Claude Code pipes in on stdin; context tokens and the last
 * prompt's timestamp are read from the session transcript.
 */

'use strict'

const fs = require('fs')
const cp = require('child_process')

// ---------- stdin ----------
function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

// ---------- transcript: last prompt text + its time + current context size ----------
function parseTranscript(path) {
  const res = { prompt: '', promptTime: null, contextTokens: 0 }
  if (!path || !fs.existsSync(path)) return res
  const lines = fs.readFileSync(path, 'utf8').split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }

    // Most recent token usage = how full the context window is.
    if (!res.contextTokens && obj.message && obj.message.usage) {
      const u = obj.message.usage
      res.contextTokens =
        (u.input_tokens || 0) +
        (u.cache_read_input_tokens || 0) +
        (u.cache_creation_input_tokens || 0)
    }

    // Most recent prompt the user actually typed.
    if (!res.prompt && obj.type === 'user' && !obj.isMeta) {
      const msg = obj.message
      if (msg && msg.role === 'user') {
        let text = ''
        if (typeof msg.content === 'string') {
          text = msg.content
        } else if (Array.isArray(msg.content)) {
          // Skip tool results — not something the user typed.
          if (!msg.content.some((b) => b && b.type === 'tool_result')) {
            text = msg.content
              .filter((b) => b && b.type === 'text')
              .map((b) => b.text)
              .join('\n')
          }
        }
        const cleaned = stripNoise(text)
        if (cleaned) {
          res.prompt = cleaned
          res.promptTime = obj.timestamp || null
        }
      }
    }

    if (res.prompt && res.contextTokens) break
  }
  return res
}

// Strip command wrappers / system reminders so we score what you actually wrote.
function stripNoise(text) {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, ' ')
    .replace(/<command-[^>]*>[\s\S]*?<\/command-[^>]*>/gi, ' ')
    .replace(/<local-command-[^>]*>[\s\S]*?<\/local-command-[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------- prompt-quality rubric ----------
function score(prompt) {
  const t = prompt.toLowerCase()
  const words = prompt.split(/\s+/).filter(Boolean)
  const wc = words.length
  let total = 0

  // Substance (0-25)
  if (wc <= 2) total += 4
  else if (wc <= 6) total += 12
  else if (wc <= 150) total += 25
  else total += 19

  // Specificity (0-25)
  let spec = 0
  if (/`[^`]+`/.test(prompt)) spec += 9
  if (/[\w-]+\.[a-z]{1,5}\b/.test(prompt)) spec += 7
  if (/[\/\\][\w.-]+/.test(prompt)) spec += 4
  if (/[a-z][a-zA-Z]*[A-Z]|[a-z]+_[a-z]+/.test(prompt)) spec += 4
  if (/["'][^"']{3,}["']/.test(prompt)) spec += 4
  if (/\b\d+\b/.test(prompt)) spec += 2
  total += Math.min(25, spec)

  // Clear ask (0-20)
  const verbs =
    /\b(add|fix|create|build|refactor|explain|write|update|remove|delete|implement|review|test|debug|optimi[sz]e|rename|move|generate|convert|compare|summari[sz]e|analy[sz]e|design|document|investigate|rate|check|find|list)\b/
  let ask = 0
  if (verbs.test(t)) ask += 14
  if (prompt.includes('?')) ask += 6
  total += Math.min(20, ask)

  // Constraints / format (0-15)
  if (
    /\b(must|should|don'?t|do not|only|without|instead of|format|return|output|as a|in (?:json|yaml|markdown|typescript|python|bash)|no |avoid|keep it|limit|max(?:imum)?|min(?:imum)?)\b/.test(
      t
    )
  ) {
    total += 15
  }

  // Success criteria / examples (0-15)
  if (
    /\b(for example|e\.g\.|such as|expected|so that|make sure|ensure|verify|test that|should (?:pass|return|equal)|acceptance|definition of done|like this)\b/.test(
      t
    )
  ) {
    total += 15
  }

  // Vagueness penalty
  if (
    /\b(fix it|make it work|do the thing|the stuff|whatever|something like that|as before|you know|etc\b)/.test(
      t
    )
  ) {
    total -= 12
  }
  if (wc <= 3 && !verbs.test(t)) total -= 6

  return Math.max(0, Math.round(total))
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

// ---------- colour + formatting helpers ----------
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m'
}
const SEP = ` ${C.dim}·${C.reset} `
const GROUP = ` ${C.dim}│${C.reset} `

function gradeColor(s) {
  if (s >= 78) return C.green
  if (s >= 62) return C.cyan
  if (s >= 45) return C.yellow
  return C.red
}
// Fuller context = worse, so colour inverts relative to the grade scale.
function ctxColor(pct) {
  if (pct < 50) return C.green
  if (pct < 80) return C.yellow
  return C.red
}
// 5-segment meter filled proportionally (value is a 0-100 percentage).
function meter(pct, col) {
  const filled = Math.max(0, Math.min(5, Math.round(pct / 20)))
  return `${col}${'▰'.repeat(filled)}${C.dim}${'▱'.repeat(5 - filled)}${C.reset}`
}
function fmtTokens(n) {
  if (n >= 1000) {
    const k = n / 1000
    return (k >= 100 ? Math.round(k) : Math.round(k * 10) / 10) + 'k'
  }
  return String(n)
}
function fmtDuration(ms) {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h${m % 60}m`
}
function fmtAEST(iso) {
  if (!iso) return null
  try {
    // Australia/Brisbane is permanently UTC+10 (no DST) = AEST.
    return new Date(iso).toLocaleTimeString('en-AU', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Australia/Brisbane'
    })
  } catch {
    return null
  }
}
function gitInfo(dir) {
  if (!dir) return null
  const run = (cmd) =>
    cp
      .execSync(cmd, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], timeout: 300 })
      .toString()
      .trim()
  try {
    const branch = run('git rev-parse --abbrev-ref HEAD')
    if (!branch) return null
    let dirty = false
    try {
      dirty = run('git status --porcelain').length > 0
    } catch {}
    return { branch, dirty }
  } catch {
    return null
  }
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
  const modelId = (data.model && data.model.id) || ''
  const dir = (data.workspace && data.workspace.current_dir) || data.cwd || ''
  const base = dir ? dir.split('/').pop() : ''
  const cost = data.cost || {}
  const { prompt, promptTime, contextTokens } = parseTranscript(data.transcript_path)

  // --- identity group ---
  const idParts = [`${C.dim}${model}${C.reset}`]
  if (base) idParts.push(`${C.dim}${base}${C.reset}`)
  const git = gitInfo(dir)
  if (git) idParts.push(`${C.magenta}${git.branch}${git.dirty ? '*' : ''}${C.reset}`)

  // --- usage group ---
  const usageParts = []
  if (contextTokens > 0) {
    const limit = /\[?1m\]?/i.test(modelId + model) ? 1000000 : 200000
    const pct = Math.min(100, Math.round((contextTokens / limit) * 100))
    const col = ctxColor(pct)
    usageParts.push(
      `${col}${fmtTokens(contextTokens)} ${pct}%${C.reset} ${meter(pct, col)}`
    )
  }
  if (typeof cost.total_cost_usd === 'number') {
    usageParts.push(`${C.cyan}$${cost.total_cost_usd.toFixed(2)}${C.reset}`)
  }
  const added = cost.total_lines_added || 0
  const removed = cost.total_lines_removed || 0
  if (added || removed) {
    usageParts.push(
      `${C.green}+${added}${C.reset} ${C.red}-${removed}${C.reset}`
    )
  }
  if (typeof cost.total_duration_ms === 'number' && cost.total_duration_ms > 0) {
    usageParts.push(`${C.dim}${fmtDuration(cost.total_duration_ms)}${C.reset}`)
  }

  // --- prompt group ---
  let promptSeg
  if (prompt) {
    const s = score(prompt)
    const gcol = gradeColor(s)
    promptSeg = `${C.dim}✎${C.reset} ${gcol}${C.bold}${grade(s)}${C.reset} ${C.dim}${s}${C.reset}`
    const time = fmtAEST(promptTime)
    if (time) promptSeg += `${SEP}${C.dim}${time} AEST${C.reset}`
  } else {
    promptSeg = `${C.dim}✎ awaiting prompt…${C.reset}`
  }

  const groups = [idParts.join(SEP)]
  if (usageParts.length) groups.push(usageParts.join(SEP))
  groups.push(promptSeg)

  process.stdout.write(groups.join(GROUP))
}

main()

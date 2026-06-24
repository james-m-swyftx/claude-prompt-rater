#!/usr/bin/env node
/**
 * Claude Code status line.
 *
 *   model · dir · git │ ctx% ▰meter ⚠ · $cost · +/-lines · dur │ ✎ grade score ↑ · HH:MM AEST · → tip
 *
 * Prompt grade is a fast local heuristic (no LLM call). Usage/cost/lines/duration
 * come from the stdin JSON; context tokens, the last prompt's time, and the
 * recent-prompt trend are read from the session transcript.
 *
 * Per-user config (all optional): ~/.claude/prompt-rater.json
 *   { "contextLimit": 1000000,
 *     "segments": { "cost": false, "trend": true, ... } }   // any segment -> false hides it
 * Override the config path with PROMPT_RATER_CONFIG.
 */

'use strict'

const fs = require('fs')
const cp = require('child_process')

const CONTEXT_TREND_SAMPLES = 5

// ---------- stdin ----------
function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

// ---------- transcript: recent prompts (+times) and current context size ----------
function parseTranscript(path, maxPrompts) {
  const res = { prompts: [], contextTokens: 0 }
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

    // Recent prompts the user actually typed (most-recent first).
    if (res.prompts.length < maxPrompts && obj.type === 'user' && !obj.isMeta) {
      const msg = obj.message
      if (msg && msg.role === 'user') {
        let text = ''
        if (typeof msg.content === 'string') {
          text = msg.content
        } else if (Array.isArray(msg.content)) {
          if (!msg.content.some((b) => b && b.type === 'tool_result')) {
            text = msg.content
              .filter((b) => b && b.type === 'text')
              .map((b) => b.text)
              .join('\n')
          }
        }
        const cleaned = stripNoise(text)
        if (cleaned) res.prompts.push({ text: cleaned, time: obj.timestamp || null })
      }
    }

    if (res.contextTokens && res.prompts.length >= maxPrompts) break
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
  const dims = {}

  // Substance (0-25)
  if (wc <= 2) dims.length = 4
  else if (wc <= 6) dims.length = 12
  else if (wc <= 150) dims.length = 25
  else dims.length = 19

  // Specificity (0-25)
  let spec = 0
  if (/`[^`]+`/.test(prompt)) spec += 9
  if (/[\w-]+\.[a-z]{1,5}\b/.test(prompt)) spec += 7
  if (/[\/\\][\w.-]+/.test(prompt)) spec += 4
  if (/[a-z][a-zA-Z]*[A-Z]|[a-z]+_[a-z]+/.test(prompt)) spec += 4
  if (/["'][^"']{3,}["']/.test(prompt)) spec += 4
  if (/\b\d+\b/.test(prompt)) spec += 2
  dims.specificity = Math.min(25, spec)

  // Clear ask (0-20)
  const verbs =
    /\b(add|fix|create|build|refactor|explain|write|update|remove|delete|implement|review|test|debug|optimi[sz]e|rename|move|generate|convert|compare|summari[sz]e|analy[sz]e|design|document|investigate|rate|check|find|list)\b/
  let ask = 0
  if (verbs.test(t)) ask += 14
  if (prompt.includes('?')) ask += 6
  dims.ask = Math.min(20, ask)

  // Constraints / format (0-15)
  dims.constraints =
    /\b(must|should|don'?t|do not|only|without|instead of|format|return|output|as a|in (?:json|yaml|markdown|typescript|python|bash)|no |avoid|keep it|limit|max(?:imum)?|min(?:imum)?)\b/.test(
      t
    )
      ? 15
      : 0

  // Success criteria / examples (0-15)
  dims.success =
    /\b(for example|e\.g\.|such as|expected|so that|make sure|ensure|verify|test that|should (?:pass|return|equal)|acceptance|definition of done|like this)\b/.test(
      t
    )
      ? 15
      : 0

  let total =
    dims.length + dims.specificity + dims.ask + dims.constraints + dims.success

  if (
    /\b(fix it|make it work|do the thing|the stuff|whatever|something like that|as before|you know|etc\b)/.test(
      t
    )
  ) {
    total -= 12
  }
  if (wc <= 3 && !verbs.test(t)) total -= 6

  return { total: Math.max(0, Math.round(total)), dims }
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

const MAX = { length: 25, specificity: 25, ask: 20, constraints: 15, success: 15 }
const TIP = {
  length: 'add more detail',
  specificity: 'name the file/symbol',
  ask: 'lead with an action verb',
  constraints: 'state constraints/output format',
  success: 'add success criteria'
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

// Trend of the most recent prompt vs the average of the preceding few.
function trendArrow(scores) {
  if (!scores || scores.length < 2) return null
  const cur = scores[0]
  const prev = scores.slice(1)
  const avg = prev.reduce((a, b) => a + b, 0) / prev.length
  if (cur >= avg + 5) return 'up'
  if (cur <= avg - 5) return 'down'
  return 'flat'
}

// 200k unless the model signals 1M — or unless we already observe >200k tokens
// (a 200k model physically can't, so the window must be larger).
function resolveContextLimit(cfgLimit, idName, contextTokens) {
  let limit = cfgLimit || (/1m|\[1m\]/i.test(idName) ? 1000000 : 200000)
  if (contextTokens > limit) limit = 1000000
  return limit
}

// ---------- config ----------
function loadConfig() {
  const home = process.env.HOME || ''
  const path =
    process.env.PROMPT_RATER_CONFIG || (home ? `${home}/.claude/prompt-rater.json` : '')
  let cfg = {}
  if (path && fs.existsSync(path)) {
    try {
      cfg = JSON.parse(fs.readFileSync(path, 'utf8'))
    } catch {}
  }
  const s = cfg.segments || {}
  const on = (k) => s[k] !== false // default on
  return {
    contextLimit: cfg.contextLimit || null,
    seg: {
      model: on('model'),
      dir: on('dir'),
      git: on('git'),
      context: on('context'),
      cost: on('cost'),
      lines: on('lines'),
      duration: on('duration'),
      grade: on('grade'),
      trend: on('trend'),
      time: on('time'),
      tip: on('tip')
    }
  }
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
function ctxColor(pct) {
  if (pct < 50) return C.green
  if (pct < 80) return C.yellow
  return C.red
}
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

const plainLen = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').length

// ---------- main ----------
function main() {
  let data = {}
  try {
    data = JSON.parse(readStdin() || '{}')
  } catch {
    data = {}
  }

  const cfg = loadConfig()
  const model = (data.model && data.model.display_name) || 'Claude'
  const modelId = (data.model && data.model.id) || ''
  const dir = (data.workspace && data.workspace.current_dir) || data.cwd || ''
  const base = dir ? dir.split('/').pop() : ''
  const cost = data.cost || {}
  const { prompts, contextTokens } = parseTranscript(
    data.transcript_path,
    CONTEXT_TREND_SAMPLES
  )

  // Precompute each field as a coloured string (empty if not applicable).
  const modelStr = model ? `${C.dim}${model}${C.reset}` : ''
  const dirStr = base ? `${C.dim}${base}${C.reset}` : ''
  const git = gitInfo(dir)
  const gitStr = git ? `${C.magenta}${git.branch}${git.dirty ? '*' : ''}${C.reset}` : ''

  let ctxStr = ''
  if (contextTokens > 0) {
    const limit = resolveContextLimit(cfg.contextLimit, `${modelId} ${model}`, contextTokens)
    const pct = Math.min(100, Math.round((contextTokens / limit) * 100))
    const col = ctxColor(pct)
    ctxStr = `${col}${fmtTokens(contextTokens)} ${pct}%${C.reset} ${meter(pct, col)}`
    if (pct >= 90) ctxStr += ` ${C.red}⚠${C.reset}`
  }
  const costStr =
    typeof cost.total_cost_usd === 'number'
      ? `${C.cyan}$${cost.total_cost_usd.toFixed(2)}${C.reset}`
      : ''
  const added = cost.total_lines_added || 0
  const removed = cost.total_lines_removed || 0
  const linesStr =
    added || removed ? `${C.green}+${added}${C.reset} ${C.red}-${removed}${C.reset}` : ''
  const durStr =
    typeof cost.total_duration_ms === 'number' && cost.total_duration_ms > 0
      ? `${C.dim}${fmtDuration(cost.total_duration_ms)}${C.reset}`
      : ''

  // Prompt fields
  let gradeStr = ''
  let arrowStr = ''
  let timeStr = ''
  let tipStr = ''
  const havePrompt = prompts.length > 0
  if (havePrompt) {
    const scored = prompts.map((p) => score(p.text))
    const cur = scored[0]
    const gcol = gradeColor(cur.total)
    gradeStr = `${C.dim}✎${C.reset} ${gcol}${C.bold}${grade(cur.total)}${C.reset} ${C.dim}${cur.total}${C.reset}`
    const arrow = trendArrow(scored.map((x) => x.total))
    if (arrow === 'up') arrowStr = `${C.green}↑${C.reset}`
    else if (arrow === 'down') arrowStr = `${C.red}↓${C.reset}`
    else if (arrow === 'flat') arrowStr = `${C.dim}→${C.reset}`
    const t = fmtAEST(prompts[0].time)
    if (t) timeStr = `${C.dim}${t} AEST${C.reset}`
    const weak = weakest(cur.dims)
    if (weak) tipStr = `${C.yellow}→ ${TIP[weak]}${C.reset}`
  }

  function render(seg) {
    const id = []
    if (seg.model && modelStr) id.push(modelStr)
    if (seg.dir && dirStr) id.push(dirStr)
    if (seg.git && gitStr) id.push(gitStr)

    const usage = []
    if (seg.context && ctxStr) usage.push(ctxStr)
    if (seg.cost && costStr) usage.push(costStr)
    if (seg.lines && linesStr) usage.push(linesStr)
    if (seg.duration && durStr) usage.push(durStr)

    const pr = []
    if (havePrompt) {
      if (seg.grade && gradeStr) {
        pr.push(seg.trend && arrowStr ? `${gradeStr} ${arrowStr}` : gradeStr)
      }
      if (seg.time && timeStr) pr.push(timeStr)
      if (seg.tip && tipStr) pr.push(tipStr)
    } else {
      pr.push(`${C.dim}✎ awaiting prompt…${C.reset}`)
    }

    const groups = []
    if (id.length) groups.push(id.join(SEP))
    if (usage.length) groups.push(usage.join(SEP))
    if (pr.length) groups.push(pr.join(SEP))
    return groups.join(GROUP)
  }

  // Width-aware: drop lowest-priority segments until it fits (best effort —
  // only when a column count is known).
  const seg = Object.assign({}, cfg.seg)
  let out = render(seg)
  const cols = parseInt(process.env.COLUMNS, 10) || process.stdout.columns || 0
  if (cols > 0) {
    const dropOrder = ['tip', 'trend', 'duration', 'lines', 'cost', 'time', 'git', 'context', 'dir']
    for (let i = 0; i < dropOrder.length && plainLen(out) > cols; i++) {
      seg[dropOrder[i]] = false
      out = render(seg)
    }
  }

  process.stdout.write(out)
}

if (require.main === module) main()

module.exports = {
  score,
  grade,
  weakest,
  trendArrow,
  resolveContextLimit,
  fmtTokens,
  fmtDuration,
  fmtAEST,
  stripNoise
}

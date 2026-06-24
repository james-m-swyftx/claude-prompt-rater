'use strict'

const test = require('node:test')
const assert = require('node:assert')
const sl = require('../statusline-prompt-rater.js')

test('grade boundaries', () => {
  assert.equal(sl.grade(92), 'A')
  assert.equal(sl.grade(85), 'A-')
  assert.equal(sl.grade(78), 'B+')
  assert.equal(sl.grade(45), 'C')
  assert.equal(sl.grade(44), 'D')
  assert.equal(sl.grade(0), 'F')
})

test('score: vague prompt scores low', () => {
  assert.ok(sl.score('fix it').total < 20)
})

test('score: detailed prompt scores high', () => {
  const p =
    'refactor parseConfig in src/config.ts to return a Result type; make sure config.test.ts still passes'
  assert.ok(sl.score(p).total >= 78)
})

test('weakest dimension is the lowest-fraction one (or null when all strong)', () => {
  const low = sl.score('fix it')
  assert.ok(sl.weakest(low.dims) !== null)
})

test('fmtTokens', () => {
  assert.equal(sl.fmtTokens(243000), '243k')
  assert.equal(sl.fmtTokens(4700), '4.7k')
  assert.equal(sl.fmtTokens(500), '500')
})

test('fmtDuration', () => {
  assert.equal(sl.fmtDuration(45000), '45s')
  assert.equal(sl.fmtDuration(1920000), '32m')
  assert.equal(sl.fmtDuration(3720000), '1h2m')
})

test('fmtAEST converts UTC to AEST (UTC+10)', () => {
  assert.equal(sl.fmtAEST('2026-06-24T04:32:15.000Z'), '14:32')
  // crosses the date line back a day
  assert.equal(sl.fmtAEST('2026-06-23T23:05:00.000Z'), '09:05')
  assert.equal(sl.fmtAEST(null), null)
})

test('resolveContextLimit: 1M via model marker', () => {
  assert.equal(sl.resolveContextLimit(null, 'claude-opus-4-8[1m]', 1000), 1000000)
})

test('resolveContextLimit: bumps to 1M when observed tokens exceed 200k', () => {
  assert.equal(sl.resolveContextLimit(null, 'claude-sonnet-4-6', 243000), 1000000)
})

test('resolveContextLimit: defaults to 200k', () => {
  assert.equal(sl.resolveContextLimit(null, 'claude-sonnet-4-6', 50000), 200000)
})

test('resolveContextLimit: explicit config wins', () => {
  assert.equal(sl.resolveContextLimit(500000, 'claude-sonnet-4-6', 1000), 500000)
})

test('trendArrow', () => {
  assert.equal(sl.trendArrow([90, 70, 72]), 'up')
  assert.equal(sl.trendArrow([40, 80, 82]), 'down')
  assert.equal(sl.trendArrow([80, 80]), 'flat')
  assert.equal(sl.trendArrow([80]), null)
  assert.equal(sl.trendArrow([]), null)
})

test('stripNoise removes system reminders and tags', () => {
  assert.equal(sl.stripNoise('hello <system-reminder>noise</system-reminder> world'), 'hello world')
})

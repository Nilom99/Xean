#!/usr/bin/env node
/**
 * Codex Local — environment doctor.
 *
 * Checks everything that can silently break the app before a run starts:
 * the Node version, the config file, the API key, the free-model catalog,
 * the native SQLite module and the workspace directory.
 *
 * Secrets are never printed — only whether they are present.
 *
 * Usage: npm run doctor
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const GREEN = '[32m'
const RED = '[31m'
const YELLOW = '[33m'
const DIM = '[2m'
const RESET = '[0m'

let failures = 0
let warnings = 0

function ok(label, detail = '') {
  console.log(`  ${GREEN}✓${RESET} ${label}${detail ? ` ${DIM}${detail}${RESET}` : ''}`)
}

function warn(label, detail = '') {
  warnings++
  console.log(`  ${YELLOW}!${RESET} ${label}${detail ? ` ${DIM}${detail}${RESET}` : ''}`)
}

function fail(label, detail = '') {
  failures++
  console.log(`  ${RED}✗${RESET} ${label}${detail ? ` ${DIM}${detail}${RESET}` : ''}`)
}

function section(title) {
  console.log(`\n${title}`)
}

/** Parse the API key out of a .env file without printing it. */
function hasEnvKey(text) {
  const match = text.match(/^\s*OPENROUTER_API_KEY\s*=\s*(.+)$/m)
  if (!match || !match[1]) return false
  const value = match[1].trim().replace(/^['"]|['"]$/g, '')
  return value.length > 0 && !value.includes('REPLACE_ME')
}

console.log('Codex Local doctor')
console.log(`${DIM}${ROOT}${RESET}`)

// ---- Node version ---------------------------------------------------------
section('Runtime')
const [major] = process.versions.node.split('.').map(Number)
if (major >= 20) {
  ok('Node.js', `v${process.versions.node}`)
} else {
  fail('Node.js', `v${process.versions.node} — 20 or newer is required`)
}

// ELECTRON_RUN_AS_NODE makes Electron behave like plain Node, which stops
// the window from ever opening and produces a confusing "electron does not
// provide an export named 'app'" error.
if (process.env.ELECTRON_RUN_AS_NODE) {
  fail(
    'ELECTRON_RUN_AS_NODE',
    'is set — Electron will not start a window. Unset it before launching.'
  )
} else {
  ok('ELECTRON_RUN_AS_NODE', 'not set')
}

// ---- Dependencies ---------------------------------------------------------
section('Dependencies')
// Import each dependency rather than just resolving it: a package can be
// present but broken (missing files), which is exactly what breaks a run.
for (const dep of ['electron', 'react', 'zod', 'diff', 'execa', 'better-sqlite3']) {
  try {
    await import(dep)
    ok(dep)
  } catch (err) {
    fail(dep, `cannot be loaded: ${err.message.split('\n')[0]} — run npm install`)
  }
}

// ---- Config ---------------------------------------------------------------
section('Configuration')
const configPath = path.join(ROOT, 'codex-local.config.json')
if (!fs.existsSync(configPath)) {
  warn('Config file', 'missing — the app will use its defaults')
} else {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    const roles = config.roles ?? {}
    const missing = ['orchestrator', 'implementer', 'reviewer', 'runner'].filter(
      (role) => !roles[role]
    )
    if (missing.length > 0) {
      warn('Config file', `missing role(s): ${missing.join(', ')} — defaults will be used`)
    } else {
      ok('Config file', 'codex-local.config.json')
    }
    if (config.freeOnly === false) {
      fail('Free-only lock', 'config.freeOnly is false — the app forces it back on')
    } else {
      ok('Free-only lock')
    }
  } catch (err) {
    fail('Config file', `invalid JSON: ${err.message}`)
  }
}

// ---- API key --------------------------------------------------------------
section('API key')
const envPath = path.join(ROOT, '.env')
let keyFound = false
if (fs.existsSync(envPath)) {
  keyFound = hasEnvKey(fs.readFileSync(envPath, 'utf8'))
}
if (keyFound) {
  ok('OPENROUTER_API_KEY', 'found in .env')
} else {
  warn(
    'OPENROUTER_API_KEY',
    'not found in .env — add it, or set the key in the app’s Settings panel'
  )
}
console.log(`  ${DIM}The key itself is never printed.${RESET}`)

// ---- Free model catalog ---------------------------------------------------
section('Free model catalog')
try {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    signal: controller.signal,
    headers: { Accept: 'application/json' }
  })
  clearTimeout(timer)

  if (!res.ok) {
    fail('Catalog', `OpenRouter responded with ${res.status}`)
  } else {
    const body = await res.json()
    const free = (body.data ?? []).filter((model) => {
      if (typeof model.id === 'string' && model.id.endsWith(':free')) return true
      const pricing = model.pricing
      if (!pricing) return false
      return String(pricing.prompt) === '0' && String(pricing.completion) === '0'
    })
    if (free.length === 0) {
      fail('Catalog', 'no free models are currently listed')
    } else {
      ok('Catalog', `${free.length} free model(s) available`)
    }
  }
} catch (err) {
  fail('Catalog', err.name === 'AbortError' ? 'timed out' : err.message)
}

// ---- Native SQLite module -------------------------------------------------
section('Persistence')
try {
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  db.close()
  ok('better-sqlite3', 'native module loaded')
} catch (err) {
  warn(
    'better-sqlite3',
    `native module unavailable (${err.message.split('\n')[0]}) — the app falls back to a JSON log`
  )
}

// ---- Workspace ------------------------------------------------------------
section('Workspace')
const workspaceRoot = path.join(ROOT, 'workspace')
try {
  fs.mkdirSync(workspaceRoot, { recursive: true })
  const probe = path.join(workspaceRoot, '.doctor-write-test')
  fs.writeFileSync(probe, 'ok', 'utf8')
  fs.unlinkSync(probe)
  ok('Workspace', 'writable')
} catch (err) {
  fail('Workspace', `not writable: ${err.message}`)
}

// ---- Summary --------------------------------------------------------------
console.log('')
if (failures > 0) {
  console.log(
    `${RED}${failures} problem(s) found${RESET}${warnings ? `, ${warnings} warning(s)` : ''}.`
  )
  process.exitCode = 1
} else if (warnings > 0) {
  console.log(`${YELLOW}Everything essential works${RESET}, with ${warnings} warning(s).`)
} else {
  console.log(`${GREEN}Everything checks out.${RESET}`)
}

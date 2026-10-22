#!/usr/bin/env node
/**
 * Tiny surgical patcher used during development.
 *
 * Reads a JSON file of { "path": [[oldText, newText], ...] } and applies the
 * replacements, normalising CRLF so the patches match regardless of how the
 * file was written.
 */
const fs = require('fs')
const path = require('path')

const specPath = process.argv[2]
if (!specPath) {
  console.error('usage: node scripts/patch.cjs <spec.json>')
  process.exit(1)
}

const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'))

for (const [relPath, edits] of Object.entries(spec)) {
  const file = path.resolve(relPath)
  if (!fs.existsSync(file)) {
    console.error('MISSING FILE', relPath)
    continue
  }
  let text = fs.readFileSync(file, 'utf8')
  const hadCrlf = text.includes('\r\n')
  let norm = text.replace(/\r\n/g, '\n')

  let applied = 0
  for (const [oldText, newText] of edits) {
    const o = oldText.replace(/\r\n/g, '\n')
    const n = newText.replace(/\r\n/g, '\n')
    if (!norm.includes(o)) {
      console.error('NO MATCH in', relPath, '->', JSON.stringify(o.slice(0, 70)))
      continue
    }
    norm = norm.replace(o, n)
    applied++
  }

  if (hadCrlf) norm = norm.replace(/\n/g, '\r\n')
  fs.writeFileSync(file, norm, 'utf8')
  console.log('PATCHED', relPath, `${applied}/${edits.length}`)
}

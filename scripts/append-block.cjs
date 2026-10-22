#!/usr/bin/env node
/**
 * Append a method block to a class body, just before the final closing brace.
 *
 * Usage: node scripts/append-block.cjs <file> <blockFile>
 */
const fs = require('fs')
const path = require('path')

const [file, blockFile] = process.argv.slice(2)
if (!file || !blockFile) {
  console.error('usage: node scripts/append-block.cjs <file> <blockFile>')
  process.exit(1)
}

const target = path.resolve(file)
const block = fs.readFileSync(path.resolve(blockFile), 'utf8').replace(/\r\n/g, '\n')

let text = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n')
const lines = text.split('\n')

// Find the last line that is exactly the class-closing brace.
let closeIndex = -1
for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i] === '}') {
    closeIndex = i
    break
  }
}
if (closeIndex < 0) {
  console.error('no closing brace found in', file)
  process.exit(1)
}

const before = lines.slice(0, closeIndex)
const after = lines.slice(closeIndex)
const next = [...before, ...block.replace(/\n$/, '').split('\n'), ...after]
fs.writeFileSync(target, next.join('\n'), 'utf8')
console.log('APPENDED to', path.basename(file), '-> total lines', next.length)

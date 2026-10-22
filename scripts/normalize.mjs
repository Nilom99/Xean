import fs from 'node:fs'
import path from 'node:path'

const roots = ['src', 'scripts']
const exts = new Set(['.ts', '.tsx', '.mts', '.js', '.mjs', '.css', '.json'])

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'out') continue
      walk(full)
    } else if (exts.has(path.extname(entry.name))) {
      const text = fs.readFileSync(full, 'utf8')
      const normalized = text.replace(/\r\n/g, '\n')
      if (normalized !== text) {
        fs.writeFileSync(full, normalized, 'utf8')
        console.log('normalized', full)
      }
    }
  }
}

for (const root of roots) {
  if (fs.existsSync(root)) walk(root)
}
console.log('done')

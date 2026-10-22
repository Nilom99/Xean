const fs = require('fs')
const path = require('path')

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'out', 'dist', '.git'].includes(entry.name)) continue
      out.push(...walk(full))
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx|cjs|mjs|json|css|html|md)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

let changed = 0
for (const file of walk(process.argv[2] || 'src')) {
  const raw = fs.readFileSync(file, 'utf8')
  if (!raw.includes('\r\n')) continue
  const next = raw.replace(/\r\n/g, '\n')
  fs.writeFileSync(file, next, 'utf8')
  changed++
  console.log('normalized', file)
}
console.log(`done, ${changed} file(s) normalized`)

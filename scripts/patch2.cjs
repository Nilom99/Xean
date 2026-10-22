const fs = require('fs')
const p = 'src/shared/types.ts'
let t = fs.readFileSync(p, 'utf8')
t = t.replace("runId?: string; runId: string; scope", "runId?: string; scope")
fs.writeFileSync(p, t, 'utf8')
console.log(t.split('\n').filter(l=>l.includes("type: 'ERROR'")).join('\n'))

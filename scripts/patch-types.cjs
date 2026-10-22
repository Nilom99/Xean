const fs = require('fs')
const p = 'src/shared/types.ts'
let t = fs.readFileSync(p, 'utf8')
const adds = {
  "TASK_CREATED": "runId: string; ",
  "TASK_ASSIGNED": "runId: string; ",
  "MESSAGE": "runId: string; ",
  "HANDOFF": "runId: string; ",
  "REVIEW_REQUEST": "runId: string; ",
  "REVIEW_RESULT": "runId: string; ",
  "FILE_PATCH": "runId: string; ",
  "COMMAND_REQUEST": "runId: string; ",
  "COMMAND_RESULT": "runId: string; ",
  "ERROR": "runId?: string; "
}
for (const [type, extra] of Object.entries(adds)) {
  const needle = `{ type: '${type}'; ts: number; `
  if (!t.includes(needle)) { console.log('MISS', type); continue }
  if (t.includes(`{ type: '${type}'; ts: number; ${extra}`)) { console.log('OK', type); continue }
  t = t.replace(needle, `{ type: '${type}'; ts: number; ${extra}`)
}
fs.writeFileSync(p, t, 'utf8')
console.log('done')

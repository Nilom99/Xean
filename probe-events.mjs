import D from 'better-sqlite3'
const db = new D(process.argv[2], { readonly: true })
const mode = process.argv[3] ?? 'summary'
const runId = process.argv[4]
if (mode === 'summary') {
  const rows = db.prepare('SELECT run_id, type, COUNT(*) c FROM events GROUP BY run_id, type ORDER BY run_id, type').all()
  for (const r of rows) console.log(r.run_id, r.type, r.c)
} else if (mode === 'deltas') {
  const rows = db.prepare("SELECT payload FROM events WHERE run_id=? AND type='AGENT_DELTA' ORDER BY id").all(runId)
  const groups = new Map()
  for (const r of rows) {
    const e = JSON.parse(r.payload)
    const key = `${e.taskId ?? '-'}|${e.role}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(e.text)
  }
  for (const [k, v] of groups) console.log(`\n===== ${k} =====\n${v.join('')}`)
} else {
  const rows = db.prepare('SELECT payload FROM events WHERE run_id=? AND type=? ORDER BY id').all(runId, mode)
  for (const r of rows) console.log(r.payload)
}


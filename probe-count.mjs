import D from 'better-sqlite3'
const db = new D(process.argv[2], { readonly: true })
const n = db.prepare("SELECT COUNT(*) c FROM events WHERE type='APPROVAL_REQUIRED'").get().c
console.log(n)

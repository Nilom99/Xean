import { resolveAlias } from '../src/main/openrouter/aliasMap.ts'
const res = await fetch('https://openrouter.ai/api/v1/models')
const data = await res.json()
const free = data.data.filter(m => m.id.endsWith(':free') || (m.pricing && String(m.pricing.prompt) === '0' && String(m.pricing.completion) === '0')).map(m => ({ id: m.id, name: m.name, contextLength: m.context_length || 0 }))
const cases = [
  { alias: 'minimax 3.1 flash', role: 'orchestrator', preferred: [] },
  { alias: 'lfm2.5', role: 'implementer', preferred: [] },
  { alias: 'dots3preview', role: 'reviewer', preferred: [] },
  { alias: 'north mini code', role: 'runner', preferred: [] }
]
for (const c of cases) {
  const r = resolveAlias({ ...c, models: free })
  console.log(c.alias.padEnd(20), '->', r.status.padEnd(10), (r.resolvedId || '-').padEnd(45), 'conf=' + r.confidence.toFixed(3), r.message || '')
}

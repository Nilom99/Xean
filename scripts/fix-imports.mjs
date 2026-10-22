import fs from 'node:fs'

const edits = [
  {
    file: 'src/main/engine/roles.ts',
    from: '.map((entry, index) => {',
    to: '.map((entry, index): ReviewItem | null => {'
  },
  {
    file: 'src/main/engine/taskCycle.ts',
    from: "import type { Sandbox, SandboxError } from './sandbox'",
    to: "import { SandboxError, type Sandbox } from './sandbox'"
  },
  {
    file: 'src/main/engine/orchestrator.ts',
    from: "import type { AppConfig, Role, Task } from '@shared/types'",
    to: "import type { AppConfig, Role } from '@shared/types'"
  }
]

for (const edit of edits) {
  let text = fs.readFileSync(edit.file, 'utf8')
  if (!text.includes(edit.from)) {
    console.log(`SKIP ${edit.file} (pattern not found)`)
    continue
  }
  text = text.replace(edit.from, edit.to)
  fs.writeFileSync(edit.file, text, 'utf8')
  console.log(`OK ${edit.file}`)
}

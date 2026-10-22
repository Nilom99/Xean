# Codex Local

An offline-first, multi-agent AI coding workspace that runs entirely on
**free-tier OpenRouter models**. A team of four agents works inside a sandboxed
folder on your machine:

| Role | What it does |
| --- | --- |
| **Orchestrator** | Breaks your goal into tasks and decides when the work is done |
| **Implementer** | Writes and edits files inside the workspace sandbox |
| **Reviewer** | Critiques the changes and asks for revisions |
| **Runner** | Executes the project's test / lint / build commands |

Every model that is ever called is verified against OpenRouter's live free-model
catalog immediately before the request leaves the process — a paid model cannot
be called, even by accident.

## Requirements

- **Node.js 20.11 or newer** (Node 22+ recommended)
- An OpenRouter API key — the free tier is enough
  (get one at <https://openrouter.ai/keys>)

## Getting started

```bash
npm install          # install dependencies
npm run doctor       # check that everything is in order
npm run dev          # start in development mode
npm start            # build and run the production bundle
```

On Windows, macOS and Linux there are one-click launchers: `start.bat`,
`start.command` and `start.sh`.

### Configuring the API key

Either create a `.env` file next to `package.json`:

```
OPENROUTER_API_KEY=sk-or-v1-...
```

or paste the key into the app's **Settings** panel. When the operating system
offers an encrypted keychain, the key is stored there; otherwise it falls back
to a plain `.env` file. `.env` is gitignored and the key is never printed.

### Choosing models

Each role is bound to a model. The defaults use informal aliases
(`"minimax 3.1 flash"`, `"lfm2.5"`, …) that are resolved against the live free
catalog — fuzzy-matched, and never silently substituted with a paid model. The
**Settings** panel shows what each alias resolved to and lets you override it
with any free model.

## Using the app

1. Describe what you want to build in the goal bar and press **Start run**.
2. Watch the **Transcript** for the agents' conversation, the **Tasks** tab for
   the plan, and **Changes** for the diffs they write.
3. Approve file writes and commands when asked — the run pauses until you do.
4. When the run finishes, a `RUN_REPORT.md` is written into the workspace and
   is listed under **Runs**.

| Shortcut | Action |
| --- | --- |
| `Ctrl` + `Enter` | Start a run from the goal bar |
| `Ctrl` + `K` | Open the command palette |
| `Ctrl` + `Shift` + `O` | Choose the workspace folder |
| `Ctrl` + `E` | Export the run report |

## Safety

- All writes and shell commands go through a sandbox that resolves symlinks
  and refuses to touch anything outside the workspace.
- Agent-run commands receive a minimal environment allowlist, so unrelated
  credentials are not inherited by child processes.
- Writes and commands require explicit approval unless you enable
  **Auto-approve file writes**.
- Cancelling a run aborts in-flight provider requests and child processes.
  Requests, commands and whole runs have configurable timeouts
  (`requestTimeoutMs`, `commandTimeoutMs`, `runTimeoutMs`).

## Reliability and verification

- The planner's dependency graph is validated before execution: duplicate ids,
  unknown dependencies and cycles fail the run with a clear message.
- A failed check creates at most three repair tasks per round, inside the run
  loop. Repairs are re-verified and stop after `maxRepairAttempts` (default 2).
- A run is `done` only when every task finished **and** at least one check ran
  and passed. Work with no executable check is reported as `unverified`;
  failed/blocked work or a failed check is `failed`.
- Every run, including aborted and failed runs, still writes `RUN_REPORT.md`.

## Current provider support

Codex Local currently talks to **OpenRouter free-tier models only**. The
multi-provider and local-inference roadmap (OpenAI, Gemini, Anthropic, Groq,
DeepSeek, Mistral, Together, Azure OpenAI, Hugging Face, Cohere, LM Studio,
Ollama, vLLM and custom OpenAI-compatible endpoints) is documented, with the
completed Phase 1 audit, in [`docs/PHASE1_AUDIT.md`](docs/PHASE1_AUDIT.md).
Those adapters are not implemented yet and the UI does not pretend otherwise.

## Development

```bash
npm run typecheck    # type-check the main, preload and renderer projects
npm test             # unit tests for the pure logic
npm run test:integration  # stubbed end-to-end orchestration checks (no API key)
npm run doctor       # environment diagnostics
npm run rebuild:native   # rebuild better-sqlite3 for Electron's ABI
```

The renderer is a pure function of the engine's event log: `src/renderer/lib/events.ts`
folds the ordered stream of events into the state the UI renders. The engine
lives in `src/main/engine`, the OpenRouter client in `src/main/openrouter`, and
the shared contract in `src/shared`.

## Layout

```
src/main        Electron main process: engine, OpenRouter client, persistence
src/preload     The contextBridge between the main and renderer processes
src/renderer    React UI
src/shared      Types and IPC channel names shared by both processes
scripts         Doctor, tests and small maintenance helpers
```

## License

MIT

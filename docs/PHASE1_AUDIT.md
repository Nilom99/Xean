# Codex Local — Phase 1 audit and reliability work

This document records the repository audit, the confirmed defects that were
fixed, and the honest status of the larger upgrade roadmap. It is deliberately
scoped: it does **not** claim that providers, local inference or IDE templates
exist yet.

## 1. Actual architecture

- **Electron main process** (`src/main`) owns all privileged work: config,
  secrets, provider HTTP calls, orchestration, sandboxed commands and SQLite.
- **Renderer** (`src/renderer`) is a pure view over the ordered engine event
  stream (`src/renderer/lib/events.ts`). It never receives credentials.
- **Preload** (`src/preload`) exposes a narrow, typed `IpcApi` contract
  (`src/shared/ipc.ts`); the renderer has no direct `ipcRenderer` access.
- **Engine** (`src/main/engine`): `Orchestrator` owns the run lifecycle,
  `TaskBoard` is the task state machine, `TaskCycle` runs
  implement → review → fix, `Sandbox` enforces workspace/command boundaries,
  `ApprovalGate`/`DecisionGate` pause for the user, `report.ts` writes
  `RUN_REPORT.md`.
- **Provider layer today**: a single OpenRouter client
  (`src/main/openrouter/client.ts`) with SSE streaming, free-model guard,
  typed errors, retry/backoff and a per-role fallback chain. There are **no**
  OpenAI/Gemini/Anthropic/Ollama/LM Studio adapters yet.
- **Persistence**: `src/main/engine/store.ts` prefers `better-sqlite3` and
  falls back to an append-only JSON log.

## 2. Confirmed bugs (verified against the code)

| # | Defect | Location | Impact |
|---|--------|----------|--------|
| 1 | Tasks moved `PENDING → IN_PROGRESS`; the state machine rejected it and the error was swallowed | `taskCycle.ts`, `taskboard.ts` | Every task stayed `PENDING` in the UI and report even after its files were written |
| 2 | Failed verification created repair tasks **after** the execution loop had ended | `orchestrator.ts` (`runVerification`) | Repair tasks were never executed; the run could still claim success |
| 3 | When no task was ready, the scheduler ran arbitrary pending tasks | `orchestrator.ts` (`executeTasks`) | Dependency cycles/failed prerequisites produced out-of-order execution |
| 4 | Run status was hard-coded to `done` unless an exception escaped | `orchestrator.ts` (`execute`) | Failed/blocked tasks and failed checks could be reported as a successful run |
| 5 | Dependency graphs were not validated (cycles, duplicates, missing ids) | `orchestrator.ts` | Malformed plans executed or hung |
| 6 | Cancellation only set a flag; in-flight HTTP/child processes continued | `orchestrator.ts`, `client.ts`, `sandbox.ts` | "Stop" did not stop work; tokens/commands kept running |
| 7 | The child environment copied every variable except a few known names | `sandbox.ts` | Unrelated CI/cloud credentials were inherited by model-generated commands |
| 8 | Persistence errors were swallowed | `bus.ts`, `store.ts` | A full/broken disk silently lost run history |

## 3. What this phase changed

- **Task lifecycle**: `PENDING → ASSIGNED → IN_PROGRESS`; a user override may
  finish a `CHANGES_REQUESTED` task.
- **Bounded repair loop**: failed checks become at most three implementer tasks
  per round, deduplicated by command/exit/output, executed inside the run loop
  and followed by a full re-verification of all tasks. The loop stops at
  `maxRepairAttempts` (default 2, range 0–5).
- **Dependency validation**: `validateTaskGraph` rejects empty/duplicate ids,
  self/unknown dependencies and cycles (with the cycle path) before any task is
  created.
- **No forced execution**: when no task is runnable, dependents of failed
  prerequisites are marked `BLOCKED`; an unsatisfiable graph fails the run.
- **Honest completion gate**: `computeRunStatus` only returns `done` when every
  task is `DONE` and at least one check ran and passed. Work with no executable
  check is reported as `unverified`; failed/blocked work and failed checks are
  `failed`; cancellation is `aborted`. Zero planned tasks is a failure.
- **Cancellation and timeouts**: a run-level `AbortController` cancels in-flight
  provider requests and child processes; requests have `requestTimeoutMs`,
  commands `commandTimeoutMs`, and runs `runTimeoutMs`. Timeouts and
  cancellations are distinct typed provider errors and are not retried as
  permanent failures.
- **Child-process isolation**: a minimal environment allowlist replaces the
  copy-everything approach.
- **Persistence visibility**: failed event writes are logged and failed run
  saves emit an `ERROR` event.
- **UI**: `unverified` is displayed distinctly in the status bar and run list.

## 4. Configuration additions (backward compatible)

All fields are optional with defaults, so existing config files keep working:

```json
{
  "maxRepairAttempts": 2,
  "requestTimeoutMs": 120000,
  "commandTimeoutMs": 120000,
  "runTimeoutMs": 3600000
}
```

## 5. Tests actually executed

- `npm test` — 57 tests pass (including dependency validation, completion
  gate, repair/report regressions, timeout/cancellation mapping).
- `npm run typecheck` — main and renderer projects pass.
- `npm run build` — main, preload and renderer bundles build.
- A stubbed end-to-end harness against the real `Orchestrator` verified:
  repair task executes and completes; repair attempts stop at the limit; work
  without checks reports `unverified`; a dependency cycle fails before
  execution; `RUN_REPORT.md` is always written.

## 6. Remaining roadmap (not implemented in this phase)

- **Phase 2/3**: provider abstraction, provider registry, cloud and local
  adapters (OpenAI, Gemini, Anthropic, Groq, DeepSeek, Mistral, Together,
  Azure OpenAI, Hugging Face, Cohere, LM Studio, Ollama, vLLM, custom
  OpenAI-compatible endpoints), multi-key credential dashboard and rotation.
- **Phase 4**: `.codexignore`, model-aware token budgeting, relevance ranking,
  AST summaries, hardware profiles, quantization guidance and benchmarks.
- **Phase 5**: automated verification discovery, pre-commit hooks, patch
  validation/rollback, conflict-safe parallel execution, Continue/Cline
  templates.
- **Phase 6**: provider dashboard, cost reporting, IDE validation and the
  remaining documentation.

Until those phases land, Codex Local remains an **OpenRouter, free-tier-only**
client. The UI and README must not imply otherwise.


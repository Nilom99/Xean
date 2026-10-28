import { useEffect, useState } from 'react'
import { Check, KeyRound, RefreshCw, Trash2, X } from 'lucide-react'
import type { FreeModelInfo, ModelResolution, Role, SettingsState } from '@shared/types'
import { ROLE_LABELS, ROLES } from '@shared/types'
import { api } from '../lib/api'
import { formatTime } from '../lib/format'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Input, Select } from './ui/Input'
import { Spinner } from './ui/Spinner'

export interface SettingsPanelProps {
  settings: SettingsState | null
  onClose: () => void
  onSetApiKey: (key: string) => Promise<void>
  onClearApiKey: () => Promise<void>
  onUpdateConfig: (patch: Partial<SettingsState['config']>) => Promise<void>
  onSetRoleModel: (role: Role, modelId: string) => Promise<void>
  /** Called after the catalog is refreshed so the parent can re-read settings. */
  onCatalogRefreshed: () => void
}

/** The settings drawer. */
export function SettingsPanel({
  settings,
  onClose,
  onSetApiKey,
  onClearApiKey,
  onUpdateConfig,
  onSetRoleModel,
  onCatalogRefreshed
}: SettingsPanelProps) {
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<FreeModelInfo[]>([])
  const [resolutions, setResolutions] = useState<ModelResolution[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  // Load the free-model catalog and the alias resolutions on open.
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const [free, resolved] = await Promise.all([
          api().listFreeModels(),
          api().resolveAliases()
        ])
        if (cancelled) return
        setModels(free)
        setResolutions(resolved)
      } catch (err) {
        if (!cancelled) {
          setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) })
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      await fn()
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const config = settings?.config

  return (
    <aside aria-label="Settings" className="flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[13px] font-semibold text-ink">Settings</span>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close settings">
          <X size={14} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-auto p-3">
        {/* ---- API key ---- */}
        <section>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
            <KeyRound size={12} />
            OpenRouter API key
          </h3>

          {settings?.hasApiKey ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2">
                <Badge tone="success">
                  <Check size={10} />
                  Configured
                </Badge>
                <span className="text-[11px] text-ink-faint">source: {settings.keySource}</span>
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await onClearApiKey()
                      setMessage({ ok: true, text: 'API key removed.' })
                    })
                  }
                >
                  <Trash2 size={12} />
                  Remove
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await api().testConnection()
                      setMessage({ ok: result.ok, text: result.message })
                    })
                  }
                >
                  Test connection
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <label htmlFor="input-api-key" className="sr-only">
                OpenRouter API key
              </label>
              <Input
                id="input-api-key"
                type="password"
                value={apiKey}
                placeholder="sk-or-v1-…"
                onChange={(e) => setApiKey(e.target.value)}
              />
              <Button
                size="sm"
                variant="primary"
                disabled={busy || !apiKey.trim()}
                onClick={() =>
                  void run(async () => {
                    await onSetApiKey(apiKey.trim())
                    setApiKey('')
                    setMessage({ ok: true, text: 'API key saved.' })
                  })
                }
              >
                {busy ? <Spinner size={12} /> : null}
                Save key
              </Button>
              <p className="text-[11px] text-ink-faint">
                Get a free key at openrouter.ai/keys. The key is stored in the OS keychain when
                available.
              </p>
            </div>
          )}
        </section>

        {/* ---- Models ---- */}
        <section>
          <h3 className="mb-1.5 flex items-center justify-between text-xs font-semibold text-ink-muted">
            <span>Models</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await api().refreshCatalog()
                  setMessage({ ok: result.ok, text: result.message })
                  setModels(await api().listFreeModels())
                  setResolutions(await api().resolveAliases())
                  onCatalogRefreshed()
                })
              }
            >
              <RefreshCw size={11} />
              Refresh
            </Button>
          </h3>

          <div className="mb-2 text-[11px] text-ink-faint">
            {models.length} free model{models.length === 1 ? '' : 's'} available
            {settings?.catalogFetchedAt ? ` · updated ${formatTime(settings.catalogFetchedAt)}` : ''}
          </div>

          <div className="space-y-2">
            {ROLES.map((role) => {
              const resolution = resolutions.find((r) => r.role === role)
              const selected = config?.roles[role]?.model ?? ''
              const selectId = `role-model-select-${role}`
              return (
                <div key={role} className="rounded-md border border-border bg-surface-2 p-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label htmlFor={selectId} className="text-[12px] font-medium text-ink cursor-pointer">
                      {ROLE_LABELS[role]}
                    </label>
                    {resolution ? (
                      <Badge
                        tone={
                          resolution.status === 'resolved'
                            ? 'success'
                            : resolution.status === 'ambiguous'
                              ? 'warning'
                              : 'danger'
                        }
                        title={resolution.message}
                      >
                        {resolution.status === 'resolved' ? resolution.resolvedId : resolution.status}
                      </Badge>
                    ) : null}
                  </div>

                  <Select
                    id={selectId}
                    value={selected}
                    onChange={(e) =>
                      void onSetRoleModel(role, e.target.value).catch((err: unknown) =>
                        setMessage({
                          ok: false,
                          text: err instanceof Error ? err.message : String(err)
                        })
                      )
                    }
                  >
                    <option value="">{resolution?.resolvedId ?? 'Auto (from alias)'}</option>
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.id}
                      </option>
                    ))}
                  </Select>

                  <div className="mt-1 text-[10px] text-ink-faint">
                    alias: {config?.roles[role]?.alias}
                    {resolution?.message ? ` — ${resolution.message}` : ''}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* ---- Run behaviour ---- */}
        {config ? (
          <section>
            <h3 className="mb-1.5 text-xs font-semibold text-ink-muted">Run behaviour</h3>

            <label htmlFor="setting-iterations" className="mb-1 block text-[11px] text-ink-faint">
              Iterations per task
            </label>
            <Input
              id="setting-iterations"
              type="number"
              min={1}
              max={10}
              value={config.iterationsPerTask}
              onChange={(e) =>
                void onUpdateConfig({
                  iterationsPerTask: Number(e.target.value) || config.iterationsPerTask
                })
              }
            />

            <label htmlFor="setting-parallel" className="mb-1 mt-2 block text-[11px] text-ink-faint">
              Max parallel tasks
            </label>
            <Input
              id="setting-parallel"
              type="number"
              min={1}
              max={8}
              value={config.maxParallelTasks}
              onChange={(e) =>
                void onUpdateConfig({
                  maxParallelTasks: Number(e.target.value) || config.maxParallelTasks
                })
              }
            />

            <label htmlFor="setting-budget" className="mb-1 mt-2 block text-[11px] text-ink-faint">
              Token budget
            </label>
            <Input
              id="setting-budget"
              type="number"
              min={1000}
              step={10000}
              value={config.tokenBudget}
              onChange={(e) =>
                void onUpdateConfig({ tokenBudget: Number(e.target.value) || config.tokenBudget })
              }
            />

            <label className="mt-2 flex items-center gap-2 text-[12px] text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={config.autoApproveWrites}
                onChange={(e) => void onUpdateConfig({ autoApproveWrites: e.target.checked })}
                className="accent-[var(--color-accent)]"
              />
              Auto-approve file writes
            </label>

            <label htmlFor="setting-theme" className="mb-1 mt-3 block text-[11px] text-ink-faint">
              Theme
            </label>
            <Select
              id="setting-theme"
              value={config.theme}
              onChange={(e) => void onUpdateConfig({ theme: e.target.value as 'dark' | 'light' })}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </Select>
          </section>
        ) : null}

        {/* ---- Workspace ---- */}
        <section>
          <h3 className="mb-1.5 text-xs font-semibold text-ink-muted">Workspace</h3>
          <div className="rounded-md border border-border bg-surface-2 p-2 font-mono text-[11px] break-all text-ink-muted">
            {settings?.workspaceRoot ?? '—'}
          </div>
        </section>
      </div>

      {message ? (
        <div
          className={
            message.ok
              ? 'border-t border-border bg-success-soft px-3 py-2 text-[11px] text-success'
              : 'border-t border-border bg-danger-soft px-3 py-2 text-[11px] text-danger'
          }
        >
          {message.text}
        </div>
      ) : null}
    </aside>
  )
}

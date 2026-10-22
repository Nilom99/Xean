import { useCallback, useEffect, useState } from 'react'
import type { SettingsState } from '@shared/types'
import { api } from '../lib/api'

/**
 * Load and mutate the app settings.
 *
 * Every mutation returns the fresh settings snapshot from the main process,
 * so the UI always reflects what was actually persisted.
 */
export function useSettings(): {
  settings: SettingsState | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  updateConfig: (patch: Parameters<ReturnType<typeof api>['updateConfig']>[0]) => Promise<void>
  setApiKey: (key: string) => Promise<void>
  clearApiKey: () => Promise<void>
  setRoleModel: (role: Parameters<ReturnType<typeof api>['setRoleModel']>[0], modelId: string) => Promise<void>
} {
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setSettings(await api().getSettings())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const updateConfig = useCallback(
    async (patch: Parameters<ReturnType<typeof api>['updateConfig']>[0]) => {
      try {
        setSettings(await api().updateConfig(patch))
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    []
  )

  const setApiKey = useCallback(async (key: string) => {
    try {
      setSettings(await api().setApiKey(key))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    }
  }, [])

  const clearApiKey = useCallback(async () => {
    try {
      setSettings(await api().clearApiKey())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    }
  }, [])

  const setRoleModel = useCallback(
    async (role: Parameters<ReturnType<typeof api>['setRoleModel']>[0], modelId: string) => {
      try {
        setSettings(await api().setRoleModel(role, modelId))
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    []
  )

  return { settings, loading, error, reload, updateConfig, setApiKey, clearApiKey, setRoleModel }
}

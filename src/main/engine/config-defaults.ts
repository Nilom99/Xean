import type { AppConfig } from '@shared/types'

/**
 * The shipped default configuration.
 *
 * Kept in its own module so that it can be imported without pulling in
 * Electron (the headless test harness uses it).
 */
export const DEFAULT_CONFIG: AppConfig = {
  workspaceRoot: './workspace',
  freeOnly: true,
  iterationsPerTask: 3,
  maxParallelTasks: 3,
  tokenBudget: 400_000,
  autoApproveWrites: false,
  theme: 'dark',
  roles: {
    orchestrator: {
      alias: 'minimax 3.1 flash',
      preferred: ['minimax/minimax-m3.1-flash:free'],
      fallbacks: []
    },
    implementer: {
      alias: 'lfm2.5',
      preferred: ['liquid/lfm-2.5-2.6b:free'],
      fallbacks: []
    },
    reviewer: {
      alias: 'dots3preview',
      preferred: ['dots-studio/dots-3-note-preview:free'],
      fallbacks: []
    },
    runner: {
      alias: 'north mini code',
      preferred: ['cohere/north-mini-code:free'],
      fallbacks: []
    }
  },
  providers: {
    localFirst: true,
    lmStudioEnabled: true,
    ollamaEnabled: true,
    lmStudioUrl: 'http://localhost:1234/v1',
    ollamaUrl: 'http://localhost:11434'
  }
}

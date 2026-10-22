import { execa } from 'execa'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export class SandboxError extends Error {
  constructor(
    message: string,
    readonly kind: 'path' | 'command' | 'timeout'
  ) {
    super(message)
    this.name = 'SandboxError'
  }
}

export interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
}

const COMMAND_TIMEOUT_MS = 120_000
const MAX_OUTPUT_CHARS = 20_000

/** Truncate long output so a runaway command cannot blow up the event log. */
export function truncateOutput(text: string, limit = MAX_OUTPUT_CHARS): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n[truncated]`
}

/**
 * Sandbox guard.
 *
 * Every filesystem write and every shell command performed by an agent goes
 * through this class. It resolves symlinks with realpath before comparing
 * against the workspace root, so symlink escapes are rejected too.
 */
export class Sandbox {
  constructor(private root: string) {}

  get rootPath(): string {
    return this.root
  }

  /** Change the active workspace root (used when the user picks a folder). */
  setRoot(root: string): void {
    this.root = path.resolve(root)
  }

  /**
   * Resolve a (possibly relative) path and assert it lives inside the
   * workspace root. Throws SandboxError when it escapes.
   */
  async resolveInside(target: string): Promise<string> {
    const rootResolved = await this.realpathOrNearest(this.root)
    const absolute = path.isAbsolute(target)
      ? path.resolve(target)
      : path.resolve(this.root, target)

    const normalized = path.normalize(absolute)

    // Fast path: lexically inside the root.
    const relative = path.relative(rootResolved, normalized)
    const lexicallyInside =
      relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
    if (!lexicallyInside) {
      throw new SandboxError(`Path escapes the workspace sandbox: ${target}`, 'path')
    }

    // Resolve the closest existing ancestor to defeat symlink escapes.
    const real = await this.realpathOrNearest(normalized)
    const realRelative = path.relative(rootResolved, real)
    const reallyInside =
      realRelative === '' || (!realRelative.startsWith('..') && !path.isAbsolute(realRelative))
    if (!reallyInside) {
      throw new SandboxError(
        `Path escapes the workspace sandbox via a symlink: ${target}`,
        'path'
      )
    }
    return normalized
  }

  /** Workspace-relative display path. */
  relative(absolute: string): string {
    const rel = path.relative(this.root, absolute)
    return rel === '' ? '.' : rel
  }

  /**
   * realpath the target, or the nearest existing ancestor when the target
   * does not exist yet (we are about to create it).
   */
  private async realpathOrNearest(target: string): Promise<string> {
    let current = target
    for (let i = 0; i < 32; i++) {
      try {
        return await fs.realpath(current)
      } catch {
        const parent = path.dirname(current)
        if (parent === current) return current
        current = parent
      }
    }
    return current
  }

  /** Write a file, creating parent directories. Enforces the sandbox. */
  async writeFile(target: string, content: string): Promise<string> {
    const safe = await this.resolveInside(target)
    await fs.mkdir(path.dirname(safe), { recursive: true })
    await fs.writeFile(safe, content, 'utf8')
    return safe
  }

  async readFile(target: string): Promise<string> {
    const safe = await this.resolveInside(target)
    return fs.readFile(safe, 'utf8')
  }

  async exists(target: string): Promise<boolean> {
    try {
      const safe = await this.resolveInside(target)
      await fs.access(safe)
      return true
    } catch {
      return false
    }
  }

  /**
   * Run a shell command inside the workspace.
   *
   * The command is executed with cwd = workspace root, a hard timeout and a
   * scrubbed environment. Shell metacharacters are intentionally allowed
   * (agents need pipes), but the working directory can never leave the
   * sandbox and no secret is inherited from the parent environment.
   */
  async runCommand(
    command: string,
    timeoutMs = COMMAND_TIMEOUT_MS,
    signal?: AbortSignal
  ): Promise<CommandResult> {
    const started = Date.now()
    const cwd = await this.realpathOrNearest(this.root)
    const env = this.scrubbedEnv()

    try {
      const result = await execa(command, {
        cwd,
        shell: true,
        timeout: timeoutMs,
        reject: false,
        maxBuffer: 10 * 1024 * 1024,
        env,
        windowsHide: true,
        ...(signal ? { cancelSignal: signal } : {})
      })
      return {
        exitCode: typeof result.exitCode === 'number' ? result.exitCode : 1,
        stdout: truncateOutput(result.stdout ?? ''),
        stderr: truncateOutput(result.stderr ?? ''),
        durationMs: Date.now() - started,
        timedOut: result.timedOut === true
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const timedOut = /timed out|ETIMEDOUT|timeout/i.test(message)
      if (timedOut) {
        return {
          exitCode: 124,
          stdout: '',
          stderr: `Command timed out after ${Math.round(timeoutMs / 1000)}s`,
          durationMs: Date.now() - started,
          timedOut: true
        }
      }
      if (/aborted|cancell?ed/i.test(message)) {
        return {
          exitCode: 130,
          stdout: '',
          stderr: 'Command cancelled.',
          durationMs: Date.now() - started,
          timedOut: false
        }
      }
      return {
        exitCode: 1,
        stdout: '',
        stderr: truncateOutput(message),
        durationMs: Date.now() - started,
        timedOut: false
      }
    }
  }

  /**
   * Build a child environment without secrets. The OpenRouter key is never
   * visible to agent-run shell commands.
   */
  private scrubbedEnv(): NodeJS.ProcessEnv {
    // Minimal allowlist instead of "copy everything and filter a few names":
    // unrelated application credentials (CI tokens, cloud keys, ...) must
    // never reach a model-generated shell command.
    const allowed = [
      'PATH',
      'HOME',
      'USERPROFILE',
      'USERNAME',
      'LOGNAME',
      'SHELL',
      'TERM',
      'LANG',
      'LC_ALL',
      'TMPDIR',
      'TMP',
      'TEMP',
      'SystemRoot',
      'windir',
      'ComSpec',
      'PATHEXT',
      'APPDATA',
      'LOCALAPPDATA',
      'ProgramFiles',
      'ProgramData',
      'NODE_EXTRA_CA_CERTS',
      'SSL_CERT_FILE',
      'CURL_CA_BUNDLE',
      'npm_config_cache',
      'npm_config_prefix'
    ]
    const env: NodeJS.ProcessEnv = {}
    for (const key of allowed) {
      const value = process.env[key]
      if (typeof value === 'string') env[key] = value
    }
    env.CODEX_LOCAL_SANDBOX = '1'
    env.CODEX_LOCAL_WORKSPACE = this.root
    return env
  }

  /** List files under the workspace (excluding noisy dirs). */
  async listFiles(limit = 500): Promise<string[]> {
    const out: string[] = []
    const skip = new Set([
      'node_modules',
      '.git',
      'dist',
      'out',
      '.codex-local',
      '.next',
      'build',
      'package-lock.json'
    ])

    const walk = async (dir: string): Promise<void> => {
      if (out.length >= limit) return
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (out.length >= limit) return
        if (skip.has(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full)
        } else if (entry.isFile()) {
          out.push(path.relative(this.root, full))
        }
      }
    }

    try {
      await fs.mkdir(this.root, { recursive: true })
      await walk(this.root)
    } catch {
      // workspace may not exist yet
    }
    return out
  }

  /** Temporary directory used for scratch files, still inside the sandbox. */
  tmpDir(): string {
    return path.join(this.root, '.codex-local', 'tmp')
  }

  /** Home directory (read-only reference for agents). */
  static homeDir(): string {
    return os.homedir()
  }
}

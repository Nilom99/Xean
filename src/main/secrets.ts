import { app, safeStorage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

export type KeySource = 'keychain' | 'env' | 'none'

/**
 * API key management.
 *
 * Primary storage is the OS keychain via Electron `safeStorage`; the
 * encrypted blob is written to the per-user app data directory. When
 * `safeStorage` is unavailable (headless Linux without a keyring) we fall
 * back to a plain `.env` file inside the user data directory.
 *
 * The fallback is not encrypted — it is a last-resort for environments
 * without a keyring. On desktop platforms with safeStorage available the
 * key is never written to disk in plaintext.
 *
 * The raw key never leaves this module except through `getApiKey()`.
 */

let cachedKey: string | null | undefined
let cachedSource: KeySource = 'none'

/** Directory holding the encrypted key blob. */
function keychainDir(): string {
  return app.getPath('userData')
}

/** Directory holding the `.env` fallback — user data, not the installed app. */
function envDir(): string {
  return app.getPath('userData')
}

async function readEnvFile(dir: string): Promise<string> {
  try {
    return await fs.readFile(path.join(dir, '.env'), 'utf8')
  } catch {
    return ''
  }
}

/** Parse OPENROUTER_API_KEY out of raw `.env` text. */
export function parseEnvKey(text: string): string | null {
  const match = text.match(/^\s*OPENROUTER_API_KEY\s*=\s*(.+)$/m)
  if (!match || !match[1]) return null
  const key = match[1].trim().replace(/^['"]|['"]$/g, '')
  return key.length > 0 ? key : null
}

async function keyFromEnv(): Promise<string | null> {
  const dir = envDir()
  try {
    await fs.access(path.join(dir, '.env'))
  } catch {
    return null
  }
  return parseEnvKey(await readEnvFile(dir))
}

async function keyFromKeychain(): Promise<string | null> {
  try {
    const file = path.join(keychainDir(), 'credentials.enc')
    const cipher = await fs.readFile(file, 'utf8')
    if (!cipher.trim()) return null
    if (!safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
  } catch {
    return null
  }
}

async function writeEnvFallback(value: string): Promise<void> {
  const dir = envDir()
  const file = path.join(dir, '.env')
  const existing = await readEnvFile(dir)
  const line = `OPENROUTER_API_KEY=${value}\n`
  const stripped = existing.replace(/^\s*OPENROUTER_API_KEY\s*=.*$/m, '')
  const next = `${stripped.replace(/\n{2,}/g, '\n').replace(/\n$/, '')}\n${line}`.replace(
    /^\n+/,
    ''
  )
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(file, next, 'utf8')
  // Restrict file permissions where supported (owner read/write only).
  try {
    await fs.chmod(file, 0o600)
  } catch {
    // chmod may fail on some filesystems; that is not fatal.
  }
}

/** Load the key from disk into memory (keychain first, then `.env`). */
export async function loadApiKey(): Promise<string | null> {
  if (cachedKey !== undefined) return cachedKey
  const fromChain = await keyFromKeychain()
  if (fromChain) {
    cachedKey = fromChain
    cachedSource = 'keychain'
    return cachedKey
  }
  const fromEnv = await keyFromEnv()
  if (fromEnv) {
    cachedKey = fromEnv
    cachedSource = 'env'
    return cachedKey
  }
  cachedKey = null
  cachedSource = 'none'
  return null
}

/** Synchronous accessor used by the HTTP client. */
export function getApiKey(): string | null {
  return cachedKey ?? null
}

/** Where the currently loaded key came from. */
export function getKeySource(): KeySource {
  return cachedSource
}

export function hasApiKey(): boolean {
  return Boolean(cachedKey)
}

/**
 * Persist a key. Uses the OS keychain when encryption is available. When
 * safeStorage is unavailable, falls back to a plaintext `.env` file in the
 * user data directory. The fallback is not mirrored from the keychain — it
 * is the only storage on headless Linux without a keyring.
 */
export async function saveApiKey(value: string): Promise<KeySource> {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('The API key is empty.')

  cachedKey = trimmed
  cachedSource = 'none'

  if (safeStorage.isEncryptionAvailable()) {
    try {
      const dir = keychainDir()
      await fs.mkdir(dir, { recursive: true })
      const cipher = safeStorage.encryptString(trimmed)
      await fs.writeFile(path.join(dir, 'credentials.enc'), cipher.toString('base64'), 'utf8')
      cachedSource = 'keychain'
    } catch {
      cachedSource = 'none'
    }
  }

  if (cachedSource !== 'keychain') {
    await writeEnvFallback(trimmed)
    cachedSource = 'env'
  }

  return cachedSource
}

/** Remove the stored key from both locations. */
export async function clearApiKey(): Promise<void> {
  cachedKey = null
  cachedSource = 'none'
  try {
    await fs.unlink(path.join(keychainDir(), 'credentials.enc'))
  } catch {
    // already gone
  }
  try {
    const dir = envDir()
    const existing = await readEnvFile(dir)
    const stripped = existing.replace(/^\s*OPENROUTER_API_KEY\s*=.*$/m, '').trim()
    if (stripped) {
      await fs.writeFile(path.join(dir, '.env'), `${stripped}\n`, 'utf8')
    } else {
      await fs.unlink(path.join(dir, '.env'))
    }
  } catch {
    // already gone
  }
}

/** Masked preview for the UI (never shows the whole key). */
export function maskedKey(): string {
  if (!cachedKey) return ''
  if (cachedKey.length <= 10) return '•'.repeat(cachedKey.length)
  return `${cachedKey.slice(0, 6)}••••••••${cachedKey.slice(-4)}`
}

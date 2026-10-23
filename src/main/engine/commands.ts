/**
 * Command helpers for the Runner.
 *
 * Models happily propose Unix shell pipelines even on Windows, where the
 * sandbox executes through cmd.exe. Such a command always fails, so it is
 * filtered out before the user is asked to approve it.
 */

/** Unix-only commands, matched as a whole word. */
const UNIX_ONLY = [
  'ls',
  'cat',
  'rm',
  'cp',
  'mv',
  'find',
  'grep',
  'pwd',
  'printf',
  'head',
  'tail',
  'chmod',
  'chown',
  'touch',
  'sudo',
  'which',
  'sed',
  'awk',
  'tar',
  'xargs',
  'curl',
  'wget'
]

const UNIX_ONLY_PATTERN = new RegExp(
  `(^|[\\s|;&(\\[])(?:${UNIX_ONLY.join('|')})(\\s|$)`,
  'i'
)

/** Merge command lists, keeping the first occurrence of each command. */
export function mergeCommands(...lists: string[][]): string[] {
  const out: string[] = []
  for (const list of lists) {
    for (const command of list) {
      const trimmed = command.trim()
      if (!trimmed) continue
      if (!out.some((existing) => existing === trimmed)) out.push(trimmed)
    }
  }
  return out
}

/**
 * True when the command can run on the given platform.
 *
 * On Windows the Unix-only utilities are rejected; everything else is allowed.
 */
export function isPlatformCompatible(
  command: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (platform !== 'win32') return true
  return !UNIX_ONLY_PATTERN.test(command)
}

/** Drop the commands that cannot run on this platform. */
export function filterPlatformCompatible(
  commands: string[],
  platform: NodeJS.Platform = process.platform
): { compatible: string[]; skipped: string[] } {
  const compatible: string[] = []
  const skipped: string[] = []
  for (const command of commands) {
    if (isPlatformCompatible(command, platform)) compatible.push(command)
    else skipped.push(command)
  }
  return { compatible, skipped }
}

export type CommandRiskLevel =
  | 'SAFE_READ_ONLY'
  | 'WORKSPACE_WRITE'
  | 'NETWORK_ACCESS'
  | 'HIGH_RISK_DESTRUCTIVE'

const HIGH_RISK_PATTERNS = [
  /rm\s+-rf?/i,
  /del\s+\/[sfq]/i,
  /format\s+[c-z]:/i,
  /drop\s+database/i,
  /sudo\s+/i,
  /chmod\s+777/i,
  />\s*\/dev\/null/i
]

const NETWORK_PATTERNS = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bgit\s+(push|fetch|pull)\b/i,
  /\bnpm\s+publish\b/i,
  /\bpnpm\s+publish\b/i
]

const READ_ONLY_PATTERNS = [
  /^(npm|pnpm|yarn)\s+test/i,
  /^(npm|pnpm|yarn)\s+run\s+typecheck/i,
  /^tsc\b/i,
  /^git\s+(status|diff|log|branch)/i,
  /^node\s+--test/i,
  /^(dir|ls|cat|echo|pwd)\b/i
]

/**
 * Classify terminal command by safety / impact risk level.
 */
export function classifyCommandRisk(command: string): CommandRiskLevel {
  const trimmed = command.trim()

  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.test(trimmed)) return 'HIGH_RISK_DESTRUCTIVE'
  }

  for (const pattern of NETWORK_PATTERNS) {
    if (pattern.test(trimmed)) return 'NETWORK_ACCESS'
  }

  for (const pattern of READ_ONLY_PATTERNS) {
    if (pattern.test(trimmed)) return 'SAFE_READ_ONLY'
  }

  return 'WORKSPACE_WRITE'
}


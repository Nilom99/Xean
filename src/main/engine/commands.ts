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

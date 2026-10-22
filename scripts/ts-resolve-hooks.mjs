/**
 * Module resolution hook for the test runner.
 *
 * The application source uses extensionless relative imports (`./json`) because
 * Vite resolves them at build time. Node's ESM resolver does not, so the
 * tests would fail to import anything from `src`. This hook retries a failed
 * relative specifier with the TypeScript extensions Node can execute.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs']

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    // The "@shared/*" path alias from tsconfig.
    if (specifier.startsWith('@shared/')) {
      const target = new URL(
        `../src/shared/${specifier.slice('@shared/'.length)}.ts`,
        import.meta.url
      )
      if (existsSync(fileURLToPath(target))) {
        return { url: target.href, shortCircuit: true, format: 'module-typescript' }
      }
    }

    if (!specifier.startsWith('.') && !specifier.startsWith('/')) throw err

    const parentPath = context.parentURL
      ? fileURLToPath(context.parentURL)
      : process.cwd()
    const base = new URL(specifier, pathToFileURL(parentPath))

    for (const ext of EXTENSIONS) {
      const candidate = new URL(base.href + ext)
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true, format: 'module-typescript' }
      }
    }

    for (const ext of EXTENSIONS) {
      const candidate = new URL(`${base.href}/index${ext}`)
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true, format: 'module-typescript' }
      }
    }

    throw err
  }
}

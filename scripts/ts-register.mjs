/**
 * Registers the TypeScript resolution hook used by the test runner.
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./ts-resolve-hooks.mjs', pathToFileURL(import.meta.filename))

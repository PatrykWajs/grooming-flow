/** Node-only loader for the rule files (tests and scripts); the app fetches them. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { EngineData } from '../recommend'

const root = fileURLToPath(new URL('../../../public/rules/', import.meta.url))

function read<T>(file: string): T {
  return JSON.parse(readFileSync(root + file, 'utf8')) as T
}

export function loadEngineData(): EngineData {
  return {
    taxonomy: read('taxonomy.json'),
    palette: read('palette.json'),
    rules: read('style-rules.json'),
    weatherRules: read('weather-rules.json'),
    templates: read('templates.json'),
    occasions: read('occasions.json'),
  }
}

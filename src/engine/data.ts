import type { EngineData } from './recommend'

let cache: Promise<EngineData> | null = null

async function getJson<T>(name: string): Promise<T> {
  const url = `${import.meta.env.BASE_URL}rules/${name}.json`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Cannot load ${url}: HTTP ${response.status}`)
  return (await response.json()) as T
}

/** The six editable rule files, fetched once per session (precached by the service worker). */
export function loadEngineData(): Promise<EngineData> {
  if (!cache) {
    cache = Promise.all([
      getJson<EngineData['taxonomy']>('taxonomy'),
      getJson<EngineData['palette']>('palette'),
      getJson<EngineData['rules']>('style-rules'),
      getJson<EngineData['weatherRules']>('weather-rules'),
      getJson<EngineData['templates']>('templates'),
      getJson<EngineData['occasions']>('occasions'),
    ]).then(([taxonomy, palette, rules, weatherRules, templates, occasions]) => ({
      taxonomy,
      palette,
      rules,
      weatherRules,
      templates,
      occasions,
    }))
    cache.catch(() => {
      cache = null
    })
  }
  return cache
}

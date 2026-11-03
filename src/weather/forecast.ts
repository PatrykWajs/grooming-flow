import { db, type WeatherCacheRecord } from '../data/db'
import { cacheKey, type WeatherProvider } from './provider'

export const FORECAST_MAX_AGE_HOURS = 3

export interface ForecastResult {
  record: WeatherCacheRecord
  /** Age of the data in minutes at the time of the call. */
  ageMinutes: number
  /** True when the network failed and the last forecast is shown. */
  stale: boolean
  offline: boolean
}

/**
 * Forecast for a location: cached for three hours in IndexedDB; on a failed
 * refresh the last forecast is returned with `stale: true`.
 */
export async function getForecast(provider: WeatherProvider, lat: number, lon: number, force = false): Promise<ForecastResult | null> {
  const key = cacheKey(lat, lon)
  const cached = await db.weather.get(key)
  const ageMinutes = cached ? (Date.now() - Date.parse(cached.fetchedAt)) / 60000 : Infinity
  const fresh = cached && cached.providerId === provider.id && ageMinutes < FORECAST_MAX_AGE_HOURS * 60
  if (fresh && !force) return { record: cached, ageMinutes, stale: false, offline: false }

  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  if (!offline) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      const forecast = await provider.fetchForecast(lat, lon, 16, controller.signal)
      clearTimeout(timer)
      const record: WeatherCacheRecord = {
        key,
        fetchedAt: forecast.fetchedAt,
        providerId: provider.id,
        timezone: forecast.timezone,
        hourly: forecast.hourly,
        daily: forecast.daily,
      }
      await db.weather.put(record)
      return { record, ageMinutes: 0, stale: false, offline: false }
    } catch {
      /* fall through to the cached copy */
    }
  }
  if (cached) return { record: cached, ageMinutes, stale: true, offline }
  return null
}

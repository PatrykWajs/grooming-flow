import type { HourlyWeather } from '../engine/types'
import type { Forecast, WeatherProvider } from './provider'

const URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact'

interface MetSeries {
  time: string
  data: {
    instant: { details: Record<string, number> }
    next_1_hours?: { details?: Record<string, number>; summary?: { symbol_code?: string } }
  }
}

/** Steadman-style feels-like from temperature, humidity and wind (MET gives no apparent temperature). */
export function feelsLike(temperature: number, humidity: number, windMs: number): number {
  const e = (humidity / 100) * 6.105 * Math.exp((17.27 * temperature) / (237.7 + temperature))
  return temperature + 0.33 * e - 0.7 * windMs - 4
}

/**
 * MET Norway (Norwegian Meteorological Institute, CC BY 4.0). Second
 * implementation of the provider interface; its terms ask for an identifying
 * User-Agent, which browsers cannot set, so it stays a fallback the user turns
 * on in Settings and may be throttled. No key, no cost.
 */
export const metNorway: WeatherProvider = {
  id: 'met-norway',
  name: 'MET Norway',
  attribution: 'Weather data from MET Norway (CC BY 4.0)',
  url: 'https://api.met.no/',

  async fetchForecast(lat, lon, _days, signal): Promise<Forecast> {
    const params = new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4) })
    const response = await fetch(`${URL}?${params}`, { signal, headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`MET Norway HTTP ${response.status}`)
    const body = (await response.json()) as { properties: { timeseries: MetSeries[] } }
    const hourly: HourlyWeather[] = []
    for (const point of body.properties.timeseries) {
      const i = point.data.instant.details
      const next = point.data.next_1_hours?.details ?? {}
      const temperature = i.air_temperature ?? 0
      const humidity = i.relative_humidity ?? 50
      const windMs = i.wind_speed ?? 0
      const symbol = point.data.next_1_hours?.summary?.symbol_code ?? ''
      hourly.push({
        time: point.time.slice(0, 16),
        temperature,
        apparent: feelsLike(temperature, humidity, windMs),
        humidity,
        precipitationProbability: next.probability_of_precipitation ?? 0,
        precipitation: next.precipitation_amount ?? 0,
        cloudCover: i.cloud_area_fraction ?? 0,
        uvIndex: i.ultraviolet_index_clear_sky ?? 0,
        windSpeed: windMs * 3.6,
        weatherCode: symbol.includes('rain') ? 61 : symbol.includes('cloud') ? 3 : 1,
        sunshine: symbol.startsWith('clearsky') || symbol.startsWith('fair') ? 3600 : 0,
      })
    }
    return { providerId: 'met-norway', fetchedAt: new Date().toISOString(), lat, lon, timezone: 'UTC', hourly, daily: [] }
  },
}

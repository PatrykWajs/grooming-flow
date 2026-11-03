import type { HourlyWeather } from '../engine/types'
import type { DailyRecord } from '../data/db'
import type { Forecast, GeoResult, Geocoder, WeatherProvider } from './provider'

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'

const HOURLY = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'precipitation_probability',
  'precipitation',
  'cloud_cover',
  'uv_index',
  'wind_speed_10m',
  'weather_code',
  'sunshine_duration',
]
const DAILY = [
  'sunrise',
  'sunset',
  'uv_index_max',
  'sunshine_duration',
  'apparent_temperature_max',
  'apparent_temperature_min',
  'precipitation_probability_max',
  'precipitation_sum',
]

interface OpenMeteoResponse {
  timezone: string
  hourly: Record<string, (number | string | null)[]>
  daily: Record<string, (number | string | null)[]>
  error?: boolean
  reason?: string
}

const num = (v: number | string | null | undefined): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0)

/**
 * Open-Meteo: free for non-commercial use, no key, CC-BY 4.0 attribution,
 * limits per IP and application (10,000 calls/day). Called from the user's
 * device, cached for three hours by the forecast store.
 */
export const openMeteo: WeatherProvider & Geocoder = {
  id: 'open-meteo',
  name: 'Open-Meteo',
  attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
  url: 'https://open-meteo.com/',

  async fetchForecast(lat, lon, days = 16, signal): Promise<Forecast> {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      hourly: HOURLY.join(','),
      daily: DAILY.join(','),
      forecast_days: String(Math.min(16, Math.max(1, days))),
      timezone: 'auto',
    })
    const response = await fetch(`${FORECAST_URL}?${params}`, { signal })
    if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`)
    const body = (await response.json()) as OpenMeteoResponse
    if (body.error) throw new Error(`Open-Meteo: ${body.reason ?? 'error'}`)
    const h = body.hourly
    const times = (h.time ?? []) as string[]
    const hourly: HourlyWeather[] = times.map((time, i) => ({
      time,
      temperature: num(h.temperature_2m?.[i]),
      apparent: num(h.apparent_temperature?.[i]),
      humidity: num(h.relative_humidity_2m?.[i]),
      precipitationProbability: num(h.precipitation_probability?.[i]),
      precipitation: num(h.precipitation?.[i]),
      cloudCover: num(h.cloud_cover?.[i]),
      uvIndex: num(h.uv_index?.[i]),
      windSpeed: num(h.wind_speed_10m?.[i]),
      weatherCode: num(h.weather_code?.[i]),
      sunshine: num(h.sunshine_duration?.[i]),
    }))
    const d = body.daily
    const days_ = (d.time ?? []) as string[]
    const daily: DailyRecord[] = days_.map((date, i) => ({
      date,
      sunrise: String(d.sunrise?.[i] ?? ''),
      sunset: String(d.sunset?.[i] ?? ''),
      uvMax: num(d.uv_index_max?.[i]),
      sunshineHours: num(d.sunshine_duration?.[i]) / 3600,
      apparentMax: num(d.apparent_temperature_max?.[i]),
      apparentMin: num(d.apparent_temperature_min?.[i]),
      precipitationProbabilityMax: num(d.precipitation_probability_max?.[i]),
      precipitationSum: num(d.precipitation_sum?.[i]),
    }))
    return { providerId: 'open-meteo', fetchedAt: new Date().toISOString(), lat, lon, timezone: body.timezone, hourly, daily }
  },

  async search(query, language, signal): Promise<GeoResult[]> {
    const params = new URLSearchParams({ name: query, count: '6', language: language.startsWith('el') ? 'el' : 'en', format: 'json' })
    const response = await fetch(`${GEOCODING_URL}?${params}`, { signal })
    if (!response.ok) throw new Error(`Open-Meteo geocoding HTTP ${response.status}`)
    const body = (await response.json()) as { results?: { name: string; country?: string; admin1?: string; latitude: number; longitude: number }[] }
    return (body.results ?? []).map((r) => ({ name: r.name, country: r.country ?? '', admin1: r.admin1, lat: r.latitude, lon: r.longitude }))
  },
}

export interface WeeklyNormal {
  /** ISO week of year, 1..53 */
  week: number
  apparentMax: number
  apparentMin: number
  rainDays: number
}

/**
 * Ten years of daily history → per-week normals, for plan days beyond the
 * 16-day forecast (phase 2). One call per location, cached for ever.
 */
export async function fetchWeeklyNormals(lat: number, lon: number, signal?: AbortSignal): Promise<WeeklyNormal[]> {
  const end = new Date()
  end.setUTCDate(end.getUTCDate() - 7)
  const start = new Date(end)
  start.setUTCFullYear(start.getUTCFullYear() - 10)
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
    daily: 'apparent_temperature_max,apparent_temperature_min,precipitation_hours',
    timezone: 'auto',
  })
  const response = await fetch(`${ARCHIVE_URL}?${params}`, { signal })
  if (!response.ok) throw new Error(`Open-Meteo archive HTTP ${response.status}`)
  const body = (await response.json()) as OpenMeteoResponse
  const d = body.daily
  const dates = (d.time ?? []) as string[]
  const buckets = new Map<number, { max: number[]; min: number[]; rain: number; days: number }>()
  dates.forEach((date, i) => {
    const week = isoWeek(date)
    const bucket = buckets.get(week) ?? { max: [], min: [], rain: 0, days: 0 }
    bucket.max.push(num(d.apparent_temperature_max?.[i]))
    bucket.min.push(num(d.apparent_temperature_min?.[i]))
    bucket.rain += num(d.precipitation_hours?.[i]) >= 1 ? 1 : 0
    bucket.days += 1
    buckets.set(week, bucket)
  })
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, b]) => ({ week, apparentMax: mean(b.max), apparentMin: mean(b.min), rainDays: b.days ? (b.rain / b.days) * 7 : 0 }))
}

export function isoWeek(date: string): number {
  const d = new Date(`${date}T00:00:00Z`)
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

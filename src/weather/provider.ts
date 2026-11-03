import type { HourlyWeather } from '../engine/types'
import type { DailyRecord } from '../data/db'

export interface Forecast {
  providerId: string
  fetchedAt: string
  lat: number
  lon: number
  timezone: string
  hourly: HourlyWeather[]
  daily: DailyRecord[]
}

export interface WeatherProvider {
  id: string
  name: string
  /** Attribution line shown in Settings and on the landing page. */
  attribution: string
  url: string
  fetchForecast(lat: number, lon: number, days: number, signal?: AbortSignal): Promise<Forecast>
}

export interface GeoResult {
  name: string
  country: string
  admin1?: string
  lat: number
  lon: number
}

export interface Geocoder {
  search(query: string, language: string, signal?: AbortSignal): Promise<GeoResult[]>
}

export function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`
}

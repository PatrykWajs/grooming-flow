import type { BandId, HourlyWeather, WeatherFlag, WeatherWindow } from './types'

export interface WeatherRules {
  version: number
  bands: { id: BandId; min?: number; max?: number; en: string; el: string }[]
  bandWarmth: Record<BandId, number>
  warmthTolerance: number
  flags: {
    rain: { probabilityMin: number; amountMmMin: number }
    humidity: { min: number; bands: BandId[] }
    sun: { uvMin: number; sunshineHoursMin: number }
    wind: { kmhMin: number }
    overcast: { cloudMin: number }
    spread: { degMin: number }
  }
  sets: Record<string, string[]>
  effects: Record<string, { hard?: Record<string, unknown>; soft?: Record<string, unknown> }>
}

const BAND_ORDER: BandId[] = ['heatwave', 'hot', 'warm', 'mild', 'cool', 'cold']

/** Band for a feels-like temperature, after the user's runs-hot/cold offset. */
export function bandFor(apparent: number, rules: WeatherRules, runsHotCold = 0): BandId {
  const t = apparent + runsHotCold
  for (const band of rules.bands) {
    const aboveMin = band.min === undefined || t >= band.min
    const belowMax = band.max === undefined || t < band.max
    if (aboveMin && belowMax) return band.id
  }
  return 'mild'
}

export function bandIndex(band: BandId): number {
  return BAND_ORDER.indexOf(band)
}

/** Allowed item warmth for a band: band warmth ± tolerance, +0.5 on overcast days. */
export function allowedWarmth(band: BandId, rules: WeatherRules, flags: WeatherFlag[]): [number, number] {
  const centre = rules.bandWarmth[band]
  const allowance = flags.includes('overcast') ? 0.5 : 0
  return [Math.max(1, centre - rules.warmthTolerance), Math.min(5, centre + rules.warmthTolerance + allowance)]
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m ?? 0)
}

/**
 * Hours of `hourly` inside the occasion window on `date` (YYYY-MM-DD).
 * A window that ends before it starts (20:00-01:00) spills into the next day.
 */
export function windowHours(hourly: HourlyWeather[], date: string, window: [string, string]): HourlyWeather[] {
  const start = toMinutes(window[0])
  const end = toMinutes(window[1])
  const crossesMidnight = end <= start
  const nextDate = addDays(date, 1)
  return hourly.filter((h) => {
    const [day, time] = h.time.split('T')
    if (!time) return false
    const minutes = toMinutes(time.slice(0, 5))
    if (!crossesMidnight) return day === date && minutes >= start && minutes < end
    if (day === date) return minutes >= start
    if (day === nextDate) return minutes < end
    return false
  })
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const max = (xs: number[]) => (xs.length ? Math.max(...xs) : 0)
const min = (xs: number[]) => (xs.length ? Math.min(...xs) : 0)

/** Summarise the hours of a window into the band and flags the engine reads. */
export function summariseWindow(hours: HourlyWeather[], rules: WeatherRules, runsHotCold = 0): WeatherWindow {
  if (hours.length === 0) {
    return {
      band: 'mild',
      flags: [],
      apparentMin: 0,
      apparentMax: 0,
      apparentMean: 0,
      rainProbabilityMax: 0,
      rainAmount: 0,
      humidityMean: 0,
      uvMax: 0,
      sunshineHours: 0,
      windMax: 0,
      cloudMean: 0,
      estimated: true,
    }
  }
  const apparent = hours.map((h) => h.apparent)
  const apparentMean = mean(apparent)
  const band = bandFor(apparentMean, rules, runsHotCold)
  const rainProbabilityMax = max(hours.map((h) => h.precipitationProbability))
  const rainAmount = hours.reduce((a, h) => a + h.precipitation, 0)
  const humidityMean = mean(hours.map((h) => h.humidity))
  const uvMax = max(hours.map((h) => h.uvIndex))
  const sunshineHours = hours.reduce((a, h) => a + h.sunshine, 0) / 3600
  const windMax = max(hours.map((h) => h.windSpeed))
  const cloudMean = mean(hours.map((h) => h.cloudCover))
  const flags: WeatherFlag[] = []
  const f = rules.flags
  if (rainProbabilityMax >= f.rain.probabilityMin || rainAmount >= f.rain.amountMmMin) flags.push('rain')
  if (humidityMean >= f.humidity.min && f.humidity.bands.includes(band)) flags.push('humidity')
  if (uvMax >= f.sun.uvMin || sunshineHours > f.sun.sunshineHoursMin) flags.push('sun')
  if (windMax >= f.wind.kmhMin) flags.push('wind')
  if (cloudMean >= f.overcast.cloudMin) flags.push('overcast')
  if (max(apparent) - min(apparent) >= f.spread.degMin) flags.push('spread')
  return {
    band,
    flags,
    apparentMin: min(apparent),
    apparentMax: max(apparent),
    apparentMean,
    rainProbabilityMax,
    rainAmount,
    humidityMean,
    uvMax,
    sunshineHours,
    windMax,
    cloudMean,
    estimated: false,
  }
}

/** A window built from a band alone (climate estimate, no hourly data). */
export function estimatedWindow(band: BandId, apparentMean: number, rain = false): WeatherWindow {
  return {
    band,
    flags: rain ? ['rain'] : [],
    apparentMin: apparentMean,
    apparentMax: apparentMean,
    apparentMean,
    rainProbabilityMax: rain ? 60 : 0,
    rainAmount: rain ? 2 : 0,
    humidityMean: 50,
    uvMax: 0,
    sunshineHours: 0,
    windMax: 0,
    cloudMean: 50,
    estimated: true,
  }
}

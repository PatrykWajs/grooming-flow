import { describe, expect, it } from 'vitest'
import { makeDay } from './fixtures'
import { loadEngineData } from './testing/loadData'
import { allowedWarmth, bandFor, summariseWindow, windowHours } from './weather'

const { weatherRules } = loadEngineData()

describe('weather bands and flags', () => {
  it('maps feels-like temperatures to the Greek-climate bands', () => {
    expect(bandFor(36, weatherRules)).toBe('heatwave')
    expect(bandFor(30, weatherRules)).toBe('hot')
    expect(bandFor(25, weatherRules)).toBe('warm')
    expect(bandFor(20, weatherRules)).toBe('mild')
    expect(bandFor(14, weatherRules)).toBe('cool')
    expect(bandFor(5, weatherRules)).toBe('cold')
  })

  it('shifts the band with the runs-hot/cold offset', () => {
    expect(bandFor(22, weatherRules, 0)).toBe('mild')
    expect(bandFor(22, weatherRules, 3)).toBe('warm')
    expect(bandFor(17, weatherRules, -3)).toBe('cool')
  })

  it('uses the evening hours for an evening occasion, not the daily maximum', () => {
    const day = makeDay('2026-11-03', { low: 8, high: 22 })
    const next = makeDay('2026-11-04', { low: 8, high: 22 })
    const evening = windowHours([...day, ...next], '2026-11-03', ['20:00', '01:00'])
    expect(evening).toHaveLength(5)
    const summary = summariseWindow(evening, weatherRules)
    expect(summary.apparentMax).toBeLessThan(20)
    const office = summariseWindow(windowHours(day, '2026-11-03', ['08:00', '18:00']), weatherRules)
    expect(office.apparentMax).toBeGreaterThan(summary.apparentMax)
  })

  it('raises the rain, sun and wind flags from the thresholds', () => {
    const rainy = summariseWindow(windowHours(makeDay('2026-11-03', { low: 10, high: 14, rain: 60, rainMm: 5, cloud: 95 }), '2026-11-03', ['08:00', '18:00']), weatherRules)
    expect(rainy.band).toBe('cool')
    expect(rainy.flags).toContain('rain')
    expect(rainy.flags).toContain('overcast')
    const sunny = summariseWindow(windowHours(makeDay('2026-07-10', { low: 24, high: 33, uv: 8, sunshine: 1 }), '2026-07-10', ['10:00', '20:00']), weatherRules)
    expect(sunny.flags).toContain('sun')
    expect(sunny.band).toBe('hot')
    const windy = summariseWindow(windowHours(makeDay('2026-03-10', { low: 12, high: 18, wind: 40 }), '2026-03-10', ['08:00', '18:00']), weatherRules)
    expect(windy.flags).toContain('wind')
  })

  it('flags a large day-night spread', () => {
    const spread = summariseWindow(windowHours(makeDay('2026-04-10', { low: 6, high: 24 }), '2026-04-10', ['07:00', '22:00']), weatherRules)
    expect(spread.flags).toContain('spread')
  })

  it('allows one warmth step either side of the band, half a step more when overcast', () => {
    expect(allowedWarmth('mild', weatherRules, [])).toEqual([2, 4])
    expect(allowedWarmth('mild', weatherRules, ['overcast'])).toEqual([2, 4.5])
    expect(allowedWarmth('cold', weatherRules, [])).toEqual([4, 5])
  })
})

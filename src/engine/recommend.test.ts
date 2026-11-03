import { describe, expect, it } from 'vitest'
import { emptySignals, makeContext } from './context'
import { makeDay, makeFixtureWardrobe } from './fixtures'
import { isEligible, recommend } from './recommend'
import { loadEngineData } from './testing/loadData'
import { summariseWindow, windowHours } from './weather'

const data = loadEngineData()
const wardrobe = makeFixtureWardrobe(data.taxonomy, 120)
const occasion = (id: string) => data.occasions.occasions.find((o) => o.id === id)!

function windowFor(date: string, profile: Parameters<typeof makeDay>[1], occasionId: string) {
  const day = makeDay(date, profile)
  const next = makeDay(date.slice(0, 8) + String(Number(date.slice(8)) + 1).padStart(2, '0'), profile)
  return summariseWindow(windowHours([...day, ...next], date, occasion(occasionId).window), data.weatherRules)
}

describe('recommend', () => {
  it('builds an office outfit with the required slots on a mild day', () => {
    const weather = windowFor('2026-10-05', { low: 14, high: 22 }, 'office')
    const result = recommend(makeContext('2026-10-05', wardrobe, weather, occasion('office')), data)
    expect(result.outfits.length).toBeGreaterThanOrEqual(3)
    const first = result.outfits[0]
    expect(first.slots.base).toBeTruthy()
    expect(first.slots.bottoms).toBeTruthy()
    expect(first.slots.shoes).toBeTruthy()
    expect(first.slots.belt).toBeTruthy()
    expect(first.reasons[0].key).toBe('reason.weather')
  })

  it('never proposes suede or canvas on a rainy cool day and requires a water-resistant coat', () => {
    const weather = windowFor('2026-11-12', { low: 9, high: 14, rain: 70, rainMm: 6 }, 'office')
    expect(weather.band).toBe('cool')
    expect(weather.flags).toContain('rain')
    const result = recommend(makeContext('2026-11-12', wardrobe, weather, occasion('office')), data)
    expect(result.outfits.length).toBeGreaterThan(0)
    for (const outfit of result.outfits) {
      const items = outfit.itemIds.map((id) => wardrobe.find((i) => i.id === id)!)
      expect(items.some((i) => i.material === 'suede' || i.material === 'canvas' || i.subcategory === 'espadrilles')).toBe(false)
      const outer = items.find((i) => i.role === 'outer')
      expect(outer).toBeTruthy()
      expect(data.weatherRules.sets.waterResistantOuter).toContain(outer!.subcategory)
    }
  })

  it('dresses an evening occasion for the evening temperature', () => {
    const office = windowFor('2026-04-20', { low: 9, high: 26 }, 'office')
    const evening = windowFor('2026-04-20', { low: 9, high: 26 }, 'evening')
    expect(office.band).toBe('mild')
    expect(evening.band).toBe('cool')
    const result = recommend(makeContext('2026-04-20', wardrobe, evening, occasion('evening')), data)
    const items = result.outfits[0].itemIds.map((id) => wardrobe.find((i) => i.id === id)!)
    expect(items.some((i) => i.role === 'outer')).toBe(true)
    expect(items.some((i) => i.subcategory === 'cap')).toBe(false)
  })

  it('skips items in the wash and honours locks and exclusions', () => {
    const weather = windowFor('2026-10-05', { low: 14, high: 22 }, 'casual')
    const base = recommend(makeContext('2026-10-05', wardrobe, weather, occasion('casual')), data)
    const firstBottoms = base.outfits[0].slots.bottoms
    const washed = wardrobe.map((i) => (i.id === firstBottoms ? { ...i, status: 'wash' as const } : i))
    const again = recommend(makeContext('2026-10-05', washed, weather, occasion('casual')), data)
    expect(again.outfits.every((o) => o.slots.bottoms !== firstBottoms)).toBe(true)

    const signals = emptySignals()
    const altBottoms = wardrobe.find(
      (i) => i.role === 'bottoms' && i.id !== firstBottoms && isEligible(i, weather, occasion('casual'), makeContext('2026-10-05', wardrobe, weather, occasion('casual')).settings, data),
    )!.id
    signals.locked.add(altBottoms)
    const locked = recommend(makeContext('2026-10-05', wardrobe, weather, occasion('casual'), { signals }), data)
    expect(locked.outfits.every((o) => o.slots.bottoms === altBottoms)).toBe(true)

    const excluded = emptySignals()
    excluded.excluded.add(firstBottoms)
    const swapped = recommend(makeContext('2026-10-05', wardrobe, weather, occasion('casual'), { signals: excluded }), data)
    expect(swapped.outfits.every((o) => o.slots.bottoms !== firstBottoms)).toBe(true)
  })

  it('is deterministic for the same context and changes with the seed', () => {
    const weather = windowFor('2026-10-05', { low: 14, high: 22 }, 'casual')
    const a = recommend(makeContext('2026-10-05', wardrobe, weather, occasion('casual')), data)
    const b = recommend(makeContext('2026-10-05', wardrobe, weather, occasion('casual')), data)
    expect(a.outfits[0].itemIds).toEqual(b.outfits[0].itemIds)
  })

  it('never repeats an outfit worn in the no-repeat window', () => {
    const weather = windowFor('2026-10-05', { low: 14, high: 22 }, 'casual')
    const first = recommend(makeContext('2026-10-05', wardrobe, weather, occasion('casual')), data).outfits[0]
    const again = recommend(makeContext('2026-10-05', wardrobe, weather, occasion('casual'), { recentOutfits: [first.itemIds] }), data)
    expect(again.outfits.some((o) => o.itemIds.length === first.itemIds.length && o.itemIds.every((id) => first.itemIds.includes(id)))).toBe(false)
  })

  it('only athletic pieces for the gym and no outerwear at home', () => {
    const weather = windowFor('2026-10-05', { low: 14, high: 22 }, 'gym')
    const gym = recommend(makeContext('2026-10-05', wardrobe, weather, occasion('gym')), data)
    expect(gym.outfits.length).toBeGreaterThan(0)
    for (const o of gym.outfits) {
      const items = o.itemIds.map((id) => wardrobe.find((i) => i.id === id)!)
      expect(items.every((i) => ['t-shirt', 'hoodie', 'henley', 'joggers', 'shorts', 'athletic', 'sneakers'].includes(i.subcategory))).toBe(true)
    }
    const home = recommend(makeContext('2026-10-05', wardrobe, windowFor('2026-10-05', { low: 14, high: 22 }, 'home'), occasion('home')), data)
    expect(home.outfits[0].slots.outer).toBeUndefined()
  })

  it('answers in under 300 ms for a 300-item wardrobe', () => {
    const big = makeFixtureWardrobe(data.taxonomy, 300, 7)
    const weather = windowFor('2026-10-05', { low: 14, high: 22 }, 'office')
    const start = performance.now()
    const result = recommend(makeContext('2026-10-05', big, weather, occasion('office')), data)
    const ms = performance.now() - start
    expect(result.outfits.length).toBeGreaterThan(0)
    expect(ms).toBeLessThan(300)
  })
})

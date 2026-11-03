import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './context'
import { rotationScores } from './fairness'
import { makeDay, makeFixtureWardrobe } from './fixtures'
import { orderSteps, planSequence, type PlanStep } from './plan'
import { loadEngineData } from './testing/loadData'
import type { EngineItem, Occasion } from './types'
import { addDays, summariseWindow, windowHours } from './weather'

const data = loadEngineData()
const occasion = (id: string): Occasion => data.occasions.occasions.find((o) => o.id === id)!
const mild = { low: 14, high: 22, rain: 5, rainMm: 0 }

function weatherFor(date: string, occ: Occasion) {
  const hours = [...makeDay(date, mild), ...makeDay(addDays(date, 1), mild)]
  return summariseWindow(windowHours(hours, date, occ.window), data.weatherRules)
}

function step(key: string, date: string, occasionId: string, extra: Partial<PlanStep> = {}): PlanStep {
  const occ = occasion(occasionId)
  return { key, date, occasion: occ, weather: weatherFor(date, occ), ...extra }
}

const history = { events: [], recentOutfits: [] }

describe('planSequence', () => {
  const items: EngineItem[] = makeFixtureWardrobe(data.taxonomy, 90, 7, '2026-09-01')

  it('two outfits on one day share neither the top nor the trousers', () => {
    const date = '2026-10-05'
    const [am, pm] = planSequence([step('am', date, 'office'), step('pm', date, 'evening')], items, data, DEFAULT_SETTINGS, history)
    expect(am.outfit).not.toBeNull()
    expect(pm.outfit).not.toBeNull()
    expect(pm.outfit!.slots.base).not.toBe(am.outfit!.slots.base)
    expect(pm.outfit!.slots.bottoms).not.toBe(am.outfit!.slots.bottoms)
  })

  it('a week of office days never repeats the previous day top or trousers, nor a whole outfit', () => {
    const steps = Array.from({ length: 7 }, (_, i) => step(`d${i}`, addDays('2026-10-05', i), 'office'))
    const outfits = planSequence(steps, items, data, DEFAULT_SETTINGS, history).map((r) => r.outfit)
    outfits.forEach((o) => expect(o).not.toBeNull())
    for (let i = 1; i < outfits.length; i++) {
      expect(outfits[i]!.slots.base, `day ${i} top`).not.toBe(outfits[i - 1]!.slots.base)
      expect(outfits[i]!.slots.bottoms, `day ${i} trousers`).not.toBe(outfits[i - 1]!.slots.bottoms)
    }
    const keys = outfits.map((o) => [...o!.itemIds].sort().join('|'))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('an outfit the user fixed is not recommended again and steers the next day', () => {
    const date = '2026-10-05'
    const first = planSequence([step('a', date, 'office')], items, data, DEFAULT_SETTINGS, history)[0].outfit!
    const next = addDays(date, 1)
    const [fixed, planned] = planSequence([step('a', date, 'office', { fixedItemIds: first.itemIds }), step('b', next, 'office')], items, data, DEFAULT_SETTINGS, history)
    expect(fixed.outfit).toBeNull()
    expect(planned.outfit).not.toBeNull()
    expect(planned.outfit!.slots.base).not.toBe(first.slots.base)
  })

  it('confirmed history before the plan counts: yesterday top is not today top', () => {
    const yesterday = planSequence([step('y', '2026-10-04', 'office')], items, data, DEFAULT_SETTINGS, history)[0].outfit!
    const events = yesterday.itemIds.map((itemId) => ({ itemId, date: '2026-10-04' }))
    const today = planSequence([step('t', '2026-10-05', 'office')], items, data, DEFAULT_SETTINGS, { events, recentOutfits: [yesterday.itemIds] })[0].outfit!
    expect(today.slots.base).not.toBe(yesterday.slots.base)
  })

  it('orders steps by the calendar and keeps the given order within a day', () => {
    const ordered = orderSteps([step('c', '2026-10-06', 'office'), step('b', '2026-10-05', 'evening'), step('a', '2026-10-05', 'office')])
    expect(ordered.map((s) => s.key)).toEqual(['b', 'a', 'c'])
  })

  it('reports why a step could not be filled instead of throwing', () => {
    const results = planSequence([step('x', '2026-10-05', 'formal')], items.filter((i) => i.role !== 'shoes'), data, DEFAULT_SETTINGS, history)
    expect(results[0].outfit).toBeNull()
    expect(results[0].reason).toBeDefined()
  })
})

describe('same-day cooldown', () => {
  it('a top worn earlier today scores its cooldown value for the evening', () => {
    const items = makeFixtureWardrobe(data.taxonomy, 30, 3, '2026-09-01').map((i) => ({ ...i, wearCount: 3, eligibleDays: 20 }))
    const top = items.find((i) => i.role === 'base')!
    const wornToday = items.map((i) => (i.id === top.id ? { ...i, lastWorn: '2026-10-05' } : i))
    const scores = rotationScores(wornToday, DEFAULT_SETTINGS, '2026-10-05')
    expect(scores.get(top.id)!.cooldown).toBe(true)
    expect(scores.get(top.id)!.score).toBe(0)
  })
})

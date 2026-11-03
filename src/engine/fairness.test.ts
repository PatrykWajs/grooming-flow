import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './context'
import { neglectedItems, rotationScores } from './fairness'
import type { EngineItem } from './types'

function top(id: string, wearCount: number, eligibleDays: number, extra: Partial<EngineItem> = {}): EngineItem {
  return {
    id,
    category: 'tops',
    subcategory: 't-shirt',
    role: 'base',
    colourPrimary: 'white',
    pattern: 'solid',
    material: 'cotton',
    warmth: 1,
    formality: 2,
    seasons: ['summer'],
    status: 'active',
    favourite: false,
    wearCount,
    lastWorn: null,
    eligibleDays,
    addedAt: '2026-01-01',
    ...extra,
  }
}

describe('rotation fairness', () => {
  it('scores the under-worn item above the over-worn one', () => {
    const items = [top('a', 10, 100), top('b', 2, 100), top('c', 6, 100), top('d', 6, 100)]
    const scores = rotationScores(items, DEFAULT_SETTINGS, '2026-06-01')
    expect(scores.get('b')!.score).toBeGreaterThan(scores.get('c')!.score)
    expect(scores.get('c')!.score).toBeGreaterThan(scores.get('a')!.score)
    expect(scores.get('c')!.balanced).toBe(true)
    expect(scores.get('c')!.score).toBe(0.5)
  })

  it('does not punish an item that was rarely eligible', () => {
    // A summer shirt eligible 10 days and worn twice is on pace with a shirt eligible 100 days and worn 20 times.
    const items = [top('summer', 2, 10), top('allyear', 20, 100), top('other', 11, 100)]
    const scores = rotationScores(items, DEFAULT_SETTINGS, '2026-06-01')
    expect(scores.get('summer')!.deficit).toBeCloseTo(scores.get('allyear')!.deficit * 0.1, 5)
  })

  it('applies the cooldown for an item worn yesterday', () => {
    const items = [top('a', 3, 50, { lastWorn: '2026-05-31' }), top('b', 3, 50), top('c', 9, 50)]
    const scores = rotationScores(items, DEFAULT_SETTINGS, '2026-06-01')
    expect(scores.get('a')!.cooldown).toBe(true)
    expect(scores.get('a')!.score).toBe(0)
    const shoes = rotationScores([{ ...top('s', 3, 50, { lastWorn: '2026-05-31' }), role: 'shoes', category: 'shoes', subcategory: 'sneakers' }], DEFAULT_SETTINGS, '2026-06-01')
    expect(shoes.get('s')!.score).toBe(0.5)
    const belt = rotationScores([{ ...top('b', 3, 50, { lastWorn: '2026-05-31' }), role: 'belt', category: 'belts', subcategory: 'leather-dress' }], DEFAULT_SETTINGS, '2026-06-01')
    expect(belt.get('b')!.cooldown).toBe(false)
  })

  it('compares peers by role, so a sweater is not measured against t-shirts', () => {
    const items = [top('tee1', 20, 60), top('tee2', 20, 60), top('knit', 4, 60, { role: 'layer', subcategory: 'sweater' }), top('knit2', 4, 60, { role: 'layer', subcategory: 'sweater' })]
    const scores = rotationScores(items, DEFAULT_SETTINGS, '2026-06-01')
    expect(scores.get('knit')!.balanced).toBe(true)
    expect(scores.get('knit')!.score).toBe(0.5)
  })

  it('boosts a new item for 14 days', () => {
    const items = [top('old', 5, 100), top('new', 0, 3, { addedAt: '2026-05-29' }), top('mid', 5, 100)]
    const scores = rotationScores(items, DEFAULT_SETTINGS, '2026-06-01')
    expect(scores.get('new')!.isNew).toBe(true)
    expect(scores.get('new')!.score).toBeGreaterThan(scores.get('old')!.score)
  })

  it('lists neglected items after 60 eligible days', () => {
    const items = [top('a', 10, 90), top('b', 2, 90), top('c', 10, 90), top('young', 0, 20)]
    expect(neglectedItems(items).map((i) => i.id)).toEqual(['b'])
  })
})

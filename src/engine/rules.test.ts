import { describe, expect, it } from 'vitest'
import { checkHardRules, effectiveFormality, matches, styleScore } from './rules'
import { loadEngineData } from './testing/loadData'
import type { EngineItem } from './types'

const data = loadEngineData()

function item(partial: Partial<EngineItem> & Pick<EngineItem, 'id' | 'subcategory' | 'role' | 'category' | 'colourPrimary'>): EngineItem {
  return {
    pattern: 'solid',
    material: 'cotton',
    warmth: 2,
    formality: 3,
    seasons: ['spring', 'autumn'],
    status: 'active',
    favourite: false,
    wearCount: 0,
    lastWorn: null,
    eligibleDays: 0,
    addedAt: '2026-01-01',
    ...partial,
  }
}

const navyChinos = item({ id: 'chinos', subcategory: 'chinos', role: 'bottoms', category: 'bottoms', colourPrimary: 'navy', formality: 3 })
const whiteShirt = item({ id: 'shirt', subcategory: 'casual-shirt', role: 'base', category: 'tops', colourPrimary: 'white', formality: 3 })
const brownLoafers = item({ id: 'loafers', subcategory: 'loafers', role: 'shoes', category: 'shoes', colourPrimary: 'brown', material: 'leather', formality: 3 })
const brownBelt = item({ id: 'belt-brown', subcategory: 'leather-casual', role: 'belt', category: 'belts', colourPrimary: 'brown', material: 'leather', formality: 3 })
const blackBelt = item({ id: 'belt-black', subcategory: 'leather-dress', role: 'belt', category: 'belts', colourPrimary: 'black', material: 'leather', formality: 4 })
const blackOxfords = item({ id: 'oxfords', subcategory: 'derbies-oxfords', role: 'shoes', category: 'shoes', colourPrimary: 'black', material: 'leather', formality: 4 })

describe('style rules from the deck', () => {
  it('a combination the slides show as right scores at least 0.8', () => {
    const score = styleScore([navyChinos, whiteShirt, brownLoafers, brownBelt], data.rules, data.palette, 'casual')
    expect(score.total).toBeGreaterThanOrEqual(0.8)
    expect(checkHardRules([navyChinos, whiteShirt, brownLoafers, brownBelt], data.rules, data.palette, 'casual', true).ok).toBe(true)
  })

  it('black shoes with a brown belt are rejected (s003)', () => {
    const check = checkHardRules([navyChinos, whiteShirt, blackOxfords, brownBelt], data.rules, data.palette, 'office', true)
    expect(check.ok).toBe(false)
    expect(check.violations).toContain('R01')
    expect(check.violations).toContain('R02')
  })

  it('brown shoes with a black belt are rejected (s003)', () => {
    const check = checkHardRules([navyChinos, whiteShirt, brownLoafers, blackBelt], data.rules, data.palette, 'office', true)
    expect(check.ok).toBe(false)
  })

  it('white sneakers are exempt from the belt match (room-026)', () => {
    const whiteSneakers = item({ id: 'sneakers', subcategory: 'sneakers', role: 'shoes', category: 'shoes', colourPrimary: 'white', material: 'leather', formality: 2 })
    const blackCasualBelt = item({ ...blackBelt, id: 'belt-black-casual', subcategory: 'leather-casual', formality: 3 })
    expect(checkHardRules([navyChinos, whiteShirt, whiteSneakers, brownBelt], data.rules, data.palette, 'casual', true).ok).toBe(true)
    expect(checkHardRules([navyChinos, whiteShirt, whiteSneakers, blackCasualBelt], data.rules, data.palette, 'casual', true).ok).toBe(true)
  })

  it('a thin dress belt with sneakers breaks the belt-shoes formality step (s003)', () => {
    const whiteSneakers = item({ id: 'sneakers', subcategory: 'sneakers', role: 'shoes', category: 'shoes', colourPrimary: 'white', material: 'leather', formality: 2 })
    expect(checkHardRules([navyChinos, whiteShirt, whiteSneakers, blackBelt], data.rules, data.palette, 'casual', true).violations).toContain('R03')
  })

  it('a fabric belt never with dress shoes, but it crosses the leather families (room-026)', () => {
    const canvasBelt = item({ id: 'belt-canvas', subcategory: 'canvas', role: 'belt', category: 'belts', colourPrimary: 'grey', material: 'canvas', formality: 2 })
    const check = checkHardRules([navyChinos, whiteShirt, blackOxfords, canvasBelt], data.rules, data.palette, 'casual', true)
    expect(check.violations).toContain('R01b')
    const blackWoven = item({ id: 'belt-woven', subcategory: 'woven', role: 'belt', category: 'belts', colourPrimary: 'black', material: 'other', formality: 2 })
    const chukkas = item({ id: 'chukkas', subcategory: 'chukka-boots', role: 'shoes', category: 'shoes', colourPrimary: 'tan', material: 'suede', formality: 3 })
    expect(checkHardRules([navyChinos, whiteShirt, chukkas, blackWoven], data.rules, data.palette, 'casual', true).ok).toBe(true)
  })

  it('three patterned items break the pattern limit (room-014)', () => {
    const a = item({ ...whiteShirt, id: 'a', pattern: 'stripe' })
    const b = item({ id: 'b', subcategory: 'sweater', role: 'layer', category: 'tops', colourPrimary: 'navy', pattern: 'check', material: 'knit' })
    const c = item({ ...navyChinos, id: 'c', pattern: 'print' })
    const check = checkHardRules([a, b, c], data.rules, data.palette, 'casual', true)
    expect(check.violations).toContain('R23')
    const two = checkHardRules([a, b, navyChinos], data.rules, data.palette, 'casual', true)
    expect(two.violations).not.toContain('R23')
  })

  it('a necklace requires a t-shirt (s046)', () => {
    const necklace = item({ id: 'necklace', subcategory: 'necklace', role: 'accessory', category: 'accessories', colourPrimary: 'black', formality: 1 })
    expect(checkHardRules([whiteShirt, navyChinos, necklace], data.rules, data.palette, 'casual', true).violations).toContain('R44')
    const tee = item({ id: 'tee', subcategory: 't-shirt', role: 'base', category: 'tops', colourPrimary: 'white', formality: 2 })
    expect(checkHardRules([tee, navyChinos, necklace], data.rules, data.palette, 'casual', true).ok).toBe(true)
  })

  it('a sport watch never with a tie (s040)', () => {
    const watch = item({ id: 'watch', subcategory: 'watch-sport', role: 'accessory', category: 'accessories', colourPrimary: 'black', formality: 2 })
    const tie = item({ id: 'tie', subcategory: 'tie', role: 'accessory', category: 'accessories', colourPrimary: 'navy', formality: 5 })
    expect(checkHardRules([whiteShirt, navyChinos, watch, tie], data.rules, data.palette, 'smart', true).violations).toContain('R49')
  })

  it('formality spread over two steps is rejected (s064)', () => {
    const joggers = item({ id: 'joggers', subcategory: 'joggers', role: 'bottoms', category: 'bottoms', colourPrimary: 'grey', formality: 1 })
    const blazer = item({ id: 'blazer', subcategory: 'blazer', role: 'outer', category: 'outerwear', colourPrimary: 'navy', formality: 4, material: 'wool' })
    expect(checkHardRules([joggers, whiteShirt, blazer], data.rules, data.palette, 'casual', true).violations).toContain('R27')
  })

  it('dark jeans gain half a formality step, prints lose one (s085, s068)', () => {
    const darkJeans = item({ id: 'jeans', subcategory: 'jeans', role: 'bottoms', category: 'bottoms', colourPrimary: 'navy', material: 'denim', formality: 2 })
    expect(effectiveFormality(darkJeans, data.rules, data.palette)).toBe(2.5)
    const printShirt = item({ ...whiteShirt, id: 'print', pattern: 'print' })
    expect(effectiveFormality(printShirt, data.rules, data.palette)).toBe(2)
  })

  it('light on top and dark on the bottom beats the reverse (s059)', () => {
    const lightTop = styleScore([whiteShirt, navyChinos], data.rules, data.palette, 'casual')
    const darkTop = styleScore([item({ ...whiteShirt, id: 'navy-shirt', colourPrimary: 'navy' }), item({ ...navyChinos, id: 'cream-chinos', colourPrimary: 'cream' })], data.rules, data.palette, 'casual')
    expect(lightTop.lightness).toBeGreaterThan(darkTop.lightness)
  })

  it('pattern on pattern scores lower than solid on solid (s065)', () => {
    const solids = styleScore([whiteShirt, navyChinos], data.rules, data.palette, 'casual')
    const patterns = styleScore([item({ ...whiteShirt, id: 's1', pattern: 'stripe' }), item({ ...navyChinos, id: 'c1', pattern: 'check' })], data.rules, data.palette, 'casual')
    expect(patterns.pairs).toBeLessThan(solids.pairs)
  })

  it('selectors match any-of lists and families', () => {
    expect(matches({ colour: ['navy', 'blue'] }, navyChinos, data.palette)).toBe(true)
    expect(matches({ family: 'blue' }, navyChinos, data.palette)).toBe(true)
    expect(matches({ light: true }, navyChinos, data.palette)).toBe(false)
    expect(matches({ role: ['base', 'layer'], colour: 'white' }, whiteShirt, data.palette)).toBe(true)
  })
})

describe('rule data integrity', () => {
  const colourIds = new Set(data.palette.colours.map((c) => c.id))
  const subIds = new Set(data.taxonomy.categories.flatMap((c) => c.subcategories.map((s) => s.id)))
  const roles = new Set(['base', 'layer', 'outer', 'bottoms', 'shoes', 'belt', 'accessory', 'set'])

  function checkSelector(sel: Record<string, unknown>, where: string) {
    const list = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v])
    for (const c of list(sel.colour)) expect(colourIds.has(c as string), `${where}: colour ${c}`).toBe(true)
    for (const s of list(sel.subcategory)) expect(subIds.has(s as string), `${where}: subcategory ${s}`).toBe(true)
    for (const r of list(sel.role)) expect(roles.has(r as string), `${where}: role ${r}`).toBe(true)
  }

  it('every rule references known colours, subcategories and roles', () => {
    for (const rule of data.rules.rules) {
      const r = rule as unknown as Record<string, unknown>
      for (const key of ['a', 'b', 'applies', 'exempt', 'lighter', 'darker']) {
        if (r[key]) checkSelector(r[key] as Record<string, unknown>, `${rule.id}.${key}`)
      }
      if (rule.type === 'palette') for (const c of rule.colours) expect(colourIds.has(c), `${rule.id}: ${c}`).toBe(true)
      if (rule.type === 'match') for (const s of rule.slots) expect(roles.has(s)).toBe(true)
      expect(rule.slide, `${rule.id} cites a slide`).toBeTruthy()
    }
  })

  it('rule ids are unique', () => {
    const ids = data.rules.rules.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

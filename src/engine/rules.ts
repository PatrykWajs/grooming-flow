import { familyOf, isLight, leatherFamily, lightnessOf, type Palette } from './palette'
import type { EngineItem, Material, Pattern, Role } from './types'

/** Attribute selector: every given field must match; arrays mean any-of. */
export interface Selector {
  role?: Role | Role[]
  category?: string | string[]
  subcategory?: string | string[]
  colour?: string | string[]
  family?: string | string[]
  light?: boolean
  pattern?: Pattern | Pattern[]
  material?: Material | Material[]
}

interface RuleBase {
  id: string
  slide: string
  note?: string
}

export type StyleRule =
  | (RuleBase & { type: 'pair'; a: Selector; b: Selector; score: number })
  | (RuleBase & { type: 'never'; a: Selector; b: Selector; same?: Array<'colour' | 'pattern'> })
  | (RuleBase & { type: 'match'; slots: [Role, Role]; on: 'leatherColour'; exempt?: Selector | Selector[] })
  | (RuleBase & { type: 'requires'; a: Selector; b: Selector })
  | (RuleBase & { type: 'limit'; what: 'patterns' | 'colours' | 'layers'; max: number })
  | (RuleBase & {
      type: 'palette'
      name: string
      colours: string[]
      applies?: Selector
      inside?: number
      outside?: number
    })
  | (RuleBase & { type: 'formality'; maxSpread: number; slots?: Role[] })
  | (RuleBase & { type: 'lightness'; lighter: Selector; darker: Selector; score: number; reversed: number })
  | (RuleBase & { type: 'adjust'; a: Selector; formality: number })
  | (RuleBase & { type: 'avoid'; a: Selector; score: number; occasions?: string[] })
  | (RuleBase & { type: 'occasion'; a: Selector; allowed: string[] })

export interface StyleRules {
  version: number
  credits: string
  scoring: { neutral: number; formalityCoherence: Record<string, number> }
  rules: StyleRule[]
}

function asList<T>(value: T | T[] | undefined): T[] | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value : [value]
}

export function matches(selector: Selector, item: EngineItem, palette: Palette): boolean {
  const role = asList(selector.role)
  if (role && !role.includes(item.role)) return false
  const category = asList(selector.category)
  if (category && !category.includes(item.category)) return false
  const subcategory = asList(selector.subcategory)
  if (subcategory && !subcategory.includes(item.subcategory)) return false
  const colour = asList(selector.colour)
  if (colour && !colour.includes(item.colourPrimary)) return false
  const family = asList(selector.family)
  if (family) {
    const f = familyOf(palette, item.colourPrimary)
    if (!f || !family.includes(f)) return false
  }
  if (selector.light !== undefined && isLight(palette, item.colourPrimary) !== selector.light) return false
  const pattern = asList(selector.pattern)
  if (pattern && !pattern.includes(item.pattern)) return false
  const material = asList(selector.material)
  if (material && !material.includes(item.material)) return false
  return true
}

/** Item formality after the deck's adjustments (dark jeans +0.5, prints -1, ...). */
export function effectiveFormality(item: EngineItem, rules: StyleRules, palette: Palette): number {
  let formality = item.formality
  for (const rule of rules.rules) {
    if (rule.type === 'adjust' && matches(rule.a, item, palette)) formality += rule.formality
  }
  return formality
}

const PATTERNED: Pattern[] = ['stripe', 'check', 'print']
const LAYER_ROLES: Role[] = ['base', 'layer', 'outer']

export interface HardCheck {
  ok: boolean
  violations: string[]
}

/**
 * Hard rules. `complete` is false while the beam search is still filling
 * slots, so rules that need a missing counterpart (requires) are deferred.
 */
export function checkHardRules(
  items: EngineItem[],
  rules: StyleRules,
  palette: Palette,
  occasionId: string,
  complete: boolean,
): HardCheck {
  const violations: string[] = []
  const formalities = new Map(items.map((i) => [i.id, effectiveFormality(i, rules, palette)]))

  for (const rule of rules.rules) {
    switch (rule.type) {
      case 'never': {
        for (let x = 0; x < items.length; x++) {
          for (let y = x + 1; y < items.length; y++) {
            const i = items[x]
            const j = items[y]
            const hit =
              (matches(rule.a, i, palette) && matches(rule.b, j, palette)) ||
              (matches(rule.a, j, palette) && matches(rule.b, i, palette))
            if (!hit) continue
            if (rule.same) {
              const sameColour = !rule.same.includes('colour') || i.colourPrimary === j.colourPrimary
              const samePattern = !rule.same.includes('pattern') || i.pattern === j.pattern
              if (!(sameColour && samePattern)) continue
            }
            violations.push(rule.id)
          }
        }
        break
      }
      case 'match': {
        const first = items.find((i) => i.role === rule.slots[0])
        const second = items.find((i) => i.role === rule.slots[1])
        if (!first || !second) break
        const exempts = rule.exempt ? (Array.isArray(rule.exempt) ? rule.exempt : [rule.exempt]) : []
        if (exempts.some((e) => matches(e, first, palette) || matches(e, second, palette))) break
        const a = leatherFamily(palette, first.colourPrimary)
        const b = leatherFamily(palette, second.colourPrimary)
        if (a && b && a !== b) violations.push(rule.id)
        break
      }
      case 'requires': {
        if (!complete) break
        const needs = items.some((i) => matches(rule.a, i, palette))
        if (needs && !items.some((i) => matches(rule.b, i, palette))) violations.push(rule.id)
        break
      }
      case 'limit': {
        let count = 0
        if (rule.what === 'patterns') count = items.filter((i) => PATTERNED.includes(i.pattern)).length
        else if (rule.what === 'layers') count = items.filter((i) => LAYER_ROLES.includes(i.role)).length
        else count = new Set(items.map((i) => i.colourPrimary)).size
        if (count > rule.max) violations.push(rule.id)
        break
      }
      case 'formality': {
        const scoped = rule.slots ? items.filter((i) => rule.slots!.includes(i.role)) : items
        if (scoped.length < 2) break
        const values = scoped.map((i) => formalities.get(i.id) ?? i.formality)
        if (Math.max(...values) - Math.min(...values) > rule.maxSpread) violations.push(rule.id)
        break
      }
      case 'occasion': {
        if (items.some((i) => matches(rule.a, i, palette)) && !rule.allowed.includes(occasionId)) {
          violations.push(rule.id)
        }
        break
      }
      default:
        break
    }
  }
  return { ok: violations.length === 0, violations }
}

export interface StyleScore {
  total: number
  pairs: number
  palette: number
  lightness: number
  avoid: number
  coherence: number
}

const WEIGHTS = { pairs: 0.5, palette: 0.15, lightness: 0.15, avoid: 0.1, coherence: 0.1 }

/** Soft style score in 0..1 (0.5 = the deck says nothing about this outfit). */
export function styleScore(
  items: EngineItem[],
  rules: StyleRules,
  palette: Palette,
  occasionId: string,
): StyleScore {
  const neutral = rules.scoring.neutral
  const pairRules = rules.rules.filter((r) => r.type === 'pair')
  const paletteRules = rules.rules.filter((r) => r.type === 'palette' && r.applies)
  const lightnessRules = rules.rules.filter((r) => r.type === 'lightness')
  const avoidRules = rules.rules.filter((r) => r.type === 'avoid')

  // Pairs, two channels: colour/type rules (best matching rule per pair) and
  // pattern-only rules. Pairs the deck says nothing about stay out of the mean.
  const isPatternRule = (r: Selector) => Object.keys(r).length === 1 && r.pattern !== undefined
  const typedScores: number[] = []
  const patternScores: number[] = []
  for (let x = 0; x < items.length; x++) {
    for (let y = x + 1; y < items.length; y++) {
      const i = items[x]
      const j = items[y]
      let bestTyped: number | null = null
      let bestPattern: number | null = null
      for (const rule of pairRules) {
        if (rule.type !== 'pair') continue
        const hit =
          (matches(rule.a, i, palette) && matches(rule.b, j, palette)) ||
          (matches(rule.a, j, palette) && matches(rule.b, i, palette))
        if (!hit) continue
        if (isPatternRule(rule.a) && isPatternRule(rule.b)) {
          if (bestPattern === null || rule.score > bestPattern) bestPattern = rule.score
        } else if (bestTyped === null || rule.score > bestTyped) bestTyped = rule.score
      }
      if (bestTyped !== null) typedScores.push(bestTyped)
      if (bestPattern !== null) patternScores.push(bestPattern)
    }
  }
  const pairsTyped = typedScores.length ? mean(typedScores) : neutral
  const pairsPattern = patternScores.length ? mean(patternScores) : neutral
  const pairs = 0.7 * pairsTyped + 0.3 * pairsPattern

  const paletteScores: number[] = []
  for (const item of items) {
    for (const rule of paletteRules) {
      if (rule.type !== 'palette' || !rule.applies) continue
      if (!matches(rule.applies, item, palette)) continue
      paletteScores.push(rule.colours.includes(item.colourPrimary) ? (rule.inside ?? 0.75) : (rule.outside ?? 0.4))
    }
  }
  const paletteScore = paletteScores.length ? mean(paletteScores) : neutral

  const lightnessScores: number[] = []
  for (const rule of lightnessRules) {
    if (rule.type !== 'lightness') continue
    const lighter = items.filter((i) => matches(rule.lighter, i, palette))
    const darker = items.filter((i) => matches(rule.darker, i, palette))
    for (const a of lighter) {
      for (const b of darker) {
        if (a.id === b.id) continue
        const diff = lightnessOf(palette, a.colourPrimary) - lightnessOf(palette, b.colourPrimary)
        lightnessScores.push(diff >= 5 ? rule.score : diff > -5 ? 0.6 : rule.reversed)
      }
    }
  }
  const lightness = lightnessScores.length ? mean(lightnessScores) : neutral

  let avoidPenalty = 0
  for (const item of items) {
    for (const rule of avoidRules) {
      if (rule.type !== 'avoid') continue
      if (rule.occasions?.includes(occasionId)) continue
      if (matches(rule.a, item, palette)) avoidPenalty = Math.max(avoidPenalty, 1 - rule.score)
    }
  }
  const avoid = 1 - avoidPenalty

  let coherence = 1
  if (items.length >= 2) {
    const values = items.map((i) => effectiveFormality(i, rules, palette))
    const spread = Math.max(...values) - Math.min(...values)
    const table = rules.scoring.formalityCoherence
    coherence = spread <= 1 ? (table.spread1 ?? 1) : spread <= 2 ? (table.spread2 ?? 0.6) : 0.3
  }

  const total =
    WEIGHTS.pairs * pairs +
    WEIGHTS.palette * paletteScore +
    WEIGHTS.lightness * lightness +
    WEIGHTS.avoid * avoid +
    WEIGHTS.coherence * coherence
  return { total, pairs, palette: paletteScore, lightness, avoid, coherence }
}

/** Single-item style components (used to pre-rank slot candidates). */
export function singleItemStyle(item: EngineItem, rules: StyleRules, palette: Palette, occasionId: string): number {
  const scores: number[] = []
  for (const rule of rules.rules) {
    if (rule.type === 'palette' && rule.applies && matches(rule.applies, item, palette)) {
      scores.push(rule.colours.includes(item.colourPrimary) ? (rule.inside ?? 0.75) : (rule.outside ?? 0.4))
    }
    if (rule.type === 'avoid' && !rule.occasions?.includes(occasionId) && matches(rule.a, item, palette)) {
      scores.push(rule.score)
    }
  }
  return scores.length ? mean(scores) : rules.scoring.neutral
}

export function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

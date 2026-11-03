import { rotationScores } from './fairness'
import { isDark, isLight, type Palette } from './palette'
import { checkHardRules, effectiveFormality, matches, mean, singleItemStyle, styleScore, type StyleRules } from './rules'
import { materialRainExcluded, type Taxonomy } from './taxonomy'
import { resolveTemplate, type TemplatesFile } from './templates'
import type {
  EngineItem,
  Occasion,
  OutfitProposal,
  Reason,
  RecommendContext,
  RecommendResult,
  Role,
  ScoreBreakdown,
  SlotTemplate,
  WeatherWindow,
} from './types'
import { allowedWarmth, type WeatherRules } from './weather'

export interface OccasionsFile {
  version: number
  occasions: Occasion[]
  weekdayDefaults: Record<string, string>
}

export interface EngineData {
  taxonomy: Taxonomy
  palette: Palette
  rules: StyleRules
  weatherRules: WeatherRules
  templates: TemplatesFile
  occasions: OccasionsFile
}

export interface RecommendOptions {
  beamWidth?: number
  perSlot?: number
  results?: number
}

/** Weights of the final ranking (the brief: style 40, rotation 35, recency 15, signals 10). */
export const WEIGHTS = { style: 0.4, rotation: 0.35, recency: 0.15, signals: 0.1 }

const SLOT_ORDER = ['bottoms', 'shoes', 'belt', 'base', 'layer', 'outer', 'tie', 'accessories']
const COLD_ACCESSORIES = ['beanie', 'scarf', 'gloves']

/** FNV-1a hash → [0, 1); deterministic tie-breaks seeded by the date. */
export function seededNoise(seed: string, id: string): number {
  let h = 0x811c9dc5
  const s = `${seed}|${id}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return (h % 100000) / 100000
}

function occasionRule<T>(occasion: Occasion, key: string): T | undefined {
  return occasion.rules[key] as T | undefined
}

function windowLengthHours(occasion: Occasion): number {
  const [s, e] = occasion.window.map((t) => {
    const [h, m] = t.split(':').map(Number)
    return h + (m ?? 0) / 60
  })
  return e > s ? e - s : 24 - s + e
}

/**
 * The day's slot template: the band's slots with the occasion's overrides and
 * the weather's hard changes (no layers in a heatwave; a water-resistant coat
 * and waterproof shoes when it rains in the cool and cold bands).
 */
export function dayTemplate(weather: WeatherWindow, occasion: Occasion, data: EngineData): SlotTemplate[] {
  let template = resolveTemplate(data.templates, weather.band, occasion.id)
  if (weather.band === 'heatwave') template = template.filter((s) => s.id !== 'layer' && s.id !== 'outer')
  const rain = weather.flags.includes('rain')
  if (rain && (weather.band === 'cool' || weather.band === 'cold')) {
    const outer = template.find((s) => s.id === 'outer')
    if (outer) {
      const waterResistant = data.weatherRules.sets.waterResistantOuter
      outer.required = true
      outer.accept = weather.band === 'cold' ? [...waterResistant, 'overcoat'] : waterResistant
    }
    if (weather.band === 'cold') {
      const shoes = template.find((s) => s.id === 'shoes')
      if (shoes) shoes.accept = data.weatherRules.sets.boots
    }
  }
  return template
}

/**
 * Hard eligibility of one item for a day: status, a slot in the day's
 * template, warmth band, formality range, rain exclusions, occasion rules.
 * Also used to count eligible days.
 */
export function isEligible(
  item: EngineItem,
  weather: WeatherWindow,
  occasion: Occasion,
  settings: Pick<RecommendContext['settings'], 'sneakersAtWork' | 'allowSuedeInRain'>,
  data: EngineData,
  template: SlotTemplate[] = dayTemplate(weather, occasion, data),
): boolean {
  if (item.status !== 'active') return false
  if (!template.some((slot) => slotAccepts(slot, item))) return false
  const [minWarmth, maxWarmth] = allowedWarmth(weather.band, data.weatherRules, weather.flags)
  const heatwave = weather.band === 'heatwave'
  const noWarmthCheck = item.role === 'belt' || item.role === 'accessory'
  if (!noWarmthCheck) {
    if (heatwave ? item.warmth > 1 : item.warmth < minWarmth || item.warmth > maxWarmth) return false
  }
  const formality = effectiveFormality(item, data.rules, data.palette)
  const [fMin, fMax] = occasion.formality
  if (formality < fMin - 1 || formality > fMax + 1) return false

  if (weather.flags.includes('rain')) {
    if (materialRainExcluded(data.taxonomy, item.material) && !(settings.allowSuedeInRain && item.material === 'suede')) return false
    if (item.subcategory === 'espadrilles') return false
    if (item.role === 'bottoms' && isLight(data.palette, item.colourPrimary)) return false
  }

  if (occasionRule<boolean>(occasion, 'noShorts') && item.subcategory === 'shorts') return false
  if (occasionRule<boolean>(occasion, 'noAthleticShoes') && item.subcategory === 'athletic') return false
  if (item.subcategory === 'sneakers') {
    if (occasionRule<boolean>(occasion, 'noSneakers')) return false
    if (occasionRule<string>(occasion, 'sneakersSetting') === 'sneakersAtWork' && !settings.sneakersAtWork) return false
  }
  if (occasionRule<boolean>(occasion, 'noCaps') && item.subcategory === 'cap') return false
  if (occasionRule<boolean>(occasion, 'leatherShoes') && item.role === 'shoes' && !['leather', 'suede'].includes(item.material)) return false

  // Weather-gated accessories.
  if (item.subcategory === 'sunglasses') {
    const daytime = occasion.window[0] < '19:00'
    if (!daytime || weather.flags.includes('overcast') || (weather.uvMax < 3 && !weather.flags.includes('sun'))) return false
  }
  if (COLD_ACCESSORIES.includes(item.subcategory) && !['cool', 'cold'].includes(weather.band)) return false

  // Single-item style rules bound to occasions (e.g. tracksuits only for gym/home).
  for (const rule of data.rules.rules) {
    if (rule.type === 'occasion' && matches(rule.a, item, data.palette) && !rule.allowed.includes(occasion.id)) return false
  }
  return true
}

function weatherSoft(item: EngineItem, weather: WeatherWindow, occasion: Occasion, data: EngineData): number {
  const sets = data.weatherRules.sets
  const palette = data.palette
  let score = 0
  const flags = weather.flags
  if (weather.band === 'heatwave' || weather.band === 'hot') {
    if (isLight(palette, item.colourPrimary) && item.role !== 'shoes') score += 0.1
    if (item.material === 'linen') score += 0.15
    if (item.material === 'cotton') score += 0.05
    if (item.subcategory === 'sunglasses') score += 0.1
    if (flags.includes('sun') && item.colourPrimary === 'black' && (item.role === 'base' || item.role === 'layer')) score -= 0.15
  }
  if (flags.includes('rain')) {
    if (sets.boots.includes(item.subcategory)) score += 0.15
    if (item.role === 'bottoms' && isDark(palette, item.colourPrimary)) score += 0.1
  }
  if (flags.includes('humidity')) {
    if (item.material === 'linen') score += 0.15
    if (item.material === 'cotton') score += 0.1
    if (item.material === 'knit') score += 0.05
    if (item.material === 'synthetic') score -= 0.15
    if (item.material === 'leather' && item.role === 'outer') score -= 0.15
    if (item.role === 'layer') score -= 0.1
  }
  if (flags.includes('sun')) {
    if (item.subcategory === 'sunglasses') score += 0.1
    if (sets.hats.includes(item.subcategory)) score += 0.1
  }
  if (flags.includes('wind')) {
    if (item.role === 'outer' && sets.windproofOuter.includes(item.subcategory)) score += 0.15
    if (sets.loose.includes(item.subcategory)) score -= 0.15
    if (item.material === 'linen' && item.role === 'base') score -= 0.1
  }
  if (flags.includes('spread') && windowLengthHours(occasion) >= 8 && sets.removableLayer.includes(item.subcategory)) score += 0.15
  if (item.role === 'layer') score += weather.band === 'cool' || weather.band === 'cold' ? 0.1 : weather.band === 'mild' ? 0.05 : 0
  if (occasionRule<boolean>(occasion, 'darkPalette') && item.role !== 'belt') {
    if (isDark(palette, item.colourPrimary)) score += 0.05
    else if (isLight(palette, item.colourPrimary) && item.role !== 'base') score -= 0.05
  }
  if (occasionRule<boolean>(occasion, 'comfortableShoes') && item.role === 'shoes' && ['sneakers', 'loafers', 'chelsea-boots', 'chukka-boots'].includes(item.subcategory)) score += 0.05
  if (occasionRule<boolean>(occasion, 'layersPreferred') && item.role === 'layer') score += 0.05
  return score
}

function recencyScore(item: EngineItem, ctx: RecommendContext): number {
  const daysAgo = ctx.wornRecently.get(item.id)
  if (daysAgo === undefined) return 1
  const base = daysAgo <= 1 ? 0.1 : daysAgo <= 2 ? 0.4 : 1
  if (item.role === 'shoes' || item.role === 'outer') return Math.max(0.6, base)
  return base
}

function signalScore(item: EngineItem, ctx: RecommendContext): number {
  let s = 0.5
  if (item.favourite) s += occasionRule<boolean>(ctx.occasion, 'favouritesBoost') ? 0.5 : 0.25
  if (ctx.signals.liked.has(item.id)) s += 0.2
  if (ctx.signals.disliked.has(item.id)) s -= 0.4
  return Math.min(1, Math.max(0, s))
}

interface Candidate {
  item: EngineItem
  rotation: number
  recency: number
  signals: number
  weather: number
  single: number
  noise: number
}

interface BeamState {
  slots: Record<string, string>
  items: EngineItem[]
  score: ScoreBreakdown
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function expandSlots(template: SlotTemplate[]): SlotTemplate[] {
  const out: SlotTemplate[] = []
  for (const slot of template) {
    if (slot.id === 'accessories') {
      const n = slot.max ?? 2
      for (let i = 1; i <= n; i++) out.push({ id: `accessory-${i}`, accept: slot.accept, required: false })
    } else out.push(slot)
  }
  return out.sort((a, b) => orderOf(a.id) - orderOf(b.id))
}

function orderOf(slotId: string): number {
  const base = slotId.startsWith('accessory-') ? 'accessories' : slotId
  const index = SLOT_ORDER.indexOf(base)
  return (index === -1 ? SLOT_ORDER.length : index) * 10 + (slotId.startsWith('accessory-') ? Number(slotId.split('-')[1]) : 0)
}

function slotAccepts(slot: SlotTemplate, item: EngineItem): boolean {
  return slot.accept.includes(item.role) || slot.accept.includes(item.subcategory)
}

function scoreState(items: EngineItem[], candidates: Map<string, Candidate>, ctx: RecommendContext, data: EngineData): ScoreBreakdown {
  const cs = items.map((i) => candidates.get(i.id)!)
  const style = styleScore(items, data.rules, data.palette, ctx.occasion.id).total
  // Fairness adds up per item instead of averaging away: each item moves the
  // outfit by (score - 0.5) / 4, so one over-worn piece costs as much as a
  // clear style difference, and two cost twice as much.
  const rotation = Math.min(1, Math.max(0, 0.5 + cs.reduce((a, c) => a + (c.rotation - 0.5), 0) / 4))
  const recency = mean(cs.map((c) => c.recency))
  const signals = mean(cs.map((c) => c.signals))
  const weather = mean(cs.map((c) => c.weather))
  let total = WEIGHTS.style * style + WEIGHTS.rotation * rotation + WEIGHTS.recency * recency + WEIGHTS.signals * signals + weather
  // A suit worn as the set it is gets a small bonus.
  const sets = new Map<string, number>()
  for (const i of items) if (i.setId) sets.set(i.setId, (sets.get(i.setId) ?? 0) + 1)
  for (const n of sets.values()) if (n >= 2) total += 0.05
  // Steer the beam towards the occasion's formality range (the final check is hard).
  const f = meanFormality(items, data)
  const [fMin, fMax] = ctx.occasion.formality
  const distance = f < fMin ? fMin - f : f > fMax ? f - fMax : 0
  total -= 0.3 * distance
  return { style, rotation, recency, signals, weather, total }
}

function meanFormality(items: EngineItem[], data: EngineData): number {
  const main = items.filter((i) => i.role !== 'accessory' && i.role !== 'belt')
  const scoped = main.length ? main : items
  return mean(scoped.map((i) => effectiveFormality(i, data.rules, data.palette)))
}

function sameOutfit(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

/**
 * The engine: filter → template → score → assemble (beam search) → explain.
 * Pure: same context, same result.
 */
export function recommend(ctx: RecommendContext, data: EngineData, options: RecommendOptions = {}): RecommendResult {
  const beamWidth = options.beamWidth ?? 12
  const perSlot = options.perSlot ?? 8
  const results = options.results ?? 6
  const { weather, occasion, settings, signals } = ctx

  // 1. Filter. Fairness peers are the items eligible today, by role.
  const template = dayTemplate(weather, occasion, data)
  const relaxed: Reason[] = []
  for (const slot of template) {
    const restricted = (slot.id === 'outer' && !slot.accept.includes('outer')) || (slot.id === 'shoes' && !slot.accept.includes('shoes'))
    if (!restricted) continue
    const anyFits = ctx.items.some((i) => i.status === 'active' && !signals.excluded.has(i.id) && slotAccepts(slot, i))
    if (anyFits) continue
    slot.accept = [slot.id]
    relaxed.push({ key: slot.id === 'outer' ? 'reason.noWaterproofOuter' : 'reason.noWaterproofShoes' })
  }
  const eligible = ctx.items.filter((i) => !signals.excluded.has(i.id) && isEligible(i, weather, occasion, settings, data, template))
  const rotation = rotationScores(eligible, settings, ctx.date)
  const candidates = new Map<string, Candidate>()
  for (const item of eligible) {
    const rot = rotation.get(item.id)?.score ?? 0.5
    const rec = recencyScore(item, ctx)
    const sig = signalScore(item, ctx)
    const wea = weatherSoft(item, weather, occasion, data)
    const sty = singleItemStyle(item, data.rules, data.palette, occasion.id)
    const single = WEIGHTS.style * sty + WEIGHTS.rotation * rot + WEIGHTS.recency * rec + WEIGHTS.signals * sig + wea
    candidates.set(item.id, { item, rotation: rot, recency: rec, signals: sig, weather: wea, single, noise: seededNoise(settings.seed, item.id) })
  }

  // 2. Slots (accessories expanded to two optional slots).
  const slots = expandSlots(template)

  // 3. Candidates per slot, pre-ranked by their single-item score.
  const lockedItems = ctx.items.filter((i) => signals.locked.has(i.id))
  const slotCandidates = new Map<string, Candidate[]>()
  for (const slot of slots) {
    const locked = lockedItems.find((i) => slotAccepts(slot, i) && candidates.has(i.id))
    let list = eligible.filter((i) => slotAccepts(slot, i)).map((i) => candidates.get(i.id)!)
    if (locked) list = [candidates.get(locked.id)!]
    list.sort((a, b) => b.single - a.single || a.noise - b.noise)
    slotCandidates.set(slot.id, list.slice(0, locked ? 1 : perSlot + (slot.id === 'accessory-1' || slot.id === 'accessory-2' ? 2 : 0)))
  }

  // 4. Beam search over slots.
  const relaxedSlots = new Set<string>()
  const extend = (states: BeamState[], slot: SlotTemplate, choices: Candidate[], keepEmpty: boolean): BeamState[] => {
    const next: BeamState[] = []
    for (const state of states) {
      if (keepEmpty) next.push(state)
      for (const candidate of choices) {
        const item = candidate.item
        if (state.items.some((i) => i.id === item.id)) continue
        if (state.items.some((i) => signals.neverTogether.has(pairKey(i.id, item.id)))) continue
        if (slot.id.startsWith('accessory-') && state.items.some((i) => i.role === 'accessory' && i.subcategory === item.subcategory)) continue
        const items = [...state.items, item]
        if (!checkHardRules(items, data.rules, data.palette, occasion.id, false).ok) continue
        next.push({ slots: { ...state.slots, [slot.id]: item.id }, items, score: scoreState(items, candidates, ctx, data) })
      }
    }
    return next
  }
  let beam: BeamState[] = [{ slots: {}, items: [], score: { style: 0, rotation: 0, recency: 0, signals: 0, weather: 0, total: 0 } }]
  for (const [index, slot] of slots.entries()) {
    const choices = slotCandidates.get(slot.id) ?? []
    const lockedHere = choices.length === 1 && lockedItems.some((i) => i.id === choices[0].item.id)
    let next = extend(beam, slot, choices, !slot.required && !lockedHere)
    if (slot.required && next.length === 0) {
      // The pre-ranked candidates were all incompatible with the beam: try every eligible item.
      const all = eligible.filter((i) => slotAccepts(slot, i)).map((i) => candidates.get(i.id)!)
      next = extend(beam, slot, all, false)
      if (next.length === 0) {
        relaxedSlots.add(slot.id)
        relaxed.push({ key: 'reason.slotRelaxed', params: { slot: slot.id } })
        next = beam
      }
    }
    next.sort((a, b) => b.score.total - a.score.total || tieBreak(a, b, candidates))
    const width = index === slots.length - 1 ? Math.max(beamWidth, results * 5) : beamWidth
    beam = dedupe(next).slice(0, width)
  }

  // 5. Completeness and final ranking.
  const requiredSlots = slots.filter((s) => s.required && !relaxedSlots.has(s.id)).map((s) => s.id)
  const [fMin, fMax] = occasion.formality
  const isComplete = (state: BeamState, tolerance: number): boolean => {
    if (!requiredSlots.every((id) => state.slots[id])) return false
    if (!checkHardRules(state.items, data.rules, data.palette, occasion.id, true).ok) return false
    const suitTrousers = state.items.find((i) => i.subcategory === 'suit-trousers')
    if (suitTrousers && !state.items.some((i) => i.setId && i.setId === suitTrousers.setId && i.role === 'outer')) return false
    if (occasionRule<boolean>(occasion, 'requireSuit')) {
      const outer = state.items.find((i) => i.role === 'outer')
      if (!outer || outer.subcategory !== 'suit-jacket') return false
    }
    const f = meanFormality(state.items, data)
    if (f < fMin - tolerance || f > fMax + tolerance) return false
    const ids = state.items.map((i) => i.id)
    if (ctx.recentOutfits.some((past) => sameOutfit(past, ids))) return false
    return true
  }
  let finals = beam.filter((state) => isComplete(state, 0.5))
  if (finals.length === 0) {
    finals = beam.filter((state) => isComplete(state, 1))
    if (finals.length) relaxed.push({ key: 'reason.formalityRelaxed' })
  }

  // An outfit needs a top, bottoms and shoes; a relaxed slot without a single
  // candidate means the wardrobe cannot dress this day.
  const CORE = ['base', 'bottoms', 'shoes']
  const missingCore = CORE.filter((s) => slots.some((slot) => slot.id === s) && !finals.some((state) => state.slots[s]))
  if (finals.length === 0 || missingCore.length > 0) {
    if (eligible.length === 0) return { outfits: [], reason: { key: 'reason.nothingEligible' } }
    if (missingCore.length > 0) return { outfits: [], reason: { key: 'reason.missingSlots', params: { slots: missingCore.join(',') } } }
    return { outfits: [], reason: { key: 'reason.noCombination' } }
  }

  // Diversity: alternatives differ from every earlier result in a main slot
  // (top, bottoms or shoes); if that leaves gaps, any different outfit will do.
  const MAIN = ['base', 'bottoms', 'shoes']
  const differsInMain = (a: BeamState, b: BeamState) => MAIN.some((s) => a.slots[s] !== b.slots[s])
  const chosen: BeamState[] = []
  for (const state of finals) {
    if (chosen.length === 0 || chosen.every((c) => differsInMain(c, state))) chosen.push(state)
    if (chosen.length >= results) break
  }
  if (chosen.length < results) {
    for (const state of finals) {
      if (chosen.includes(state)) continue
      if (chosen.some((c) => sameOutfit(c.items.map((i) => i.id), state.items.map((i) => i.id)))) continue
      chosen.push(state)
      if (chosen.length >= results) break
    }
  }

  const outfits: OutfitProposal[] = chosen.map((state) => ({
    slots: state.slots,
    itemIds: state.items.map((i) => i.id),
    score: state.score,
    reasons: explain(state, ctx, rotation, relaxed),
  }))
  return { outfits }
}

function tieBreak(a: BeamState, b: BeamState, candidates: Map<string, Candidate>): number {
  const na = mean(a.items.map((i) => candidates.get(i.id)!.noise))
  const nb = mean(b.items.map((i) => candidates.get(i.id)!.noise))
  return na - nb
}

function dedupe(states: BeamState[]): BeamState[] {
  const seen = new Set<string>()
  const out: BeamState[] = []
  for (const s of states) {
    const key = s.items.map((i) => i.id).sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

function explain(
  state: BeamState,
  ctx: RecommendContext,
  rotation: ReturnType<typeof rotationScores>,
  relaxed: Reason[],
): Reason[] {
  const reasons: Reason[] = []
  const w = ctx.weather
  reasons.push({
    key: 'reason.weather',
    params: { band: w.band, min: Math.round(w.apparentMin), max: Math.round(w.apparentMax), rain: Math.round(w.rainProbabilityMax) },
  })
  if (w.flags.includes('rain')) {
    const shoes = state.items.find((i) => i.role === 'shoes')
    const outer = state.items.find((i) => i.role === 'outer')
    reasons.push({ key: 'reason.rain', params: { shoes: shoes?.id ?? '', outer: outer?.id ?? '' } })
  }
  if (w.flags.includes('sun') && state.items.some((i) => i.subcategory === 'sunglasses')) reasons.push({ key: 'reason.sun' })
  if (w.flags.includes('wind') && state.items.some((i) => i.role === 'outer')) reasons.push({ key: 'reason.wind' })
  // The most under-worn item in the outfit, if it has been waiting.
  let best: { item: EngineItem; score: number } | null = null
  for (const item of state.items) {
    const r = rotation.get(item.id)
    if (!r) continue
    if (!best || r.score > best.score) best = { item, score: r.score }
  }
  if (best && best.score > 0.6) {
    const days = best.item.lastWorn ? daysBetween(best.item.lastWorn, ctx.date) : null
    reasons.push({ key: days === null ? 'reason.neverWorn' : 'reason.rotation', params: { item: best.item.id, days: days ?? 0 } })
  }
  for (const r of relaxed) reasons.push(r)
  return reasons
}

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  return Math.round((b - a) / 86400000)
}

/** Roles a slot id maps to (for the UI's swap action). */
export function roleForSlot(slotId: string): Role {
  if (slotId.startsWith('accessory-') || slotId === 'tie') return 'accessory'
  return slotId as Role
}

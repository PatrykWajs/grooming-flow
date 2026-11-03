/**
 * Deterministic fixture wardrobes and weather for tests and the simulation.
 * Labelled fixture data: nothing here describes a real wardrobe.
 */
import { seasonsForWarmth, type Taxonomy } from './taxonomy'
import type { EngineItem, HourlyWeather, Material, Pattern, Role } from './types'

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T,>(rng: () => number, list: T[]): T => list[Math.floor(rng() * list.length)]

const COLOURS: Record<Role, string[]> = {
  base: ['white', 'white', 'light-blue', 'pink', 'light-grey', 'blue', 'navy', 'black', 'cream', 'dark-green', 'burgundy'],
  layer: ['navy', 'grey', 'charcoal', 'dark-green', 'beige', 'burgundy', 'black', 'cream'],
  outer: ['navy', 'charcoal', 'black', 'tan', 'beige', 'olive', 'grey', 'dark-brown'],
  bottoms: ['navy', 'denim', 'grey', 'charcoal', 'black', 'beige', 'blue', 'olive', 'light-blue'],
  shoes: ['black', 'brown', 'tan', 'white', 'dark-brown', 'navy', 'burgundy'],
  belt: ['black', 'brown', 'dark-brown', 'tan'],
  accessory: ['black', 'brown', 'navy', 'grey', 'burgundy', 'tan'],
  set: ['navy', 'charcoal', 'black'],
}

const MATERIALS: Record<string, Material[]> = {
  't-shirt': ['cotton'],
  polo: ['cotton'],
  'casual-shirt': ['cotton', 'linen'],
  'dress-shirt': ['cotton'],
  henley: ['cotton'],
  sweater: ['knit', 'wool'],
  cardigan: ['knit'],
  hoodie: ['cotton'],
  vest: ['synthetic'],
  jeans: ['denim'],
  chinos: ['cotton'],
  'dress-trousers': ['wool', 'cotton'],
  'suit-trousers': ['wool'],
  shorts: ['cotton', 'linen'],
  joggers: ['cotton'],
  cargo: ['cotton'],
  sneakers: ['leather', 'canvas'],
  athletic: ['synthetic'],
  loafers: ['leather', 'suede'],
  'chelsea-boots': ['leather', 'suede'],
  'chukka-boots': ['suede', 'leather'],
  'work-boots': ['leather'],
  'derbies-oxfords': ['leather'],
  sandals: ['leather'],
  espadrilles: ['canvas'],
  'leather-dress': ['leather'],
  'leather-casual': ['leather'],
  woven: ['other'],
  canvas: ['canvas'],
  blazer: ['wool', 'cotton'],
  'suit-jacket': ['wool'],
  overshirt: ['cotton'],
  'denim-jacket': ['denim'],
  'leather-jacket': ['leather'],
  bomber: ['synthetic'],
  'field-jacket': ['cotton'],
  overcoat: ['wool'],
  puffer: ['synthetic'],
  parka: ['synthetic'],
  trench: ['cotton'],
}

/** Subcategory mix for a realistic rotator wardrobe (weights sum roughly to 100). */
const MIX: [string, number][] = [
  ['t-shirt', 12],
  ['polo', 4],
  ['casual-shirt', 9],
  ['dress-shirt', 5],
  ['henley', 2],
  ['sweater', 6],
  ['cardigan', 2],
  ['hoodie', 3],
  ['jeans', 5],
  ['chinos', 6],
  ['dress-trousers', 3],
  ['shorts', 3],
  ['joggers', 2],
  ['sneakers', 4],
  ['athletic', 1],
  ['loafers', 2],
  ['chelsea-boots', 2],
  ['chukka-boots', 1],
  ['derbies-oxfords', 2],
  ['blazer', 2],
  ['overshirt', 2],
  ['denim-jacket', 1],
  ['bomber', 1],
  ['overcoat', 1],
  ['puffer', 1],
  ['trench', 1],
  ['leather-dress', 2],
  ['leather-casual', 2],
  ['woven', 1],
  ['watch-dress', 1],
  ['watch-sport', 1],
  ['sunglasses', 2],
  ['cap', 1],
  ['beanie', 1],
  ['scarf', 1],
  ['bag', 1],
  ['bracelet-ring', 1],
]

export function makeFixtureWardrobe(taxonomy: Taxonomy, count: number, seed = 42, addedAt = '2026-01-01'): EngineItem[] {
  const rng = mulberry32(seed)
  const subs = new Map(taxonomy.categories.flatMap((c) => c.subcategories.map((s) => [s.id, { ...s, category: c.id }] as const)))
  const weighted: string[] = []
  for (const [id, w] of MIX) for (let i = 0; i < w; i++) weighted.push(id)
  const items: EngineItem[] = []
  for (let n = 0; n < count; n++) {
    const subId = weighted[n % weighted.length]
    const sub = subs.get(subId)!
    const role = sub.role
    const material = pick(rng, MATERIALS[subId] ?? ['other'])
    const materialWarmth = taxonomy.materials.find((m) => m.id === material)?.warmth ?? 0
    const warmth = role === 'belt' || role === 'accessory' ? sub.warmth : Math.min(5, Math.max(1, sub.warmth + materialWarmth + (rng() < 0.3 ? 1 : 0) - (rng() < 0.3 ? 1 : 0)))
    const pattern: Pattern = rng() < 0.72 ? 'solid' : pick(rng, ['stripe', 'check', 'print', 'texture'] as Pattern[])
    const colour = pick(rng, COLOURS[role])
    items.push({
      id: `fx-${n + 1}-${subId}`,
      category: sub.category,
      subcategory: subId,
      role,
      colourPrimary: colour,
      colourSecondary: null,
      pattern,
      material,
      warmth,
      formality: sub.formality,
      seasons: seasonsForWarmth(warmth),
      status: 'active',
      favourite: rng() < 0.1,
      setId: null,
      wearCount: 0,
      lastWorn: null,
      eligibleDays: 0,
      addedAt,
    })
  }
  return items
}

/** 24 hours of weather for a date from a daily profile. */
export function makeDay(
  date: string,
  profile: { low: number; high: number; rain?: number; rainMm?: number; humidity?: number; uv?: number; wind?: number; cloud?: number; sunshine?: number },
): HourlyWeather[] {
  const hours: HourlyWeather[] = []
  for (let h = 0; h < 24; h++) {
    // Minimum near 05:00, maximum near 15:00.
    const phase = Math.cos(((h - 15) / 24) * 2 * Math.PI)
    const temperature = profile.low + (profile.high - profile.low) * (phase + 1) / 2
    hours.push({
      time: `${date}T${String(h).padStart(2, '0')}:00`,
      temperature,
      apparent: temperature,
      humidity: profile.humidity ?? 50,
      precipitationProbability: profile.rain ?? 0,
      precipitation: (profile.rainMm ?? 0) / 24,
      cloudCover: profile.cloud ?? 30,
      uvIndex: h >= 10 && h <= 16 ? (profile.uv ?? 3) : 0,
      windSpeed: profile.wind ?? 10,
      weatherCode: profile.rain && profile.rain >= 40 ? 61 : 1,
      sunshine: h >= 8 && h <= 18 ? (profile.sunshine ?? 0.6) * 3600 : 0,
    })
  }
  return hours
}

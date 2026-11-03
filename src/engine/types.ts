/**
 * Engine types. The engine is a pure function of these inputs; nothing here
 * touches the DOM, the database or the network.
 */

export type CategoryId =
  | 'tops'
  | 'outerwear'
  | 'bottoms'
  | 'shoes'
  | 'belts'
  | 'accessories'
  | 'sets'

export type Role = 'base' | 'layer' | 'outer' | 'bottoms' | 'shoes' | 'belt' | 'accessory' | 'set'

export type Pattern = 'solid' | 'stripe' | 'check' | 'print' | 'texture'

export type Material =
  | 'cotton'
  | 'wool'
  | 'linen'
  | 'denim'
  | 'leather'
  | 'suede'
  | 'synthetic'
  | 'knit'
  | 'canvas'
  | 'other'

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export type ItemStatus = 'active' | 'wash' | 'stored' | 'retired'

export type BandId = 'heatwave' | 'hot' | 'warm' | 'mild' | 'cool' | 'cold'

export type WeatherFlag = 'rain' | 'humidity' | 'sun' | 'wind' | 'overcast' | 'spread'

/** The engine's view of a wardrobe item (a subset of the stored record). */
export interface EngineItem {
  id: string
  category: CategoryId
  subcategory: string
  role: Role
  colourPrimary: string
  colourSecondary?: string | null
  pattern: Pattern
  material: Material
  /** 1 summer .. 5 deep winter */
  warmth: number
  /** 1 athletic .. 5 formal */
  formality: number
  seasons: Season[]
  status: ItemStatus
  favourite: boolean
  /** Items of a set (suit) share a setId; the engine keeps them together. */
  setId?: string | null
  wearCount: number
  /** ISO date (YYYY-MM-DD) of the last confirmed wear, or null. */
  lastWorn: string | null
  /** Confirmed days on which the item was eligible since it was added. */
  eligibleDays: number
  /** ISO date the item was added. */
  addedAt: string
  /** Pinned "wear more" multiplier on expected wears (default 1). */
  wearMore?: number
}

export interface HourlyWeather {
  /** ISO local time of the hour. */
  time: string
  temperature: number
  apparent: number
  humidity: number
  precipitationProbability: number
  precipitation: number
  cloudCover: number
  uvIndex: number
  windSpeed: number
  weatherCode: number
  /** Seconds of sunshine in the hour (0..3600). */
  sunshine: number
}

/** Weather summarised over the occasion's time window. */
export interface WeatherWindow {
  band: BandId
  flags: WeatherFlag[]
  apparentMin: number
  apparentMax: number
  apparentMean: number
  rainProbabilityMax: number
  rainAmount: number
  humidityMean: number
  uvMax: number
  sunshineHours: number
  windMax: number
  cloudMean: number
  /** True when the window had no forecast (engine runs on the band only). */
  estimated: boolean
}

export interface Occasion {
  id: string
  en: string
  el: string
  window: [string, string]
  formality: [number, number]
  rules: Record<string, unknown>
  userSetHour?: boolean
}

export interface UserSignals {
  /** Item ids the user marked thumbs up on in past outfits. */
  liked: Set<string>
  /** Item ids from outfits the user gave thumbs down. */
  disliked: Set<string>
  /** Pairs of item ids that must never appear together ("a|b", sorted). */
  neverTogether: Set<string>
  /** Item ids locked into today's outfit. */
  locked: Set<string>
  /** Item ids that must not be proposed today (the user swapped them out). */
  excluded: Set<string>
}

export interface RecommendSettings {
  /** -3..+3: shifts every band threshold (runs hot = positive). */
  runsHotCold: number
  sneakersAtWork: boolean
  allowSuedeInRain: boolean
  /** Per-role cooldown in days (worn yesterday → rotation score). */
  cooldownDays: Record<string, number>
  /** Rotation score an item gets when inside its cooldown. */
  cooldownScore: Record<string, number>
  /** Outfits proposed or worn in the last N days are not repeated. */
  noRepeatDays: number
  /** Deterministic tie-break seed (the date). */
  seed: string
}

export interface RecommendContext {
  date: string
  items: EngineItem[]
  weather: WeatherWindow
  occasion: Occasion
  signals: UserSignals
  settings: RecommendSettings
  /** Item-id sets of outfits worn in the no-repeat window. */
  recentOutfits: string[][]
  /** Item ids worn in the last two days (recency penalty). */
  wornRecently: Map<string, number>
}

export interface ScoreBreakdown {
  style: number
  rotation: number
  recency: number
  signals: number
  weather: number
  total: number
}

export interface OutfitProposal {
  /** slot id → item id */
  slots: Record<string, string>
  itemIds: string[]
  score: ScoreBreakdown
  /** Reason fragments the UI turns into one line (i18n keys + params). */
  reasons: Reason[]
}

export interface Reason {
  key: string
  params?: Record<string, string | number>
}

export type SlotTemplate = {
  id: string
  accept: string[]
  required: boolean
  max?: number
}

export interface RecommendResult {
  outfits: OutfitProposal[]
  /** Why nothing could be assembled, when `outfits` is empty. */
  reason?: Reason
}

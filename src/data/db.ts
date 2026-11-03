import Dexie, { type EntityTable } from 'dexie'
import type { ColourResult } from '../ai/image'
import type { Prediction } from '../ai/protocol'
import type { CategoryId, HourlyWeather, ItemStatus, Material, Pattern, Season, WeatherWindow } from '../engine/types'

export const DB_NAME = 'groomingflow-db'
/**
 * v1: one day plan per date. v2: moments (any number of outfits per day, each
 * with its own occasion and hours). v3: the old table dropped. v4: intake
 * (the add queue, so a reload never loses a photo batch).
 */
export const SCHEMA_VERSION = 4

export interface ItemRecord {
  id: string
  category: CategoryId
  subcategory: string
  colourPrimary: string
  colourSecondary: string | null
  pattern: Pattern
  material: Material
  warmth: number
  formality: number
  seasons: Season[]
  status: ItemStatus
  favourite: boolean
  brand: string
  notes: string
  photoBlobId: string | null
  thumbBlobId: string | null
  phash: string | null
  /** Image embedding from the classifier (float32 values), for the personal kNN and duplicates. */
  embedding: number[] | null
  /** Fields the user set by hand; never overwritten by a later model run. */
  userEdited: string[]
  setId: string | null
  addedAt: string
  wearCount: number
  lastWorn: string | null
  eligibleDays: number
  wearsSinceWash: number
  wearMore: number
}

/** The fields the user reviews on a card before an item is saved. */
export interface ItemFields {
  category: CategoryId
  subcategory: string
  colourPrimary: string
  colourSecondary: string | null
  pattern: Pattern
  material: Material
  warmth: number
  formality: number
  brand: string
  notes: string
}

/**
 * A photo in the add pipeline, kept from the moment it is picked until the
 * user confirms or discards it, so a reload (a crash, the camera on iPhone, a
 * pull-to-refresh) resumes where it left off instead of losing the batch.
 */
export interface IntakeRecord {
  id: string
  createdAt: string
  status: 'queued' | 'ready' | 'error'
  /** The picked file until it is processed, then null (the cutout replaces it). */
  source: Blob | null
  name: string
  photo: Blob | null
  thumb: Blob | null
  prediction: Prediction | null
  colour: ColourResult | null
  phash: string | null
  embedding: number[] | null
  fields: ItemFields | null
  userEdited: string[]
  duplicateOfId: string | null
  error: string | null
}

export type OutfitSource = 'today' | 'plan' | 'manual' | 'archive'

export interface OutfitRecord {
  id: string
  itemIds: string[]
  slots: Record<string, string>
  reason: string
  score: number
  createdAt: string
  source: OutfitSource
}

/**
 * One outfit occasion on one day: "office 08:00–18:00", "dinner 20:00–23:00",
 * "right now". A day holds any number of them; each gets its own weather
 * window, suggestion, plan and check-in.
 */
export interface MomentRecord {
  id: string
  /** YYYY-MM-DD */
  date: string
  occasionId: string
  /** Local 'HH:MM'; null means the occasion's default window. An end at or before the start crosses midnight. */
  start: string | null
  end: string | null
  createdAt: string
  /** Who made it: the user, or the plan-ahead action (so "clear the plan" knows what to remove). */
  createdBy: 'user' | 'planner'
  weatherSnapshot: WeatherWindow | null
  /** Outfit kept for this moment before it is worn (plan ahead, or "keep this"). */
  plannedOutfitId: string | null
  confirmedOutfitId: string | null
  lockedItemIds: string[]
  rating: 'up' | 'down' | null
  note: string
  confirmedAt: string | null
  /**
   * Items whose eligible-day counter this confirmation incremented (an item is
   * counted once per day however many moments it was eligible for). null on
   * records migrated from v1, where every item was counted.
   */
  eligibleItemIds: string[] | null
}

/** The v1 day record, kept for the schema migration and for restoring v1 backups. */
export interface LegacyDayPlanRecord {
  date: string
  occasionId: string
  weatherSnapshot: WeatherWindow | null
  plannedOutfitId: string | null
  confirmedOutfitId: string | null
  locked: boolean
  lockedItemIds: string[]
  rating: 'up' | 'down' | null
  note: string
  confirmedAt: string | null
}

export function momentFromDayPlan(plan: LegacyDayPlanRecord): MomentRecord {
  return {
    id: `day-${plan.date}`,
    date: plan.date,
    occasionId: plan.occasionId,
    start: null,
    end: null,
    createdAt: plan.confirmedAt ?? `${plan.date}T00:00:00.000Z`,
    createdBy: 'user',
    weatherSnapshot: plan.weatherSnapshot ?? null,
    plannedOutfitId: plan.plannedOutfitId ?? null,
    confirmedOutfitId: plan.confirmedOutfitId ?? null,
    lockedItemIds: plan.lockedItemIds ?? [],
    rating: plan.rating ?? null,
    note: plan.note ?? '',
    confirmedAt: plan.confirmedAt ?? null,
    eligibleItemIds: null,
  }
}

export interface WearEntryRecord {
  id: string
  itemId: string
  date: string
  outfitId: string
}

export interface OccasionRecord {
  id: string
  en: string
  el: string
  window: [string, string]
  formality: [number, number]
  rules: Record<string, unknown>
  userSetHour?: boolean
  isDefault: boolean
}

export type Theme = 'auto' | 'light' | 'dark'

export interface SettingsRecord {
  id: 'settings'
  onboarded: boolean
  locationName: string
  lat: number | null
  lon: number | null
  tempUnit: 'C' | 'F'
  runsHotCold: number
  /** Weekday (0 Sunday … 6 Saturday) → occasion id; '' means "decide on the day". */
  weekdayDefaults: Record<string, string>
  /** Days the plan-ahead sheet last planned (remembered for next time). */
  planDays: number
  cooldownDays: Record<string, number>
  washDefaults: Record<string, number>
  occasionWindows: Record<string, [string, string]>
  language: 'el' | 'en' | 'auto'
  theme: Theme
  bgRemoval: boolean
  sneakersAtWork: boolean
  allowSuedeInRain: boolean
  lastBackupAt: string | null
  itemsSinceBackup: number
  persistGranted: boolean | null
}

export type PreferenceType = 'like' | 'dislike' | 'never-together' | 'wear-more'

export interface PreferenceRecord {
  id: string
  type: PreferenceType
  itemIds: string[]
  outfitId: string | null
  createdAt: string
}

export interface BlobRecord {
  id: string
  mime: string
  bytes: Blob
}

export interface WeatherCacheRecord {
  /** `${lat},${lon}` rounded to 2 decimals. */
  key: string
  fetchedAt: string
  providerId: string
  timezone: string
  hourly: HourlyWeather[]
  daily: DailyRecord[]
}

export interface DailyRecord {
  date: string
  sunrise: string
  sunset: string
  uvMax: number
  sunshineHours: number
  apparentMax: number
  apparentMin: number
  precipitationProbabilityMax: number
  precipitationSum: number
}

export class GroomingDB extends Dexie {
  items!: EntityTable<ItemRecord, 'id'>
  outfits!: EntityTable<OutfitRecord, 'id'>
  moments!: EntityTable<MomentRecord, 'id'>
  wearEntries!: EntityTable<WearEntryRecord, 'id'>
  occasions!: EntityTable<OccasionRecord, 'id'>
  settings!: EntityTable<SettingsRecord, 'id'>
  preferences!: EntityTable<PreferenceRecord, 'id'>
  blobs!: EntityTable<BlobRecord, 'id'>
  weather!: EntityTable<WeatherCacheRecord, 'key'>
  intake!: EntityTable<IntakeRecord, 'id'>

  constructor(name = DB_NAME) {
    super(name)
    this.version(1).stores({
      items: 'id, category, subcategory, status, addedAt, lastWorn, setId',
      outfits: 'id, createdAt, source',
      dayPlans: 'date, confirmedOutfitId',
      wearEntries: 'id, itemId, date, outfitId, [itemId+date]',
      occasions: 'id',
      settings: 'id',
      preferences: 'id, type',
      blobs: 'id',
      weather: 'key',
    })
    // v2 adds moments and copies every v1 day into one; v3 drops the old table
    // (Dexie: migrate in one version, delete in the next).
    this.version(2)
      .stores({ moments: 'id, date, confirmedOutfitId, plannedOutfitId' })
      .upgrade(async (tx) => {
        const plans = (await tx.table('dayPlans').toArray()) as LegacyDayPlanRecord[]
        if (plans.length) await tx.table('moments').bulkAdd(plans.map(momentFromDayPlan))
      })
    this.version(3).stores({ dayPlans: null })
    this.version(SCHEMA_VERSION).stores({ intake: 'id, status, createdAt' })
  }
}

export const db = new GroomingDB()

export const DEFAULT_SETTINGS: SettingsRecord = {
  id: 'settings',
  onboarded: false,
  locationName: '',
  lat: null,
  lon: null,
  tempUnit: 'C',
  runsHotCold: 0,
  // Unused since 0.2: Today asks "where are you going?" instead of assuming a weekday default. Kept for older backups.
  weekdayDefaults: { '0': '', '1': '', '2': '', '3': '', '4': '', '5': '', '6': '' },
  planDays: 3,
  cooldownDays: { base: 1, layer: 1, bottoms: 1, shoes: 1, outer: 1, belt: 0, accessory: 0, set: 1 },
  washDefaults: { 'dress-shirt': 1, 'casual-shirt': 1, polo: 1, 't-shirt': 1, henley: 1, sweater: 3, cardigan: 3, hoodie: 3, jeans: 5, chinos: 3, 'dress-trousers': 3, shorts: 2, joggers: 2, cargo: 3 },
  occasionWindows: {},
  language: 'auto',
  theme: 'auto',
  bgRemoval: true,
  sneakersAtWork: true,
  allowSuedeInRain: false,
  lastBackupAt: null,
  itemsSinceBackup: 0,
  persistGranted: null,
}

export async function getSettings(): Promise<SettingsRecord> {
  const existing = await db.settings.get('settings')
  if (existing) return { ...DEFAULT_SETTINGS, ...existing }
  await db.settings.put(DEFAULT_SETTINGS)
  return { ...DEFAULT_SETTINGS }
}

export async function updateSettings(patch: Partial<SettingsRecord>): Promise<SettingsRecord> {
  const current = await getSettings()
  const next = { ...current, ...patch, id: 'settings' as const }
  await db.settings.put(next)
  return next
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

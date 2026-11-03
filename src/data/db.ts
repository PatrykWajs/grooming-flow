import Dexie, { type EntityTable } from 'dexie'
import type { CategoryId, HourlyWeather, ItemStatus, Material, Pattern, Season, WeatherWindow } from '../engine/types'

export const DB_NAME = 'groomingflow-db'
export const SCHEMA_VERSION = 1

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

export interface DayPlanRecord {
  /** YYYY-MM-DD, the primary key. */
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
  weekdayDefaults: Record<string, string>
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
  dayPlans!: EntityTable<DayPlanRecord, 'date'>
  wearEntries!: EntityTable<WearEntryRecord, 'id'>
  occasions!: EntityTable<OccasionRecord, 'id'>
  settings!: EntityTable<SettingsRecord, 'id'>
  preferences!: EntityTable<PreferenceRecord, 'id'>
  blobs!: EntityTable<BlobRecord, 'id'>
  weather!: EntityTable<WeatherCacheRecord, 'key'>

  constructor(name = DB_NAME) {
    super(name)
    this.version(SCHEMA_VERSION).stores({
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
  weekdayDefaults: { '1': 'office', '2': 'office', '3': 'office', '4': 'office', '5': 'office', '6': 'casual', '0': 'home' },
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

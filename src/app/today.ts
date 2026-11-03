/**
 * Day glue: the moments of a day (stored, or the weekday default as a virtual
 * one), the forecast over each moment's hours, the engine's suggestions, and
 * the actions: add, change or remove a moment, keep an outfit, "I wore this",
 * dress for right now, plan several days ahead.
 */
import { confirmMoment, createMoment, deleteMoment, momentsBetween, momentsOn, saveOutfit, shiftDate, unconfirmMoment, updateMoment, wearContext, type CheckinSettings } from '../data/checkin'
import { db, getSettings, newId, nowIso, today as todayDate, updateSettings, type ItemRecord, type MomentRecord, type OutfitRecord, type PreferenceRecord, type SettingsRecord } from '../data/db'
import { toEngineItem } from '../data/items'
import { emptySignals } from '../engine/context'
import { loadEngineData } from '../engine/data'
import { planSequence, type PlanHistory, type PlanStep } from '../engine/plan'
import { recommend, type EngineData } from '../engine/recommend'
import type { Occasion, OutfitProposal, Reason, RecommendSettings, UserSignals, WeatherWindow } from '../engine/types'
import { bandFor, estimatedWindow, summariseWindow, windowHours } from '../engine/weather'
import { getForecast, type ForecastResult } from '../weather/forecast'
import { openMeteo } from '../weather/openMeteo'

/** Open-Meteo gives 16 days; the strip and the planner stop at 14. */
export const PLAN_MAX_DAYS = 14
/** Key of the weekday-default moment before it is written. */
export const VIRTUAL = 'virtual'
/** Hours a "right now" outfit covers when the occasion's own window has passed. */
export const NOW_HOURS = 4

export interface MomentView {
  /** The stored id, or `VIRTUAL` for the weekday default not yet written. */
  key: string
  stored: boolean
  moment: MomentRecord
  /** The occasion with its window resolved to this moment's hours. */
  occasion: Occasion
  weather: WeatherWindow | null
  /** Suggestions, the kept outfit first when there is one. */
  outfits: OutfitProposal[]
  reason?: Reason
  plannedOutfit: OutfitRecord | null
  confirmedOutfit: OutfitRecord | null
}

export interface DayModel {
  date: string
  settings: SettingsRecord
  data: EngineData
  items: ItemRecord[]
  itemsById: Map<string, ItemRecord>
  forecast: ForecastResult | null
  moments: MomentView[]
  defaultOccasionId: string | null
}

export interface DayOverrides {
  /** Apply `locked` / `excluded` to this moment only (the swap sheet). */
  momentKey?: string
  locked?: Set<string>
  excluded?: Set<string>
}

export function occasionFor(data: EngineData, settings: SettingsRecord, id: string): Occasion {
  const base = data.occasions.occasions.find((o) => o.id === id) ?? data.occasions.occasions[0]
  const window = settings.occasionWindows[base.id] ?? base.window
  return { ...base, window }
}

export function resolveWindow(moment: Pick<MomentRecord, 'start' | 'end'>, occasion: Occasion): [string, string] {
  return [moment.start ?? occasion.window[0], moment.end ?? occasion.window[1]]
}

export function momentOccasion(data: EngineData, settings: SettingsRecord, moment: Pick<MomentRecord, 'occasionId' | 'start' | 'end'>): Occasion {
  const base = occasionFor(data, settings, moment.occasionId)
  return { ...base, window: resolveWindow(moment, base) }
}

/** The weekday default, or null when the user decides on the day. */
export function defaultOccasionId(settings: SettingsRecord, date: string): string | null {
  const dow = String(new Date(`${date}T12:00:00`).getDay())
  const id = settings.weekdayDefaults[dow]
  return id ? id : null
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function toHHMM(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * The hours a "right now" outfit is for: from the current hour to the end of
 * the occasion's window when we are inside it, otherwise four hours.
 */
export function nowWindow(occasion: Occasion, now: Date = new Date()): [string, string] {
  const start = now.getHours() * 60
  const occStart = toMinutes(occasion.window[0])
  let occEnd = toMinutes(occasion.window[1])
  if (occEnd <= occStart) occEnd += 1440
  const inside = (start >= occStart && start < occEnd) || (start + 1440 >= occStart && start + 1440 < occEnd)
  const end = inside ? occEnd : start + NOW_HOURS * 60
  return [toHHMM(start), toHHMM(end)]
}

export function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

export function weatherForWindow(forecast: ForecastResult | null, date: string, window: [string, string], settings: SettingsRecord, data: EngineData): WeatherWindow | null {
  if (!forecast) return null
  const hours = windowHours(forecast.record.hourly, date, window)
  if (hours.length > 0) return summariseWindow(hours, data.weatherRules, settings.runsHotCold)
  const daily = forecast.record.daily.find((d) => d.date === date)
  if (daily) {
    const mean = (daily.apparentMax + daily.apparentMin) / 2
    return estimatedWindow(bandFor(mean, data.weatherRules, settings.runsHotCold), mean, daily.precipitationProbabilityMax >= 40)
  }
  return null
}

async function forecastFor(settings: SettingsRecord): Promise<ForecastResult | null> {
  if (settings.lat == null || settings.lon == null) return null
  return getForecast(openMeteo, settings.lat, settings.lon)
}

function engineSettings(settings: SettingsRecord, seed: string): RecommendSettings {
  return {
    runsHotCold: settings.runsHotCold,
    sneakersAtWork: settings.sneakersAtWork,
    allowSuedeInRain: settings.allowSuedeInRain,
    cooldownDays: settings.cooldownDays,
    cooldownScore: { base: 0, layer: 0, bottoms: 0, shoes: 0.5, outer: 0.5, belt: 0.5, accessory: 0.5, set: 0 },
    noRepeatDays: 30,
    seed,
  }
}

function checkinSettings(settings: SettingsRecord): CheckinSettings {
  return { sneakersAtWork: settings.sneakersAtWork, allowSuedeInRain: settings.allowSuedeInRain, washDefaults: settings.washDefaults }
}

function signalsFrom(prefs: PreferenceRecord[], moment: MomentRecord, overrides: Pick<DayOverrides, 'locked' | 'excluded'>): UserSignals {
  const signals = emptySignals()
  for (const p of prefs) {
    if (p.type === 'like') p.itemIds.forEach((id) => signals.liked.add(id))
    if (p.type === 'dislike') p.itemIds.forEach((id) => signals.disliked.add(id))
    if (p.type === 'never-together' && p.itemIds.length === 2) {
      const [a, b] = p.itemIds
      signals.neverTogether.add(a < b ? `${a}|${b}` : `${b}|${a}`)
    }
  }
  for (const id of moment.lockedItemIds) signals.locked.add(id)
  for (const id of overrides.locked ?? []) signals.locked.add(id)
  for (const id of overrides.excluded ?? []) signals.excluded.add(id)
  return signals
}

function virtualMoment(date: string, occasionId: string): MomentRecord {
  return {
    id: '',
    date,
    occasionId,
    start: null,
    end: null,
    createdAt: '',
    createdBy: 'user',
    weatherSnapshot: null,
    plannedOutfitId: null,
    confirmedOutfitId: null,
    lockedItemIds: [],
    rating: null,
    note: '',
    confirmedAt: null,
    eligibleItemIds: [],
  }
}

export function sortMoments<T extends Pick<MomentRecord, 'occasionId' | 'start' | 'end' | 'createdAt'>>(moments: T[], data: EngineData, settings: SettingsRecord): T[] {
  return [...moments].sort((a, b) => {
    const sa = toMinutes(momentOccasion(data, settings, a).window[0])
    const sb = toMinutes(momentOccasion(data, settings, b).window[0])
    return sa - sb || a.createdAt.localeCompare(b.createdAt)
  })
}

export function toProposal(record: OutfitRecord): OutfitProposal {
  let reasons: Reason[] = []
  try {
    const parsed: unknown = JSON.parse(record.reason)
    if (Array.isArray(parsed)) reasons = parsed as Reason[]
  } catch {
    /* an outfit without stored reasons */
  }
  return { slots: { ...record.slots }, itemIds: [...record.itemIds], score: { style: 0, rotation: 0, recency: 0, signals: 0, weather: 0, total: record.score }, reasons }
}

export async function loadDay(date: string, overrides: DayOverrides = {}): Promise<DayModel> {
  const [settings, data, items, stored, prefs] = await Promise.all([getSettings(), loadEngineData(), db.items.toArray(), momentsOn(date), db.preferences.toArray()])
  const forecast = await forecastFor(settings)
  const defaultId = defaultOccasionId(settings, date)
  const records = stored.length ? stored : defaultId ? [virtualMoment(date, defaultId)] : []
  const itemsById = new Map(items.map((i) => [i.id, i]))
  const engineItems = items.map((i) => toEngineItem(i, data.taxonomy))
  const anyActive = engineItems.some((i) => i.status === 'active')
  const moments: MomentView[] = []

  for (const moment of sortMoments(records, data, settings)) {
    const key = moment.id || VIRTUAL
    const occasion = momentOccasion(data, settings, moment)
    const weather = weatherForWindow(forecast, date, occasion.window, settings, data)
    const [plannedOutfit, confirmedOutfit] = await Promise.all([
      moment.plannedOutfitId ? db.outfits.get(moment.plannedOutfitId) : undefined,
      moment.confirmedOutfitId ? db.outfits.get(moment.confirmedOutfitId) : undefined,
    ])
    const own = overrides.momentKey === key ? overrides : {}
    const signals = signalsFrom(prefs, moment, own)
    const { wornRecently, recentOutfits } = await wearContext(date, { excludeMomentId: moment.id || null })
    let outfits: OutfitProposal[] = []
    let reason: Reason | undefined
    if (anyActive) {
      const result = recommend(
        { date, items: engineItems, weather: weather ?? estimatedWindow('mild', 20), occasion, signals, settings: engineSettings(settings, `${date}#${key}`), recentOutfits, wornRecently },
        data,
        { results: 6 },
      )
      outfits = result.outfits
      reason = result.reason
    } else reason = { key: 'reason.nothingEligible' }
    // The kept outfit leads, unless the caller is looking for alternatives.
    if (plannedOutfit && !confirmedOutfit && overrides.momentKey !== key) {
      const kept = toProposal(plannedOutfit)
      outfits = [kept, ...outfits.filter((o) => !sameIds(o.itemIds, kept.itemIds))]
    }
    moments.push({ key, stored: !!moment.id, moment, occasion, weather, outfits, reason, plannedOutfit: plannedOutfit ?? null, confirmedOutfit: confirmedOutfit ?? null })
  }

  return { date, settings, data, items, itemsById, forecast, moments, defaultOccasionId: defaultId }
}

/** Writes the weekday-default moment the first time the user acts on it. */
export async function ensureStored(view: MomentView): Promise<string> {
  if (view.stored) return view.moment.id
  const record = await createMoment({ date: view.moment.date, occasionId: view.moment.occasionId, createdBy: 'user' })
  return record.id
}

/**
 * Adds a moment to a day. A day that so far showed only its weekday default
 * keeps it: the default is written first, so "another outfit" is added to the
 * office day instead of replacing it.
 */
export async function addMoment(date: string, occasionId: string, window: [string, string] | null): Promise<MomentRecord> {
  const existing = await momentsOn(date)
  if (existing.length === 0) {
    const settings = await getSettings()
    const defaultId = defaultOccasionId(settings, date)
    if (defaultId && defaultId !== occasionId) await createMoment({ date, occasionId: defaultId, createdBy: 'user' })
  }
  return createMoment({ date, occasionId, start: window?.[0] ?? null, end: window?.[1] ?? null, createdBy: 'user' })
}

export async function changeMoment(view: MomentView, patch: { occasionId?: string; start?: string | null; end?: string | null }): Promise<void> {
  const id = await ensureStored(view)
  const current = await db.moments.get(id)
  if (!current) return
  const next: Partial<MomentRecord> = { ...patch }
  // A kept outfit was chosen for another occasion: let it go.
  if (patch.occasionId !== undefined && patch.occasionId !== current.occasionId && current.plannedOutfitId && !current.confirmedOutfitId) {
    await db.outfits.delete(current.plannedOutfitId)
    next.plannedOutfitId = null
  }
  await updateMoment(id, next)
}

export async function removeMoment(id: string): Promise<void> {
  await deleteMoment(id)
}

/** Pin an outfit to a moment that has not been worn yet (a future day, or later today). */
export async function keepOutfit(view: MomentView, outfit: OutfitProposal): Promise<void> {
  const id = await ensureStored(view)
  const current = await db.moments.get(id)
  if (current?.plannedOutfitId) await db.outfits.delete(current.plannedOutfitId)
  const record = await saveOutfit(outfit, 'manual', JSON.stringify(outfit.reasons))
  await updateMoment(id, { plannedOutfitId: record.id, weatherSnapshot: view.weather })
}

export async function wearOutfit(day: DayModel, view: MomentView, outfit: OutfitProposal, weather: WeatherWindow): Promise<OutfitRecord> {
  const id = await ensureStored(view)
  const record = view.plannedOutfit && sameIds(view.plannedOutfit.itemIds, outfit.itemIds) ? view.plannedOutfit : await saveOutfit(outfit, 'today', JSON.stringify(outfit.reasons))
  await confirmMoment(id, record, view.occasion, weather, day.data, checkinSettings(day.settings))
  return record
}

export async function undoWear(momentId: string): Promise<void> {
  await unconfirmMoment(momentId)
}

export async function rateMoment(momentId: string, rating: 'up' | 'down'): Promise<void> {
  const moment = await db.moments.get(momentId)
  if (!moment?.confirmedOutfitId) return
  const outfit = await db.outfits.get(moment.confirmedOutfitId)
  await updateMoment(momentId, { rating })
  if (outfit) await db.preferences.put({ id: newId(), type: rating === 'up' ? 'like' : 'dislike', itemIds: outfit.itemIds, outfitId: outfit.id, createdAt: nowIso() })
}

export async function toggleLock(view: MomentView, itemId: string): Promise<void> {
  const id = await ensureStored(view)
  const moment = await db.moments.get(id)
  const locked = new Set(moment?.lockedItemIds ?? [])
  if (locked.has(itemId)) locked.delete(itemId)
  else locked.add(itemId)
  await updateMoment(id, { lockedItemIds: [...locked] })
}

/** Alternatives for one slot of one moment: everything else locked, the current item excluded. */
export async function alternativesFor(day: DayModel, view: MomentView, outfit: OutfitProposal, slotId: string): Promise<OutfitProposal[]> {
  const current = outfit.slots[slotId]
  const locked = new Set(Object.entries(outfit.slots).filter(([s]) => s !== slotId).map(([, id]) => id))
  const excluded = new Set(current ? [current] : [])
  const again = await loadDay(day.date, { momentKey: view.key, locked, excluded })
  const target = again.moments.find((m) => m.key === view.key)
  const seen = new Set<string>()
  const out: OutfitProposal[] = []
  for (const o of target?.outfits ?? []) {
    const id = o.slots[slotId]
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(o)
  }
  return out
}

async function planHistory(date: string): Promise<PlanHistory> {
  const entries = await db.wearEntries.where('date').between(shiftDate(date, -30), date, true, true).toArray()
  const byOutfit = new Map<string, Set<string>>()
  for (const e of entries) {
    const set = byOutfit.get(e.outfitId) ?? new Set<string>()
    set.add(e.itemId)
    byOutfit.set(e.outfitId, set)
  }
  return { events: entries.map((e) => ({ itemId: e.itemId, date: e.date })), recentOutfits: [...byOutfit.values()].map((s) => [...s]) }
}

/**
 * Plan the next `days` days from today: days without a moment get their
 * weekday default (days set to "decide on the day" are skipped and reported),
 * every unworn moment gets an outfit chosen in sequence, outfits the user kept
 * by hand are respected, outfits from an earlier plan are replaced.
 */
export async function planAhead(days: number): Promise<{ planned: number; skipped: number }> {
  const count = Math.max(1, Math.min(PLAN_MAX_DAYS, Math.round(days)))
  const [settings, data, items, prefs] = await Promise.all([getSettings(), loadEngineData(), db.items.toArray(), db.preferences.toArray()])
  const forecast = await forecastFor(settings)
  const start = todayDate()
  const steps: PlanStep[] = []
  const toPlan = new Map<string, MomentRecord>()
  let skipped = 0

  for (let i = 0; i < count; i++) {
    const date = shiftDate(start, i)
    let records = await momentsOn(date)
    if (records.length === 0) {
      const id = defaultOccasionId(settings, date)
      if (!id) {
        skipped++
        continue
      }
      records = [await createMoment({ date, occasionId: id, createdBy: 'planner' })]
    }
    for (const m of sortMoments(records, data, settings)) {
      if (m.confirmedOutfitId) continue // worn already: it is in the wear history
      const occasion = momentOccasion(data, settings, m)
      const weather = weatherForWindow(forecast, date, occasion.window, settings, data) ?? estimatedWindow('mild', 20)
      const kept = m.plannedOutfitId ? await db.outfits.get(m.plannedOutfitId) : undefined
      if (kept && kept.source === 'manual') steps.push({ key: m.id, date, occasion, weather, fixedItemIds: kept.itemIds })
      else {
        steps.push({ key: m.id, date, occasion, weather, signals: signalsFrom(prefs, m, {}) })
        toPlan.set(m.id, m)
      }
    }
  }

  const results = planSequence(
    steps,
    items.map((i) => toEngineItem(i, data.taxonomy)),
    data,
    engineSettings(settings, start),
    await planHistory(start),
    { results: 3 },
  )
  let planned = 0
  for (const r of results) {
    const moment = toPlan.get(r.key)
    if (!moment || !r.outfit) continue
    if (moment.plannedOutfitId) await db.outfits.delete(moment.plannedOutfitId)
    const record = await saveOutfit(r.outfit, 'plan', JSON.stringify(r.outfit.reasons))
    await updateMoment(moment.id, { plannedOutfitId: record.id, weatherSnapshot: steps.find((s) => s.key === r.key)?.weather ?? null })
    planned++
  }
  await updateSettings({ planDays: count })
  return { planned, skipped }
}

/** Drops what plan-ahead made from today on: its moments, and its outfits on the user's own moments. Worn moments and kept outfits stay. */
export async function clearPlan(): Promise<number> {
  const start = todayDate()
  const pending = (await momentsBetween(start, shiftDate(start, PLAN_MAX_DAYS * 4))).filter((m) => !m.confirmedOutfitId)
  let cleared = 0
  for (const m of pending) {
    if (m.createdBy === 'planner') {
      await deleteMoment(m.id)
      cleared++
      continue
    }
    const kept = m.plannedOutfitId ? await db.outfits.get(m.plannedOutfitId) : undefined
    if (kept && kept.source === 'plan') {
      await db.outfits.delete(kept.id)
      await updateMoment(m.id, { plannedOutfitId: null })
      cleared++
    }
  }
  return cleared
}

/** Days still open for a late check-in: today and the two days before. */
export function graceDays(today: string): string[] {
  return [today, shiftDate(today, -1), shiftDate(today, -2)]
}

export function formatAge(minutes: number, lang: string): string {
  if (minutes < 60) return lang === 'el' ? `${Math.max(1, Math.round(minutes))} λεπτά` : `${Math.max(1, Math.round(minutes))} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return lang === 'el' ? `${hours} ώρες` : `${hours} h`
  const days = Math.round(hours / 24)
  return lang === 'el' ? `${days} ημέρες` : `${days} days`
}

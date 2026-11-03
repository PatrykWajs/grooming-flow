/**
 * Day glue: the moments of a day (every "where are you going?" answer), the
 * forecast over each moment's hours, the engine's suggestions, and the
 * actions: add or remove a moment, "I'll wear this", swap one piece, plan
 * the next days.
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

/** Open-Meteo gives 16 days; the planner stops at 14. */
export const PLAN_MAX_DAYS = 14
/** Hours an outfit covers when the occasion's own window has already passed. */
export const NOW_HOURS = 4

export interface MomentView {
  /** The stored id. */
  key: string
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

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function toHHMM(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * The hours an outfit for today covers, from the answer to "where are you
 * going?": the occasion's own window while it has not started, from the
 * current hour to its end while we are inside it, and four hours from now
 * once it has passed.
 */
export function windowForToday(occasion: Occasion, now: Date = new Date()): [string, string] {
  const minute = now.getHours() * 60 + now.getMinutes()
  const hour = now.getHours() * 60
  const occStart = toMinutes(occasion.window[0])
  let occEnd = toMinutes(occasion.window[1])
  if (occEnd <= occStart) occEnd += 1440
  const inside = (minute >= occStart && minute < occEnd) || (minute + 1440 >= occStart && minute + 1440 < occEnd)
  if (inside) return [toHHMM(hour), toHHMM(occEnd)]
  if (minute < occStart) return occasion.window
  return [toHHMM(hour), toHHMM(hour + NOW_HOURS * 60)]
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
  const itemsById = new Map(items.map((i) => [i.id, i]))
  const engineItems = items.map((i) => toEngineItem(i, data.taxonomy))
  const anyActive = engineItems.some((i) => i.status === 'active')
  const moments: MomentView[] = []

  for (const moment of sortMoments(stored, data, settings)) {
    const key = moment.id
    const occasion = momentOccasion(data, settings, moment)
    const weather = weatherForWindow(forecast, date, occasion.window, settings, data)
    const [plannedOutfit, confirmedOutfit] = await Promise.all([
      moment.plannedOutfitId ? db.outfits.get(moment.plannedOutfitId) : undefined,
      moment.confirmedOutfitId ? db.outfits.get(moment.confirmedOutfitId) : undefined,
    ])
    const own = overrides.momentKey === key ? overrides : {}
    const signals = signalsFrom(prefs, moment, own)
    const { wornRecently, recentOutfits } = await wearContext(date, { excludeMomentId: moment.id })
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
    moments.push({ key, moment, occasion, weather, outfits, reason, plannedOutfit: plannedOutfit ?? null, confirmedOutfit: confirmedOutfit ?? null })
  }

  return { date, settings, data, items, itemsById, forecast, moments }
}

/** "Where are you going?": one more moment on the day, with its hours or the occasion's own. */
export async function addMoment(date: string, occasionId: string, window: [string, string] | null): Promise<MomentRecord> {
  return createMoment({ date, occasionId, start: window?.[0] ?? null, end: window?.[1] ?? null, createdBy: 'user' })
}

export async function removeMoment(id: string): Promise<void> {
  await deleteMoment(id)
}

export async function wearOutfit(day: DayModel, view: MomentView, outfit: OutfitProposal, weather: WeatherWindow): Promise<OutfitRecord> {
  const record = view.plannedOutfit && sameIds(view.plannedOutfit.itemIds, outfit.itemIds) ? view.plannedOutfit : await saveOutfit(outfit, 'today', JSON.stringify(outfit.reasons))
  await confirmMoment(view.moment.id, record, view.occasion, weather, day.data, checkinSettings(day.settings))
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
 * Plan the next `days` days after today: a day without a moment gets one for
 * `occasionId` (made by the planner, so "clear the plan" can take it back),
 * every unworn moment gets an outfit chosen in sequence, outfits the user
 * kept by hand are respected, outfits from an earlier plan are replaced.
 * Today's own pending outfits are taken as worn, so tomorrow does not repeat
 * them.
 */
export async function planAhead(days: number, occasionId: string): Promise<{ planned: number }> {
  const count = Math.max(1, Math.min(PLAN_MAX_DAYS, Math.round(days)))
  const [settings, data, items, prefs] = await Promise.all([getSettings(), loadEngineData(), db.items.toArray(), db.preferences.toArray()])
  const forecast = await forecastFor(settings)
  const start = todayDate()
  const steps: PlanStep[] = []
  const toPlan = new Map<string, MomentRecord>()

  for (const m of await momentsOn(start)) {
    if (m.confirmedOutfitId || !m.plannedOutfitId) continue
    const kept = await db.outfits.get(m.plannedOutfitId)
    if (!kept) continue
    const occasion = momentOccasion(data, settings, m)
    steps.push({ key: m.id, date: start, occasion, weather: weatherForWindow(forecast, start, occasion.window, settings, data) ?? estimatedWindow('mild', 20), fixedItemIds: kept.itemIds })
  }

  for (let i = 1; i <= count; i++) {
    const date = shiftDate(start, i)
    let records = await momentsOn(date)
    if (records.length === 0) records = [await createMoment({ date, occasionId, createdBy: 'planner' })]
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
  return { planned }
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

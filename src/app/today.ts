/**
 * Today glue: builds the engine context from the database and the forecast,
 * runs the recommender, and writes the check-in.
 */
import { confirmDay, getDayPlan, recentWear, saveOutfit, shiftDate, unconfirmDay, upsertDayPlan } from '../data/checkin'
import { db, getSettings, newId, nowIso, type DayPlanRecord, type ItemRecord, type OutfitRecord, type SettingsRecord } from '../data/db'
import { toEngineItem } from '../data/items'
import { emptySignals } from '../engine/context'
import { loadEngineData } from '../engine/data'
import { recommend, type EngineData } from '../engine/recommend'
import type { Occasion, OutfitProposal, Reason, UserSignals, WeatherWindow } from '../engine/types'
import { bandFor, estimatedWindow, summariseWindow, windowHours } from '../engine/weather'
import { getForecast, type ForecastResult } from '../weather/forecast'
import { openMeteo } from '../weather/openMeteo'

export interface TodayModel {
  date: string
  settings: SettingsRecord
  data: EngineData
  items: ItemRecord[]
  itemsById: Map<string, ItemRecord>
  occasion: Occasion
  weather: WeatherWindow | null
  forecast: ForecastResult | null
  plan: DayPlanRecord | null
  outfits: OutfitProposal[]
  reason?: Reason
  confirmedOutfit: OutfitRecord | null
}

export interface TodayOverrides {
  occasionId?: string
  locked?: Set<string>
  excluded?: Set<string>
}

export function occasionFor(data: EngineData, settings: SettingsRecord, id: string): Occasion {
  const base = data.occasions.occasions.find((o) => o.id === id) ?? data.occasions.occasions[0]
  const window = settings.occasionWindows[base.id] ?? base.window
  return { ...base, window }
}

export function defaultOccasionId(settings: SettingsRecord, date: string): string {
  const dow = String(new Date(`${date}T12:00:00`).getDay())
  return settings.weekdayDefaults[dow] ?? 'casual'
}

export async function weatherFor(date: string, occasion: Occasion, settings: SettingsRecord, data: EngineData): Promise<{ weather: WeatherWindow | null; forecast: ForecastResult | null }> {
  if (settings.lat == null || settings.lon == null) return { weather: null, forecast: null }
  const forecast = await getForecast(openMeteo, settings.lat, settings.lon)
  if (!forecast) return { weather: null, forecast: null }
  const hours = windowHours(forecast.record.hourly, date, occasion.window)
  if (hours.length > 0) return { weather: summariseWindow(hours, data.weatherRules, settings.runsHotCold), forecast }
  const daily = forecast.record.daily.find((d) => d.date === date)
  if (daily) {
    const mean = (daily.apparentMax + daily.apparentMin) / 2
    return { weather: estimatedWindow(bandFor(mean, data.weatherRules, settings.runsHotCold), mean, daily.precipitationProbabilityMax >= 40), forecast }
  }
  return { weather: null, forecast }
}

async function signalsFor(plan: DayPlanRecord | null, overrides: TodayOverrides): Promise<UserSignals> {
  const signals = emptySignals()
  const prefs = await db.preferences.toArray()
  for (const p of prefs) {
    if (p.type === 'like') p.itemIds.forEach((id) => signals.liked.add(id))
    if (p.type === 'dislike') p.itemIds.forEach((id) => signals.disliked.add(id))
    if (p.type === 'never-together' && p.itemIds.length === 2) {
      const [a, b] = p.itemIds
      signals.neverTogether.add(a < b ? `${a}|${b}` : `${b}|${a}`)
    }
  }
  for (const id of plan?.lockedItemIds ?? []) signals.locked.add(id)
  for (const id of overrides.locked ?? []) signals.locked.add(id)
  for (const id of overrides.excluded ?? []) signals.excluded.add(id)
  return signals
}

export async function loadToday(date: string, overrides: TodayOverrides = {}): Promise<TodayModel> {
  const [settings, data, items, plan] = await Promise.all([getSettings(), loadEngineData(), db.items.toArray(), getDayPlan(date)])
  const occasionId = overrides.occasionId ?? plan?.occasionId ?? defaultOccasionId(settings, date)
  const occasion = occasionFor(data, settings, occasionId)
  const { weather, forecast } = await weatherFor(date, occasion, settings, data)
  const itemsById = new Map(items.map((i) => [i.id, i]))
  const confirmedOutfit = plan?.confirmedOutfitId ? ((await db.outfits.get(plan.confirmedOutfitId)) ?? null) : null

  const effectiveWeather = weather ?? estimatedWindow('mild', 20)
  const signals = await signalsFor(plan ?? null, overrides)
  const { wornRecently, recentOutfits } = await recentWear(date, 30)
  const engineItems = items.map((i) => toEngineItem(i, data.taxonomy))
  const result = engineItems.some((i) => i.status === 'active')
    ? recommend(
        {
          date,
          items: engineItems,
          weather: effectiveWeather,
          occasion,
          signals,
          settings: {
            runsHotCold: settings.runsHotCold,
            sneakersAtWork: settings.sneakersAtWork,
            allowSuedeInRain: settings.allowSuedeInRain,
            cooldownDays: settings.cooldownDays,
            cooldownScore: { base: 0, layer: 0, bottoms: 0, shoes: 0.5, outer: 0.5, belt: 0.5, accessory: 0.5, set: 0 },
            noRepeatDays: 30,
            seed: date,
          },
          recentOutfits,
          wornRecently,
        },
        data,
        { results: 6 },
      )
    : { outfits: [], reason: { key: 'reason.nothingEligible' } as Reason }

  return { date, settings, data, items, itemsById, occasion, weather, forecast, plan: plan ?? null, outfits: result.outfits, reason: result.reason, confirmedOutfit }
}

/** Alternatives for one slot: everything else locked, the current item excluded. */
export async function alternativesFor(model: TodayModel, outfit: OutfitProposal, slotId: string): Promise<OutfitProposal[]> {
  const current = outfit.slots[slotId]
  const locked = new Set(Object.entries(outfit.slots).filter(([s]) => s !== slotId).map(([, id]) => id))
  const excluded = new Set(current ? [current] : [])
  const again = await loadToday(model.date, { occasionId: model.occasion.id, locked, excluded })
  const seen = new Set<string>()
  const out: OutfitProposal[] = []
  for (const o of again.outfits) {
    const id = o.slots[slotId]
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(o)
  }
  return out
}

export async function setOccasion(date: string, occasionId: string): Promise<void> {
  await upsertDayPlan(date, { occasionId })
}

export async function toggleLock(date: string, itemId: string): Promise<void> {
  const plan = await getDayPlan(date)
  const locked = new Set(plan?.lockedItemIds ?? [])
  if (locked.has(itemId)) locked.delete(itemId)
  else locked.add(itemId)
  await upsertDayPlan(date, { lockedItemIds: [...locked] })
}

export async function wearThis(model: TodayModel, outfit: OutfitProposal, weather: WeatherWindow): Promise<OutfitRecord> {
  const record = await saveOutfit(outfit, 'today', JSON.stringify(outfit.reasons))
  await confirmDay(model.date, record, model.occasion, weather, model.data, {
    sneakersAtWork: model.settings.sneakersAtWork,
    allowSuedeInRain: model.settings.allowSuedeInRain,
    washDefaults: model.settings.washDefaults,
  })
  return record
}

export async function undoWear(date: string): Promise<void> {
  await unconfirmDay(date)
}

export async function rateDay(date: string, rating: 'up' | 'down'): Promise<void> {
  const plan = await getDayPlan(date)
  if (!plan?.confirmedOutfitId) return
  const outfit = await db.outfits.get(plan.confirmedOutfitId)
  await upsertDayPlan(date, { rating })
  if (outfit) {
    await db.preferences.put({ id: newId(), type: rating === 'up' ? 'like' : 'dislike', itemIds: outfit.itemIds, outfitId: outfit.id, createdAt: nowIso() })
  }
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

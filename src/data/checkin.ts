import type { EngineData } from '../engine/recommend'
import { isEligible } from '../engine/recommend'
import type { Occasion, OutfitProposal, WeatherWindow } from '../engine/types'
import { db, newId, nowIso, type DayPlanRecord, type OutfitRecord } from './db'
import { toEngineItem } from './items'

export async function getDayPlan(date: string): Promise<DayPlanRecord | undefined> {
  return db.dayPlans.get(date)
}

export async function upsertDayPlan(date: string, patch: Partial<DayPlanRecord>): Promise<DayPlanRecord> {
  const current = (await db.dayPlans.get(date)) ?? {
    date,
    occasionId: 'casual',
    weatherSnapshot: null,
    plannedOutfitId: null,
    confirmedOutfitId: null,
    locked: false,
    lockedItemIds: [],
    rating: null,
    note: '',
    confirmedAt: null,
  }
  const next = { ...current, ...patch, date }
  await db.dayPlans.put(next)
  return next
}

export async function saveOutfit(proposal: OutfitProposal, source: OutfitRecord['source'], reason: string): Promise<OutfitRecord> {
  const record: OutfitRecord = {
    id: newId(),
    itemIds: [...proposal.itemIds],
    slots: { ...proposal.slots },
    reason,
    score: proposal.score.total,
    createdAt: nowIso(),
    source,
  }
  await db.outfits.put(record)
  return record
}

/**
 * "I wore this": one wear entry per item, counters on the items, the day's
 * record confirmed. Items that reach their wears-before-wash go to the wash.
 * Eligible days are counted on the same confirmed day for every active item
 * the weather and occasion would have allowed.
 */
export async function confirmDay(
  date: string,
  outfit: OutfitRecord,
  occasion: Occasion,
  weather: WeatherWindow,
  data: EngineData,
  settings: { sneakersAtWork: boolean; allowSuedeInRain: boolean; washDefaults: Record<string, number> },
): Promise<void> {
  await db.transaction('rw', db.items, db.wearEntries, db.dayPlans, db.outfits, async () => {
    const existing = await db.dayPlans.get(date)
    if (existing?.confirmedOutfitId) {
      // Re-confirming replaces the earlier confirmation of this day.
      await unconfirmDay(date)
    }
    const items = await db.items.toArray()
    const worn = new Set(outfit.itemIds)
    const entries = outfit.itemIds.map((itemId) => ({ id: newId(), itemId, date, outfitId: outfit.id }))
    await db.wearEntries.bulkPut(entries)
    const updates = items.map((item) => {
      const eligible = item.status === 'active' && isEligible(toEngineItem(item, data.taxonomy), weather, occasion, settings, data)
      const wasWorn = worn.has(item.id)
      const wearsSinceWash = wasWorn ? item.wearsSinceWash + 1 : item.wearsSinceWash
      const washAfter = settings.washDefaults[item.subcategory]
      const toWash = wasWorn && washAfter !== undefined && wearsSinceWash >= washAfter
      return {
        ...item,
        wearCount: item.wearCount + (wasWorn ? 1 : 0),
        lastWorn: wasWorn && (!item.lastWorn || item.lastWorn < date) ? date : item.lastWorn,
        eligibleDays: item.eligibleDays + (eligible ? 1 : 0),
        wearsSinceWash,
        status: toWash ? ('wash' as const) : item.status,
      }
    })
    await db.items.bulkPut(updates)
    await upsertDayPlan(date, { occasionId: occasion.id, weatherSnapshot: weather, confirmedOutfitId: outfit.id, confirmedAt: nowIso() })
  })
}

/** Undo a confirmation (the user changed their mind): reverses counters for that day. */
export async function unconfirmDay(date: string): Promise<void> {
  await db.transaction('rw', db.items, db.wearEntries, db.dayPlans, async () => {
    const plan = await db.dayPlans.get(date)
    if (!plan?.confirmedOutfitId) return
    const entries = await db.wearEntries.where('date').equals(date).toArray()
    const wornIds = new Set(entries.map((e) => e.itemId))
    await db.wearEntries.bulkDelete(entries.map((e) => e.id))
    const items = await db.items.toArray()
    const later = await db.wearEntries.where('itemId').anyOf([...wornIds]).toArray()
    const lastByItem = new Map<string, string>()
    for (const e of later) {
      const prev = lastByItem.get(e.itemId)
      if (!prev || e.date > prev) lastByItem.set(e.itemId, e.date)
    }
    await db.items.bulkPut(
      items.map((item) => {
        const wasWorn = wornIds.has(item.id)
        return {
          ...item,
          wearCount: Math.max(0, item.wearCount - (wasWorn ? 1 : 0)),
          lastWorn: wasWorn ? (lastByItem.get(item.id) ?? null) : item.lastWorn,
          eligibleDays: Math.max(0, item.eligibleDays - 1),
          wearsSinceWash: wasWorn ? Math.max(0, item.wearsSinceWash - 1) : item.wearsSinceWash,
        }
      }),
    )
    await db.dayPlans.put({ ...plan, confirmedOutfitId: null, confirmedAt: null })
  })
}

/** Item ids worn on each of the last `days` days (for the recency penalty and no-repeat). */
export async function recentWear(date: string, days: number): Promise<{ wornRecently: Map<string, number>; recentOutfits: string[][] }> {
  const from = shiftDate(date, -days)
  const entries = await db.wearEntries.where('date').between(from, date, true, false).toArray()
  const wornRecently = new Map<string, number>()
  const byOutfit = new Map<string, Set<string>>()
  for (const e of entries) {
    const ago = daysBetween(e.date, date)
    if (ago <= 2) wornRecently.set(e.itemId, Math.min(ago, wornRecently.get(e.itemId) ?? ago))
    const set = byOutfit.get(e.outfitId) ?? new Set<string>()
    set.add(e.itemId)
    byOutfit.set(e.outfitId, set)
  }
  return { wornRecently, recentOutfits: [...byOutfit.values()].map((s) => [...s]) }
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
}

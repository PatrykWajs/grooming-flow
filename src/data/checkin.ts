/**
 * Moments and check-ins. A moment is one outfit occasion on one day (any
 * number per day). Confirming a moment writes one wear entry per item for
 * that outfit; the item counters (wears, wears since wash, eligible days)
 * move once per day however many moments the item appears in.
 */
import type { EngineData } from '../engine/recommend'
import { isEligible } from '../engine/recommend'
import type { Occasion, OutfitProposal, WeatherWindow } from '../engine/types'
import { db, newId, nowIso, type MomentRecord, type OutfitRecord } from './db'
import { toEngineItem } from './items'

export interface NewMoment {
  date: string
  occasionId: string
  start?: string | null
  end?: string | null
  createdBy?: MomentRecord['createdBy']
}

export interface CheckinSettings {
  sneakersAtWork: boolean
  allowSuedeInRain: boolean
  washDefaults: Record<string, number>
}

export function blankMoment(input: NewMoment): MomentRecord {
  return {
    id: newId(),
    date: input.date,
    occasionId: input.occasionId,
    start: input.start ?? null,
    end: input.end ?? null,
    createdAt: nowIso(),
    createdBy: input.createdBy ?? 'user',
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

export async function momentsOn(date: string): Promise<MomentRecord[]> {
  return db.moments.where('date').equals(date).toArray()
}

/** Moments with `from <= date <= to`. */
export async function momentsBetween(from: string, to: string): Promise<MomentRecord[]> {
  return db.moments.where('date').between(from, to, true, true).toArray()
}

export async function createMoment(input: NewMoment): Promise<MomentRecord> {
  const record = blankMoment(input)
  await db.moments.put(record)
  return record
}

export async function updateMoment(id: string, patch: Partial<MomentRecord>): Promise<MomentRecord | undefined> {
  return db.transaction('rw', db.moments, async () => {
    const current = await db.moments.get(id)
    if (!current) return undefined
    const next = { ...current, ...patch, id }
    await db.moments.put(next)
    return next
  })
}

/** Removes a moment; a confirmed one is unconfirmed first so the counters stay right. */
export async function deleteMoment(id: string): Promise<void> {
  await db.transaction('rw', db.items, db.wearEntries, db.moments, db.outfits, async () => {
    const moment = await db.moments.get(id)
    if (!moment) return
    if (moment.confirmedOutfitId) await unconfirmMoment(id)
    if (moment.plannedOutfitId) await db.outfits.delete(moment.plannedOutfitId)
    await db.moments.delete(id)
  })
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
 * "I wore this" for one moment: one wear entry per item, the day's first wear
 * of an item moves its counters (a second moment with the same trousers is
 * still one day of wear), items that reach their wears-before-wash go to the
 * wash. Eligible days are counted on the confirmed day, once per item, for
 * every active item the weather and occasion of the moment would have allowed.
 */
export async function confirmMoment(momentId: string, outfit: OutfitRecord, occasion: Occasion, weather: WeatherWindow, data: EngineData, settings: CheckinSettings): Promise<void> {
  await db.transaction('rw', db.items, db.wearEntries, db.moments, db.outfits, async () => {
    const moment = await db.moments.get(momentId)
    if (!moment) return
    // Re-confirming replaces the earlier confirmation of this moment.
    if (moment.confirmedOutfitId) await unconfirmMoment(momentId)
    const siblings = (await db.moments.where('date').equals(moment.date).toArray()).filter((m) => m.id !== momentId && m.confirmedOutfitId)
    const wornElsewhere = new Set((await db.wearEntries.where('date').equals(moment.date).toArray()).map((e) => e.itemId))
    const countedElsewhere = new Set<string>()
    let legacyCountedAll = false
    for (const s of siblings) {
      if (s.eligibleItemIds === null) legacyCountedAll = true
      else s.eligibleItemIds.forEach((id) => countedElsewhere.add(id))
    }

    const items = await db.items.toArray()
    const worn = new Set(outfit.itemIds)
    await db.wearEntries.bulkPut(outfit.itemIds.map((itemId) => ({ id: newId(), itemId, date: moment.date, outfitId: outfit.id })))
    const eligibleItemIds: string[] = []
    const updates = items.map((item) => {
      const firstWearToday = worn.has(item.id) && !wornElsewhere.has(item.id)
      const eligible =
        !legacyCountedAll && !countedElsewhere.has(item.id) && item.status === 'active' && isEligible(toEngineItem(item, data.taxonomy), weather, occasion, settings, data)
      if (eligible) eligibleItemIds.push(item.id)
      const wearsSinceWash = firstWearToday ? item.wearsSinceWash + 1 : item.wearsSinceWash
      const washAfter = settings.washDefaults[item.subcategory]
      const toWash = firstWearToday && washAfter !== undefined && wearsSinceWash >= washAfter
      return {
        ...item,
        wearCount: item.wearCount + (firstWearToday ? 1 : 0),
        lastWorn: worn.has(item.id) && (!item.lastWorn || item.lastWorn < moment.date) ? moment.date : item.lastWorn,
        eligibleDays: item.eligibleDays + (eligible ? 1 : 0),
        wearsSinceWash,
        status: toWash ? ('wash' as const) : item.status,
      }
    })
    await db.items.bulkPut(updates)
    await db.moments.put({ ...moment, occasionId: occasion.id, weatherSnapshot: weather, confirmedOutfitId: outfit.id, confirmedAt: nowIso(), eligibleItemIds })
  })
}

/** Undo a confirmation (the user changed their mind): reverses the counters this moment moved. */
export async function unconfirmMoment(momentId: string): Promise<void> {
  await db.transaction('rw', db.items, db.wearEntries, db.moments, async () => {
    const moment = await db.moments.get(momentId)
    if (!moment?.confirmedOutfitId) return
    const outfitId = moment.confirmedOutfitId
    const onDate = await db.wearEntries.where('date').equals(moment.date).toArray()
    const ours = onDate.filter((e) => e.outfitId === outfitId)
    const stillWornToday = new Set(onDate.filter((e) => e.outfitId !== outfitId).map((e) => e.itemId))
    const wornIds = new Set(ours.map((e) => e.itemId))
    await db.wearEntries.bulkDelete(ours.map((e) => e.id))
    const remaining = await db.wearEntries.where('itemId').anyOf([...wornIds]).toArray()
    const lastByItem = new Map<string, string>()
    for (const e of remaining) {
      const prev = lastByItem.get(e.itemId)
      if (!prev || e.date > prev) lastByItem.set(e.itemId, e.date)
    }
    const counted = moment.eligibleItemIds === null ? null : new Set(moment.eligibleItemIds)
    const items = await db.items.toArray()
    await db.items.bulkPut(
      items.map((item) => {
        const undoWear = wornIds.has(item.id) && !stillWornToday.has(item.id)
        const undoEligible = counted === null || counted.has(item.id)
        return {
          ...item,
          wearCount: Math.max(0, item.wearCount - (undoWear ? 1 : 0)),
          lastWorn: wornIds.has(item.id) ? (lastByItem.get(item.id) ?? null) : item.lastWorn,
          eligibleDays: Math.max(0, item.eligibleDays - (undoEligible ? 1 : 0)),
          wearsSinceWash: undoWear ? Math.max(0, item.wearsSinceWash - 1) : item.wearsSinceWash,
        }
      }),
    )
    await db.moments.put({ ...moment, confirmedOutfitId: null, confirmedAt: null, eligibleItemIds: [] })
  })
}

export interface WearContext {
  /** Item id → days between the wear (or planned wear) and `date`, when within two days. */
  wornRecently: Map<string, number>
  /** Item-id sets of outfits worn or planned in the no-repeat window. */
  recentOutfits: string[][]
}

/**
 * What the engine must not repeat around `date`: confirmed wears of the last
 * `days` days, plus the outfits kept for other moments (same day, the two
 * days either side for recency, the whole window for no-repeat). The moment
 * being recommended is left out so its own plan never blocks it.
 */
export async function wearContext(date: string, options: { excludeMomentId?: string | null; days?: number } = {}): Promise<WearContext> {
  const days = options.days ?? 30
  const entries = await db.wearEntries.where('date').between(shiftDate(date, -days), date, true, true).toArray()
  const wornRecently = new Map<string, number>()
  const byOutfit = new Map<string, Set<string>>()
  const note = (itemId: string, distance: number) => {
    if (distance <= 2) wornRecently.set(itemId, Math.min(distance, wornRecently.get(itemId) ?? distance))
  }
  for (const e of entries) {
    note(e.itemId, daysBetween(e.date, date))
    const set = byOutfit.get(e.outfitId) ?? new Set<string>()
    set.add(e.itemId)
    byOutfit.set(e.outfitId, set)
  }
  const recentOutfits = [...byOutfit.values()].map((s) => [...s])
  const planned = (await momentsBetween(shiftDate(date, -days), shiftDate(date, days))).filter((m) => m.id !== options.excludeMomentId && !m.confirmedOutfitId && m.plannedOutfitId)
  const outfits = await db.outfits.bulkGet(planned.map((m) => m.plannedOutfitId as string))
  planned.forEach((m, i) => {
    const outfit = outfits[i]
    if (!outfit) return
    const distance = Math.abs(daysBetween(m.date, date))
    outfit.itemIds.forEach((id) => note(id, distance))
    recentOutfits.push([...outfit.itemIds])
  })
  return { wornRecently, recentOutfits }
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
}

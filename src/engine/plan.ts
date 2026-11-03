/**
 * Planning several moments in a row: one day with two outfits, or a week of
 * days. Each step is recommended with the steps before it taken as worn, so
 * the evening does not repeat the morning's shirt and Tuesday does not
 * repeat Monday. Pure: the stored wardrobe is never touched.
 */
import { emptySignals } from './context'
import { isEligible, recommend, type EngineData, type RecommendOptions } from './recommend'
import type { EngineItem, Occasion, OutfitProposal, Reason, RecommendSettings, UserSignals, WeatherWindow } from './types'

export interface PlanStep {
  /** Caller's handle (the moment id). */
  key: string
  date: string
  occasion: Occasion
  weather: WeatherWindow
  signals?: UserSignals
  /** An outfit already decided for this step: taken as worn, not recommended again. */
  fixedItemIds?: string[]
}

export interface PlanStepResult {
  key: string
  /** The chosen outfit, or null when the step was fixed or nothing could be assembled. */
  outfit: OutfitProposal | null
  alternatives: OutfitProposal[]
  reason?: Reason
}

export interface WearEvent {
  itemId: string
  date: string
}

export interface PlanHistory {
  /** Confirmed wears before the plan (the last 30 days are enough). */
  events: WearEvent[]
  /** Outfits worn in the no-repeat window. */
  recentOutfits: string[][]
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
}

/** Steps in calendar order; the caller's order breaks ties within a day. */
export function orderSteps(steps: PlanStep[]): PlanStep[] {
  return steps.map((s, i) => ({ s, i })).sort((a, b) => (a.s.date < b.s.date ? -1 : a.s.date > b.s.date ? 1 : a.i - b.i)).map(({ s }) => s)
}

export function planSequence(steps: PlanStep[], items: EngineItem[], data: EngineData, settings: RecommendSettings, history: PlanHistory, options: RecommendOptions = {}): PlanStepResult[] {
  let working = items.map((i) => ({ ...i }))
  const events = [...history.events]
  const recentOutfits = history.recentOutfits.map((o) => [...o])
  /** Dates already counted for eligible days, and per item the dates it was worn (one wear per day). */
  const countedDates = new Set<string>()
  const wornOn = new Map<string, Set<string>>()
  for (const e of events) {
    const set = wornOn.get(e.itemId) ?? new Set<string>()
    set.add(e.date)
    wornOn.set(e.itemId, set)
  }
  const results: PlanStepResult[] = []

  for (const step of orderSteps(steps)) {
    const wornRecently = new Map<string, number>()
    for (const e of events) {
      const distance = Math.abs(daysBetween(e.date, step.date))
      if (distance <= 2) wornRecently.set(e.itemId, Math.min(distance, wornRecently.get(e.itemId) ?? distance))
    }
    let chosen: string[]
    if (step.fixedItemIds) {
      chosen = [...step.fixedItemIds]
      results.push({ key: step.key, outfit: null, alternatives: [] })
    } else {
      const result = recommend(
        {
          date: step.date,
          items: working,
          weather: step.weather,
          occasion: step.occasion,
          signals: step.signals ?? emptySignals(),
          settings: { ...settings, seed: `${step.date}#${step.key}` },
          recentOutfits,
          wornRecently,
        },
        data,
        options,
      )
      const top = result.outfits[0] ?? null
      chosen = top?.itemIds ?? []
      results.push({ key: step.key, outfit: top, alternatives: result.outfits.slice(1), reason: result.reason })
    }

    // Move the counters as a check-in would: wears once per item per day,
    // eligible days once per day, so later steps see fair-share deficits shift.
    const countDay = !countedDates.has(step.date)
    countedDates.add(step.date)
    const chosenSet = new Set(chosen)
    working = working.map((item) => {
      const eligible = countDay && isEligible(item, step.weather, step.occasion, settings, data)
      const dates = wornOn.get(item.id) ?? new Set<string>()
      const firstWearToday = chosenSet.has(item.id) && !dates.has(step.date)
      if (chosenSet.has(item.id)) {
        dates.add(step.date)
        wornOn.set(item.id, dates)
      }
      return {
        ...item,
        wearCount: item.wearCount + (firstWearToday ? 1 : 0),
        lastWorn: chosenSet.has(item.id) && (!item.lastWorn || item.lastWorn < step.date) ? step.date : item.lastWorn,
        eligibleDays: item.eligibleDays + (eligible ? 1 : 0),
      }
    })
    for (const id of chosen) events.push({ itemId: id, date: step.date })
    if (chosen.length) recentOutfits.push(chosen)
  }
  return results
}

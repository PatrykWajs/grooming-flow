import type { EngineItem, RecommendSettings } from './types'
import { addDays } from './weather'

export const NEW_ITEM_DAYS = 14
export const NEW_ITEM_BOOST = 0.2
/** "Equal" is a band: within ±20 % of the peer median, or ±1 wear, whichever is larger. */
export const BALANCE_BAND = 0.2

export interface RotationDetail {
  score: number
  expected: number
  deficit: number
  balanced: boolean
  cooldown: boolean
  isNew: boolean
}

export type PeerGroup = 'role' | 'category'

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  return Math.round((b - a) / 86400000)
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function groupItems(items: EngineItem[], by: PeerGroup): Map<string, EngineItem[]> {
  const groups = new Map<string, EngineItem[]>()
  for (const item of items) {
    if (item.status !== 'active') continue
    const key = by === 'role' ? item.role : item.category
    const list = groups.get(key) ?? []
    list.push(item)
    groups.set(key, list)
  }
  return groups
}

/**
 * Rotation fairness per item (0..1) among its peers: under-worn items score
 * high, over-worn ones low, balanced ones a flat 0.5 so style decides.
 * Peers default to items of the same role (what competes for the same slot);
 * pass the eligible items of the day to compare only what could be worn today.
 */
export function rotationScores(
  items: EngineItem[],
  settings: Pick<RecommendSettings, 'cooldownDays' | 'cooldownScore'>,
  date: string,
  peers: PeerGroup = 'role',
): Map<string, RotationDetail> {
  const result = new Map<string, RotationDetail>()
  for (const group of groupItems(items, peers).values()) {
    const totalWears = group.reduce((a, i) => a + i.wearCount, 0)
    const totalEligible = group.reduce((a, i) => a + i.eligibleDays, 0)
    const rate = totalEligible > 0 ? totalWears / totalEligible : 0
    const med = median(group.map((i) => i.wearCount))
    const tolerance = Math.max(1, BALANCE_BAND * med)

    const deficits = group.map((i) => {
      const expected = i.eligibleDays * rate * (i.wearMore ?? 1)
      return { item: i, expected, deficit: expected - i.wearCount }
    })
    const maxAbs = Math.max(1e-9, ...deficits.map((d) => Math.abs(d.deficit)))

    for (const { item, expected, deficit } of deficits) {
      const balanced = Math.abs(item.wearCount - med) <= tolerance && Math.abs(deficit) <= 1
      let score: number
      if (balanced) score = 0.5
      else if (deficit > 0) score = 0.5 + 0.5 * (deficit / maxAbs)
      else score = 0.5 - 0.5 * (-deficit / maxAbs)

      const isNew = daysBetween(item.addedAt, date) < NEW_ITEM_DAYS
      if (isNew) score = Math.min(1, score + NEW_ITEM_BOOST)
      // Nothing sits forgotten: an item never worn after two weeks of eligibility is always a strong candidate.
      if (item.wearCount === 0 && item.eligibleDays >= NEW_ITEM_DAYS) score = Math.max(score, 0.9)

      let cooldown = false
      if (item.lastWorn) {
        const since = daysBetween(item.lastWorn, date)
        const days = settings.cooldownDays[item.role] ?? 1
        if (days > 0 && since >= 1 && since <= days) {
          cooldown = true
          score = Math.min(score, settings.cooldownScore[item.role] ?? 0)
        }
      }
      result.set(item.id, { score, expected, deficit, balanced, cooldown, isNew })
    }
  }
  return result
}

/** Items under 50 % of the category median after 60 eligible days (the neglected panel). */
export function neglectedItems(items: EngineItem[]): EngineItem[] {
  const out: EngineItem[] = []
  for (const group of groupItems(items, 'category').values()) {
    const med = median(group.map((i) => i.wearCount))
    for (const item of group) {
      if (item.eligibleDays >= 60 && item.wearCount < 0.5 * med) out.push(item)
    }
  }
  return out
}

export { addDays }

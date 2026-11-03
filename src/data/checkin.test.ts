import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadEngineData } from '../engine/testing/loadData'
import { estimatedWindow } from '../engine/weather'
import { confirmMoment, createMoment, deleteMoment, unconfirmMoment, wearContext } from './checkin'
import { db, type ItemRecord, type OutfitRecord } from './db'
import { buildItem } from './items'

const data = loadEngineData()
const settings = { sneakersAtWork: true, allowSuedeInRain: false, washDefaults: { 'dress-shirt': 1, chinos: 3 } }
const office = data.occasions.occasions.find((o) => o.id === 'office')!
const evening = data.occasions.occasions.find((o) => o.id === 'evening')!
const mild = estimatedWindow('mild', 20)
const DATE = '2026-10-05'

function outfit(id: string, slots: Record<string, string>, source: OutfitRecord['source'] = 'today'): OutfitRecord {
  return { id, itemIds: Object.values(slots), slots, reason: '[]', score: 0.8, createdAt: new Date().toISOString(), source }
}

async function wardrobe(): Promise<Record<string, ItemRecord>> {
  const items = {
    shirt: buildItem(data.taxonomy, { category: 'tops', subcategory: 'dress-shirt', colourPrimary: 'white', pattern: 'solid', material: 'cotton' }),
    polo: buildItem(data.taxonomy, { category: 'tops', subcategory: 'polo', colourPrimary: 'navy', pattern: 'solid', material: 'cotton' }),
    chinos: buildItem(data.taxonomy, { category: 'bottoms', subcategory: 'chinos', colourPrimary: 'beige', pattern: 'solid', material: 'cotton' }),
    loafers: buildItem(data.taxonomy, { category: 'shoes', subcategory: 'loafers', colourPrimary: 'brown', pattern: 'solid', material: 'leather' }),
  }
  await db.items.bulkPut(Object.values(items))
  return items
}

async function itemsById(): Promise<Map<string, ItemRecord>> {
  return new Map((await db.items.toArray()).map((i) => [i.id, i]))
}

describe('check-in per moment', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('counts one wear per item per day across two moments, and undoes exactly', async () => {
    const w = await wardrobe()
    const am = await createMoment({ date: DATE, occasionId: 'office' })
    const pm = await createMoment({ date: DATE, occasionId: 'evening' })
    const o1 = outfit('o1', { base: w.shirt.id, bottoms: w.chinos.id, shoes: w.loafers.id })
    const o2 = outfit('o2', { base: w.polo.id, bottoms: w.chinos.id, shoes: w.loafers.id })
    await db.outfits.bulkPut([o1, o2])

    await confirmMoment(am.id, o1, office, mild, data, settings)
    await confirmMoment(pm.id, o2, evening, mild, data, settings)
    let items = await itemsById()
    expect(items.get(w.chinos.id)!.wearCount).toBe(1)
    expect(items.get(w.chinos.id)!.wearsSinceWash).toBe(1)
    expect(items.get(w.loafers.id)!.wearCount).toBe(1)
    expect(items.get(w.shirt.id)!.wearCount).toBe(1)
    expect(items.get(w.polo.id)!.wearCount).toBe(1)
    expect(items.get(w.shirt.id)!.status).toBe('wash') // wears before wash: 1
    expect(await db.wearEntries.where('itemId').equals(w.chinos.id).count()).toBe(2) // one entry per moment, one wear
    for (const item of items.values()) expect(item.eligibleDays, item.subcategory).toBeLessThanOrEqual(1)
    const counted = (await db.moments.toArray()).flatMap((m) => m.eligibleItemIds ?? [])
    expect(new Set(counted).size).toBe(counted.length)
    const eligibleBefore = new Map([...items.values()].map((i) => [i.id, i.eligibleDays]))

    // Undo the evening: the trousers were still worn in the morning, the polo was not.
    await unconfirmMoment(pm.id)
    items = await itemsById()
    expect(items.get(w.chinos.id)!.wearCount).toBe(1)
    expect(items.get(w.chinos.id)!.lastWorn).toBe(DATE)
    expect(items.get(w.polo.id)!.wearCount).toBe(0)
    expect(items.get(w.polo.id)!.lastWorn).toBeNull()
    expect(await db.wearEntries.where('date').equals(DATE).count()).toBe(3)
    // Eligible days counted by the morning stay; what the evening counted is reversed.
    const pmCounted = new Set((await db.moments.get(am.id))!.eligibleItemIds)
    for (const item of items.values()) expect(item.eligibleDays).toBe(pmCounted.has(item.id) ? eligibleBefore.get(item.id) : 0)

    await unconfirmMoment(am.id)
    items = await itemsById()
    for (const item of items.values()) {
      expect(item.wearCount).toBe(0)
      expect(item.eligibleDays).toBe(0)
      expect(item.lastWorn).toBeNull()
      expect(item.wearsSinceWash).toBe(0)
    }
    expect(await db.wearEntries.count()).toBe(0)
  })

  it('re-confirming a moment replaces its earlier check-in', async () => {
    const w = await wardrobe()
    const am = await createMoment({ date: DATE, occasionId: 'office' })
    const o1 = outfit('o1', { base: w.shirt.id, bottoms: w.chinos.id, shoes: w.loafers.id })
    const o2 = outfit('o2', { base: w.polo.id, bottoms: w.chinos.id, shoes: w.loafers.id })
    await db.outfits.bulkPut([o1, o2])
    await confirmMoment(am.id, o1, office, mild, data, settings)
    await confirmMoment(am.id, o2, office, mild, data, settings)
    const items = await itemsById()
    expect(items.get(w.shirt.id)!.wearCount).toBe(0)
    expect(items.get(w.polo.id)!.wearCount).toBe(1)
    expect(items.get(w.chinos.id)!.wearCount).toBe(1)
    expect(await db.wearEntries.count()).toBe(3)
  })

  it('deleting a confirmed moment reverses its counters', async () => {
    const w = await wardrobe()
    const am = await createMoment({ date: DATE, occasionId: 'office' })
    const o1 = outfit('o1', { base: w.shirt.id, bottoms: w.chinos.id, shoes: w.loafers.id })
    await db.outfits.put(o1)
    await confirmMoment(am.id, o1, office, mild, data, settings)
    await deleteMoment(am.id)
    const items = await itemsById()
    for (const item of items.values()) expect(item.wearCount).toBe(0)
    expect(await db.moments.count()).toBe(0)
    expect(await db.wearEntries.count()).toBe(0)
  })

  it('the evening sees the morning as worn today and tomorrow kept outfit as one day away', async () => {
    const w = await wardrobe()
    const am = await createMoment({ date: DATE, occasionId: 'office' })
    const pm = await createMoment({ date: DATE, occasionId: 'evening' })
    const tomorrow = await createMoment({ date: '2026-10-06', occasionId: 'office' })
    const o1 = outfit('o1', { base: w.shirt.id, bottoms: w.chinos.id, shoes: w.loafers.id })
    const o3 = outfit('o3', { base: w.polo.id, bottoms: w.chinos.id, shoes: w.loafers.id }, 'manual')
    await db.outfits.bulkPut([o1, o3])
    await confirmMoment(am.id, o1, office, mild, data, settings)
    await db.moments.update(tomorrow.id, { plannedOutfitId: o3.id })

    const ctx = await wearContext(DATE, { excludeMomentId: pm.id })
    expect(ctx.wornRecently.get(w.shirt.id)).toBe(0)
    expect(ctx.wornRecently.get(w.chinos.id)).toBe(0)
    expect(ctx.wornRecently.get(w.polo.id)).toBe(1)
    expect(ctx.recentOutfits).toHaveLength(2)

    // Tomorrow's own plan never blocks tomorrow.
    const own = await wearContext('2026-10-06', { excludeMomentId: tomorrow.id })
    expect(own.wornRecently.get(w.polo.id)).toBeUndefined()
    expect(own.wornRecently.get(w.shirt.id)).toBe(1)
  })
})

import type { Taxonomy } from '../engine/taxonomy'
import { defaultsFor, roleOf, seasonsForWarmth } from '../engine/taxonomy'
import type { EngineItem, Material, Pattern } from '../engine/types'
import { db, newId, today, type ItemRecord } from './db'

export interface NewItemInput {
  category: ItemRecord['category']
  subcategory: string
  colourPrimary: string
  colourSecondary?: string | null
  pattern: Pattern
  material: Material
  warmth?: number
  formality?: number
  brand?: string
  notes?: string
  photoBlobId?: string | null
  thumbBlobId?: string | null
  phash?: string | null
  embedding?: number[] | null
  userEdited?: string[]
  favourite?: boolean
  setId?: string | null
}

export function buildItem(taxonomy: Taxonomy, input: NewItemInput): ItemRecord {
  const defaults = defaultsFor(taxonomy, input.subcategory, input.material)
  const warmth = input.warmth ?? defaults.warmth
  return {
    id: newId(),
    category: input.category,
    subcategory: input.subcategory,
    colourPrimary: input.colourPrimary,
    colourSecondary: input.colourSecondary ?? null,
    pattern: input.pattern,
    material: input.material,
    warmth,
    formality: input.formality ?? defaults.formality,
    seasons: seasonsForWarmth(warmth),
    status: 'active',
    favourite: input.favourite ?? false,
    brand: input.brand ?? '',
    notes: input.notes ?? '',
    photoBlobId: input.photoBlobId ?? null,
    thumbBlobId: input.thumbBlobId ?? null,
    phash: input.phash ?? null,
    embedding: input.embedding ?? null,
    userEdited: input.userEdited ?? [],
    setId: input.setId ?? null,
    addedAt: today(),
    wearCount: 0,
    lastWorn: null,
    eligibleDays: 0,
    wearsSinceWash: 0,
    wearMore: 1,
  }
}

export function toEngineItem(record: ItemRecord, taxonomy: Taxonomy): EngineItem {
  return {
    id: record.id,
    category: record.category,
    subcategory: record.subcategory,
    role: roleOf(taxonomy, record.subcategory),
    colourPrimary: record.colourPrimary,
    colourSecondary: record.colourSecondary,
    pattern: record.pattern,
    material: record.material,
    warmth: record.warmth,
    formality: record.formality,
    seasons: record.seasons,
    status: record.status,
    favourite: record.favourite,
    setId: record.setId,
    wearCount: record.wearCount,
    lastWorn: record.lastWorn,
    eligibleDays: record.eligibleDays,
    addedAt: record.addedAt,
    wearMore: record.wearMore,
  }
}

export async function saveItems(records: ItemRecord[]): Promise<void> {
  await db.items.bulkPut(records)
}

/**
 * Apply a user edit: the field is remembered as user-set, so a later
 * re-classification never overwrites it.
 */
export async function userEditItem(id: string, patch: Partial<ItemRecord>): Promise<void> {
  await db.transaction('rw', db.items, async () => {
    const item = await db.items.get(id)
    if (!item) return
    const edited = new Set(item.userEdited)
    for (const key of Object.keys(patch)) edited.add(key)
    await db.items.put({ ...item, ...patch, userEdited: [...edited] })
  })
}

/** Apply model predictions without touching user-set fields. */
export function mergePrediction(item: ItemRecord, prediction: Partial<ItemRecord>): ItemRecord {
  const next = { ...item }
  for (const [key, value] of Object.entries(prediction)) {
    if (item.userEdited.includes(key)) continue
    ;(next as unknown as Record<string, unknown>)[key] = value
  }
  return next
}

export async function setStatus(id: string, status: ItemRecord['status']): Promise<void> {
  await db.items.update(id, status === 'active' ? { status, wearsSinceWash: 0 } : { status })
}

export async function deleteItem(id: string): Promise<void> {
  await db.transaction('rw', db.items, db.blobs, async () => {
    const item = await db.items.get(id)
    if (!item) return
    if (item.photoBlobId) await db.blobs.delete(item.photoBlobId)
    if (item.thumbBlobId) await db.blobs.delete(item.thumbBlobId)
    await db.items.delete(id)
  })
}

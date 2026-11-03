/**
 * Capture pipeline: photo → downscale/WebP/thumb → worker (background
 * removal, classification, pixels) → colour, hash, duplicate check → a review
 * card the user confirms. Nothing is saved until confirmation.
 */
import { aiClient } from '../ai/client'
import { decodeImage, dominantColours, draw, encode, fit, hammingDistance, perceptualHash, type ColourResult, THUMB_EDGE } from '../ai/image'
import type { Prediction } from '../ai/protocol'
import { db, newId, type IntakeRecord, type ItemFields, type ItemRecord } from '../data/db'
import { buildItem, type NewItemInput } from '../data/items'
import type { EngineData } from '../engine/recommend'
import { defaultsFor, findSubcategory } from '../engine/taxonomy'
import type { CategoryId, Material, Pattern } from '../engine/types'

export type EditableFields = ItemFields

export interface ReviewCard {
  id: string
  /** The picked photo (a File, or the blob restored from the queue on disk). */
  source: Blob
  name: string
  status: 'queued' | 'processing' | 'ready' | 'error' | 'saved' | 'discarded'
  error?: string
  photo?: Blob
  thumb?: Blob
  thumbUrl?: string
  prediction?: Prediction
  colour?: ColourResult
  phash?: string
  embedding?: number[]
  fields?: EditableFields
  userEdited: Set<string>
  duplicateOf?: ItemRecord | null
  timings?: Record<string, number>
}

export function newCard(file: File): ReviewCard {
  return { id: newId(), source: file, name: file.name, status: 'queued', userEdited: new Set() }
}

/** A card rebuilt from the queue on disk after a reload (the thumbnail URL is the screen's job). */
export function cardFromIntake(record: IntakeRecord, existing: ItemRecord[]): ReviewCard {
  const base: ReviewCard = { id: record.id, source: record.source ?? new Blob(), name: record.name, status: 'queued', userEdited: new Set(record.userEdited) }
  if (record.status === 'error') return { ...base, status: 'error', error: record.error ?? 'error' }
  if (record.status === 'ready' && record.fields && record.photo && record.thumb) {
    return {
      ...base,
      status: 'ready',
      photo: record.photo,
      thumb: record.thumb,
      prediction: record.prediction ?? undefined,
      colour: record.colour ?? undefined,
      phash: record.phash ?? undefined,
      embedding: record.embedding ?? undefined,
      fields: record.fields,
      duplicateOf: record.duplicateOfId ? (existing.find((i) => i.id === record.duplicateOfId) ?? null) : null,
    }
  }
  return base
}

/** What the queue on disk keeps of a processed card. */
export function intakeResult(card: ReviewCard): Partial<IntakeRecord> & { status: IntakeRecord['status'] } {
  return {
    status: card.status === 'ready' ? 'ready' : 'error',
    photo: card.photo ?? null,
    thumb: card.thumb ?? null,
    prediction: card.prediction ?? null,
    colour: card.colour ?? null,
    phash: card.phash ?? null,
    embedding: card.embedding ?? null,
    fields: card.fields ?? null,
    userEdited: [...card.userEdited],
    duplicateOfId: card.duplicateOf?.id ?? null,
    error: card.error ?? null,
  }
}

export const MAX_BATCH = 50
const DUPLICATE_HAMMING = 6
const DUPLICATE_COSINE = 0.965
const KNN_MIN_COSINE = 0.78
const KNN_K = 5

function cosine(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) dot += a[i] * b[i]
  return dot
}

/**
 * Blend the zero-shot subcategory scores with the user's own confirmed items:
 * nearest neighbours among existing embeddings vote with their subcategory.
 */
export function blendWithNeighbours(prediction: Prediction, existing: ItemRecord[]): { subcategory: string; category: CategoryId; confidence: number; neighbours: ItemRecord[] } {
  const scores = new Map<string, number>(prediction.subcategory.map((s) => [s.id, 0.6 * s.score]))
  const withEmbedding = existing.filter((i) => i.embedding && i.embedding.length === prediction.embedding.length)
  const neighbours = withEmbedding
    .map((item) => ({ item, sim: cosine(prediction.embedding, item.embedding!) }))
    .filter((n) => n.sim >= KNN_MIN_COSINE)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, KNN_K)
  if (neighbours.length >= 2) {
    const total = neighbours.reduce((a, n) => a + n.sim, 0)
    for (const n of neighbours) scores.set(n.item.subcategory, (scores.get(n.item.subcategory) ?? 0) + 0.4 * (n.sim / total))
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1])
  const [subcategory, confidence] = ranked[0] ?? [prediction.subcategory[0]?.id ?? 't-shirt', 0]
  return { subcategory, category: categoryOf(subcategory, existing) , confidence, neighbours: neighbours.map((n) => n.item) }
}

let taxonomyRef: EngineData['taxonomy'] | null = null
function categoryOf(subcategory: string, _existing: ItemRecord[]): CategoryId {
  const found = taxonomyRef ? findSubcategory(taxonomyRef, subcategory) : null
  return (found?.category.id ?? 'tops') as CategoryId
}

export function findDuplicate(card: Pick<ReviewCard, 'phash' | 'embedding'>, existing: ItemRecord[]): ItemRecord | null {
  for (const item of existing) {
    if (card.phash && item.phash && hammingDistance(card.phash, item.phash) <= DUPLICATE_HAMMING) return item
    if (card.embedding && item.embedding && item.embedding.length === card.embedding.length && cosine(card.embedding, item.embedding) >= DUPLICATE_COSINE) return item
  }
  return null
}

export async function processCard(card: ReviewCard, data: EngineData, existing: ItemRecord[], removeBackground: boolean): Promise<ReviewCard> {
  taxonomyRef = data.taxonomy
  const next: ReviewCard = { ...card, status: 'processing' }
  try {
    const bitmap = await decodeImage(card.source)
    const [w, h] = fit(bitmap.width, bitmap.height, 1280)
    const canvas = draw(bitmap, w, h)
    bitmap.close()
    const workerBitmap = await createImageBitmap(canvas as unknown as ImageBitmapSource)
    const result = await aiClient.classify(card.id, workerBitmap, removeBackground)

    // The display photo is the cutout when the background was removed.
    let photoSource: CanvasImageSource = canvas as unknown as CanvasImageSource
    if (result.cutout) {
      const cut = await createImageBitmap(result.cutout)
      photoSource = cut
    }
    const photoCanvas = draw(photoSource, w, h)
    const photo = await encode(photoCanvas)
    const [tw, th] = fit(w, h, THUMB_EDGE)
    const thumb = await encode(draw(photoCanvas as unknown as CanvasImageSource, tw, th), 'image/webp', 0.8)
    if ('close' in photoSource && typeof (photoSource as ImageBitmap).close === 'function') (photoSource as ImageBitmap).close()

    const colour = dominantColours(result.colourPixels, data.palette, !!result.cutout)
    const phash = perceptualHash(result.hashPixels)
    const blended = blendWithNeighbours(result.prediction, existing)
    const material = (result.prediction.material[0]?.score ?? 0) >= 0.35 ? (result.prediction.material[0].id as Material) : 'cotton'
    const pattern = (result.prediction.pattern[0]?.id as Pattern) ?? 'solid'
    const defaults = defaultsFor(data.taxonomy, blended.subcategory, material)
    const fields: EditableFields = {
      category: blended.category,
      subcategory: blended.subcategory,
      colourPrimary: colour.primary,
      colourSecondary: colour.secondary,
      pattern,
      material,
      warmth: defaults.warmth,
      formality: defaults.formality,
      brand: '',
      notes: '',
    }
    const duplicateOf = findDuplicate({ phash, embedding: result.prediction.embedding }, existing)
    return {
      ...next,
      status: 'ready',
      photo,
      thumb,
      thumbUrl: URL.createObjectURL(thumb),
      prediction: result.prediction,
      colour,
      phash,
      embedding: result.prediction.embedding,
      fields,
      duplicateOf,
      timings: result.timings,
    }
  } catch (error) {
    const message = (error as Error).message ?? String(error)
    return { ...next, status: 'error', error: message }
  }
}

/** Re-derive defaults when the user changes the type (warmth/formality unless edited). */
export function applySubcategoryChange(card: ReviewCard, subcategory: string, data: EngineData): ReviewCard {
  if (!card.fields) return card
  const found = findSubcategory(data.taxonomy, subcategory)
  const defaults = defaultsFor(data.taxonomy, subcategory, card.fields.material)
  const fields = { ...card.fields, subcategory, category: (found?.category.id ?? card.fields.category) as CategoryId }
  if (!card.userEdited.has('warmth')) fields.warmth = defaults.warmth
  if (!card.userEdited.has('formality')) fields.formality = defaults.formality
  return { ...card, fields, userEdited: new Set([...card.userEdited, 'subcategory', 'category']) }
}

export async function saveCard(card: ReviewCard, data: EngineData): Promise<ItemRecord> {
  if (!card.fields || !card.photo || !card.thumb) throw new Error('card not ready')
  const photoBlobId = newId()
  const thumbBlobId = newId()
  const input: NewItemInput = {
    ...card.fields,
    photoBlobId,
    thumbBlobId,
    phash: card.phash ?? null,
    embedding: card.embedding ?? null,
    userEdited: [...card.userEdited],
  }
  const record = buildItem(data.taxonomy, input)
  await db.transaction('rw', db.items, db.blobs, db.settings, async () => {
    await db.blobs.put({ id: photoBlobId, mime: card.photo!.type, bytes: card.photo! })
    await db.blobs.put({ id: thumbBlobId, mime: card.thumb!.type, bytes: card.thumb! })
    await db.items.put(record)
    const settings = await db.settings.get('settings')
    if (settings) await db.settings.put({ ...settings, itemsSinceBackup: (settings.itemsSinceBackup ?? 0) + 1 })
  })
  return record
}

/** Request persistent storage on the first save (the brief: not before). */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return null
  }
}

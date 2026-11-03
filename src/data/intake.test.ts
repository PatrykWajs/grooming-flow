import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { intakeAll, intakeDone, intakeDuplicate, intakeFields, intakeFinish, intakeStart } from './intake'

const fields = { category: 'tops' as const, subcategory: 'polo', colourPrimary: 'navy', colourSecondary: null, pattern: 'solid' as const, material: 'cotton' as const, warmth: 2, formality: 3, brand: '', notes: '' }

describe('add queue on disk', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('keeps a picked photo until its card is confirmed or discarded', async () => {
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
    await intakeStart('a', file, 'IMG_1.jpg')
    await intakeStart('b', file, 'IMG_2.jpg')
    let rows = await intakeAll()
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
    expect(rows[0].status).toBe('queued')
    expect(rows[0].source?.size).toBe(3)

    // Processed: the result is stored, the original dropped.
    const thumb = new Blob([new Uint8Array(10)], { type: 'image/webp' })
    await intakeFinish('a', { status: 'ready', photo: thumb, thumb, phash: 'abcd', embedding: [0.1, 0.2], fields, duplicateOfId: null, error: null })
    rows = await intakeAll()
    expect(rows[0].status).toBe('ready')
    expect(rows[0].source).toBeNull()
    expect(rows[0].thumb?.size).toBe(10)
    expect(rows[0].fields?.subcategory).toBe('polo')

    // The user's edits survive too.
    await intakeFields('a', { ...fields, subcategory: 'henley' }, ['subcategory'])
    await intakeDuplicate('a', 'item-9')
    rows = await intakeAll()
    expect(rows[0].fields?.subcategory).toBe('henley')
    expect(rows[0].userEdited).toEqual(['subcategory'])
    expect(rows[0].duplicateOfId).toBe('item-9')

    // Gone once confirmed or discarded.
    await intakeDone('a')
    expect((await intakeAll()).map((r) => r.id)).toEqual(['b'])
    await intakeDone('b')
    expect(await intakeAll()).toHaveLength(0)
  })

  it('an unsupported photo stays as an error card until discarded', async () => {
    await intakeStart('x', new Blob([new Uint8Array(1)]), 'file.heic')
    await intakeFinish('x', { status: 'error', error: 'UNSUPPORTED_IMAGE:image/heic' })
    const [row] = await intakeAll()
    expect(row.status).toBe('error')
    expect(row.error).toContain('UNSUPPORTED_IMAGE')
    expect(row.source).toBeNull()
  })
})

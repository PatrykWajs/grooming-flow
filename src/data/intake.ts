/**
 * The add queue on disk. Every picked photo is written before it is processed
 * and deleted only when the user confirms or discards its card, so whatever
 * reloads the page (a crash, the camera on iPhone, a new build, a pull down)
 * the Add screen resumes with the same cards.
 */
import { db, nowIso, type IntakeRecord, type ItemFields } from './db'

export async function intakeStart(id: string, source: Blob, name: string): Promise<void> {
  await db.intake.put({
    id,
    createdAt: nowIso(),
    status: 'queued',
    source,
    name,
    photo: null,
    thumb: null,
    prediction: null,
    colour: null,
    phash: null,
    embedding: null,
    fields: null,
    userEdited: [],
    duplicateOfId: null,
    error: null,
  })
}

/** The processing result; the picked file is dropped (the cutout is what gets saved). */
export async function intakeFinish(id: string, result: Partial<Omit<IntakeRecord, 'id' | 'createdAt' | 'source' | 'name'>> & { status: IntakeRecord['status'] }): Promise<void> {
  await db.transaction('rw', db.intake, async () => {
    const current = await db.intake.get(id)
    if (!current) return
    await db.intake.put({ ...current, ...result, source: null })
  })
}

export async function intakeFields(id: string, fields: ItemFields, userEdited: string[]): Promise<void> {
  await db.intake.update(id, { fields, userEdited })
}

export async function intakeDuplicate(id: string, duplicateOfId: string | null): Promise<void> {
  await db.intake.update(id, { duplicateOfId })
}

export async function intakeDone(id: string): Promise<void> {
  await db.intake.delete(id)
}

/** Everything still in the queue, oldest first. */
export async function intakeAll(): Promise<IntakeRecord[]> {
  return db.intake.orderBy('createdAt').toArray()
}

export async function intakeCount(): Promise<number> {
  return db.intake.count()
}

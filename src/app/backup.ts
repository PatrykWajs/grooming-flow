/**
 * Backup: one zip with the records as JSON and every photo blob. Restore
 * merges by id, so a backup can be imported on another device without
 * collisions. Uses fflate (store-only for images, they are already compressed).
 */
import { strFromU8, strToU8, unzip, zip, type Unzipped, type Zippable } from 'fflate'
import { db, momentFromDayPlan, nowIso, updateSettings, type BlobRecord, type LegacyDayPlanRecord, type MomentRecord } from '../data/db'

/** 1: one `dayPlans` row per date. 2: `moments` (several outfits per day). A v1 file still restores. */
export const BACKUP_VERSION = 2
const APP = 'groomingflow'

interface BackupData {
  app: typeof APP
  version: number
  exportedAt: string
  items: unknown[]
  outfits: unknown[]
  moments?: MomentRecord[]
  /** v1 files only. */
  dayPlans?: LegacyDayPlanRecord[]
  wearEntries: unknown[]
  occasions: unknown[]
  settings: unknown[]
  preferences: unknown[]
  blobs: { id: string; mime: string; file: string }[]
}

function extensionFor(mime: string): string {
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('png')) return 'png'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  return 'bin'
}

export async function exportBackup(): Promise<{ blob: Blob; filename: string; items: number }> {
  const [items, outfits, moments, wearEntries, occasions, settings, preferences, blobs] = await Promise.all([
    db.items.toArray(),
    db.outfits.toArray(),
    db.moments.toArray(),
    db.wearEntries.toArray(),
    db.occasions.toArray(),
    db.settings.toArray(),
    db.preferences.toArray(),
    db.blobs.toArray(),
  ])
  const files: Zippable = {}
  const blobIndex: BackupData['blobs'] = []
  for (const b of blobs) {
    const file = `blobs/${b.id}.${extensionFor(b.mime)}`
    files[file] = [new Uint8Array(await b.bytes.arrayBuffer()), { level: 0 }]
    blobIndex.push({ id: b.id, mime: b.mime, file })
  }
  const data: BackupData = { app: APP, version: BACKUP_VERSION, exportedAt: nowIso(), items, outfits, moments, wearEntries, occasions, settings, preferences, blobs: blobIndex }
  files['data.json'] = [strToU8(JSON.stringify(data)), { level: 6 }]
  const zipped = await new Promise<Uint8Array>((resolve, reject) => zip(files, (err, out) => (err ? reject(err) : resolve(out))))
  const date = new Date().toISOString().slice(0, 10)
  await updateSettings({ lastBackupAt: nowIso(), itemsSinceBackup: 0 })
  return { blob: new Blob([zipped as BlobPart], { type: 'application/zip' }), filename: `groomingflow-backup-${date}.zip`, items: items.length }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

export async function importBackup(file: Blob): Promise<{ items: number; days: number }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const unzipped = await new Promise<Unzipped>((resolve, reject) => unzip(bytes, (err, out) => (err ? reject(err) : resolve(out))))
  const dataFile = unzipped['data.json']
  if (!dataFile) throw new Error('not a Grooming Flow backup (data.json missing)')
  const data = JSON.parse(strFromU8(dataFile)) as BackupData
  if (data.app !== APP) throw new Error('not a Grooming Flow backup')
  if (data.version > BACKUP_VERSION) throw new Error(`backup version ${data.version} is newer than this app`)
  const blobRecords: BlobRecord[] = []
  for (const b of data.blobs) {
    const content = unzipped[b.file]
    if (!content) continue
    blobRecords.push({ id: b.id, mime: b.mime, bytes: new Blob([content as BlobPart], { type: b.mime }) })
  }
  const moments: MomentRecord[] = data.moments ?? (data.dayPlans ?? []).map(momentFromDayPlan)
  await db.transaction('rw', [db.items, db.outfits, db.moments, db.wearEntries, db.occasions, db.settings, db.preferences, db.blobs], async () => {
    await db.blobs.bulkPut(blobRecords)
    await db.items.bulkPut(data.items as never[])
    await db.outfits.bulkPut(data.outfits as never[])
    await db.moments.bulkPut(moments)
    await db.wearEntries.bulkPut(data.wearEntries as never[])
    await db.occasions.bulkPut(data.occasions as never[])
    await db.preferences.bulkPut(data.preferences as never[])
    const settings = (data.settings as { id: string }[]).find((s) => s.id === 'settings')
    if (settings) await db.settings.put({ ...settings, id: 'settings' } as never)
  })
  return { items: data.items.length, days: new Set(moments.map((m) => m.date)).size }
}

export async function deleteEverything(): Promise<void> {
  await db.delete()
  await db.open()
}

export async function storageEstimate(): Promise<{ usedMB: number; quotaMB: number } | null> {
  try {
    const e = await navigator.storage.estimate()
    return { usedMB: Math.round((e.usage ?? 0) / 1048576), quotaMB: Math.round((e.quota ?? 0) / 1048576) }
  } catch {
    return null
  }
}

export async function clearModelCache(): Promise<number> {
  if (!('caches' in globalThis)) return 0
  let cleared = 0
  for (const key of await caches.keys()) {
    if (/transformers|onnx|huggingface/i.test(key)) {
      await caches.delete(key)
      cleared++
    }
  }
  return cleared
}

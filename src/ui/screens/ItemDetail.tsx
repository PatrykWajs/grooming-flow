import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { aiClient } from '../../ai/client'
import { blendWithNeighbours, type EditableFields } from '../../app/addItems'
import { db, type ItemRecord } from '../../data/db'
import { deleteItem, mergePrediction, setStatus, userEditItem } from '../../data/items'
import { defaultsFor } from '../../engine/taxonomy'
import { Button, Card, Chip, Screen } from '../components'
import { FieldEditor } from '../FieldEditor'
import { formatDate, useBlobUrl, useEngineData, useLabel, useSettings } from '../hooks'
import { navigate } from '../router'
import { useAppStore } from '../store'

export function ItemDetail({ id }: { id: string }) {
  const { t } = useTranslation()
  const data = useEngineData()
  const settings = useSettings()
  const label = useLabel()
  const toast = useAppStore((s) => s.toast)
  const item = useLiveQuery(() => db.items.get(id), [id])
  const wears = useLiveQuery(() => db.wearEntries.where('itemId').equals(id).reverse().sortBy('date'), [id])
  const url = useBlobUrl(item?.photoBlobId ?? item?.thumbBlobId)
  const [busy, setBusy] = useState(false)

  if (!item || !data) return <Screen title={t('item.title')}><p className="text-sm text-[var(--muted)]">{t('common.loading')}</p></Screen>

  const fields: EditableFields = {
    category: item.category,
    subcategory: item.subcategory,
    colourPrimary: item.colourPrimary,
    colourSecondary: item.colourSecondary,
    pattern: item.pattern,
    material: item.material,
    warmth: item.warmth,
    formality: item.formality,
    brand: item.brand,
    notes: item.notes,
  }

  async function onChange(patch: Partial<EditableFields>, field: keyof EditableFields) {
    const next: Partial<ItemRecord> = { ...patch }
    if (field === 'subcategory' && patch.subcategory) {
      const d = defaultsFor(data!.taxonomy, patch.subcategory, item!.material)
      if (!item!.userEdited.includes('warmth')) next.warmth = d.warmth
      if (!item!.userEdited.includes('formality')) next.formality = d.formality
    }
    await userEditItem(id, next)
  }

  async function reclassify() {
    if (!item?.photoBlobId) return
    setBusy(true)
    try {
      const blob = await db.blobs.get(item.photoBlobId)
      if (!blob) return
      const bitmap = await createImageBitmap(blob.bytes)
      const result = await aiClient.classify(`re-${id}`, bitmap, false)
      const existing = (await db.items.toArray()).filter((i) => i.id !== id)
      const blended = blendWithNeighbours(result.prediction, existing)
      const merged = mergePrediction(item, {
        subcategory: blended.subcategory,
        category: blended.category,
        pattern: result.prediction.pattern[0]?.id as ItemRecord['pattern'],
        material: (result.prediction.material[0]?.score ?? 0) >= 0.35 ? (result.prediction.material[0].id as ItemRecord['material']) : item.material,
        embedding: result.prediction.embedding,
      })
      await db.items.put(merged)
      toast(t('item.reclassified'), 'success')
    } catch (error) {
      toast(`${t('add.error')}: ${(error as Error).message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm(t('item.deleteConfirm'))) return
    await deleteItem(id)
    navigate({ name: 'wardrobe' })
  }

  return (
    <Screen
      title={label.itemName(item)}
      action={
        <Button tone="ghost" onClick={() => navigate({ name: 'wardrobe' })}>
          {t('common.back')}
        </Button>
      }
    >
      <Card className="mb-4 flex justify-center">
        {url ? <img src={url} alt={label.itemName(item)} className="max-h-72 rounded-xl object-contain" /> : <span className="text-sm text-[var(--muted)]">{label.subcategory(item.subcategory)}</span>}
      </Card>

      <Card className="mb-4">
        <div className="flex flex-wrap gap-2">
          {(['active', 'wash', 'stored', 'retired'] as const).map((s) => (
            <Chip key={s} active={item.status === s} onClick={() => void setStatus(id, s)}>
              {t(`wardrobe.status.${s}`)}
            </Chip>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip active={item.favourite} onClick={() => void userEditItem(id, { favourite: !item.favourite })}>
            ♥ {t('item.favourite')}
          </Chip>
          <Chip active={item.wearMore > 1} onClick={() => void userEditItem(id, { wearMore: item.wearMore > 1 ? 1 : 1.5 })}>
            {t('item.wearMore')}
          </Chip>
        </div>
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
          <dt className="text-[var(--muted)]">{t('item.timeline')}</dt>
          <dd>{item.wearCount === 0 ? t('item.neverWorn') : t('item.wornTimes', { count: item.wearCount })}</dd>
          {item.lastWorn && (
            <>
              <dt className="text-[var(--muted)]">{t('item.lastWorn', { date: '' })}</dt>
              <dd>{formatDate(item.lastWorn, label.lang, { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
            </>
          )}
          <dt className="text-[var(--muted)]">{t('item.added', { date: '' })}</dt>
          <dd>{formatDate(item.addedAt, label.lang, { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
          <dt className="text-[var(--muted)]">{t('item.eligible', { count: item.eligibleDays })}</dt>
          <dd />
        </dl>
        {wears && wears.length > 0 && (
          <p className="mt-2 text-xs text-[var(--muted)]">{wears.slice(0, 12).map((w) => formatDate(w.date, label.lang, { day: 'numeric', month: 'short' })).join(' · ')}</p>
        )}
      </Card>

      <Card className="mb-4">
        <FieldEditor fields={fields} data={data} onChange={(patch, field) => void onChange(patch, field)} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button tone="secondary" onClick={() => void reclassify()} disabled={busy || !item.photoBlobId || !settings}>
            {t('item.reclassify')}
          </Button>
          <Button tone="danger" onClick={() => void remove()}>
            {t('item.delete')}
          </Button>
        </div>
      </Card>
    </Screen>
  )
}

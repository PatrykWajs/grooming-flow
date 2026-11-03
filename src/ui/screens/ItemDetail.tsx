import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db, type ItemRecord } from '../../data/db'
import { deleteItem, setStatus, userEditItem } from '../../data/items'
import { defaultsFor } from '../../engine/taxonomy'
import type { CategoryId } from '../../engine/types'
import { Button, Card, Chip, Screen, Sheet } from '../components'
import { formatDate, useBlobUrl, useEngineData, useLabel } from '../hooks'
import { navigate } from '../router'
import { TypeColourEditor } from '../TypeColourEditor'

/** One item: its photo on white, in the wash or not, how often it was worn, change its type or colour, delete. */
export function ItemDetail({ id }: { id: string }) {
  const { t } = useTranslation()
  const data = useEngineData()
  const label = useLabel()
  const item = useLiveQuery(() => db.items.get(id), [id])
  const url = useBlobUrl(item?.photoBlobId ?? item?.thumbBlobId)
  const [editing, setEditing] = useState(false)

  if (!item || !data) {
    return (
      <Screen title={t('item.title')}>
        <p className="text-sm text-[var(--muted)]">{t('common.loading')}</p>
      </Screen>
    )
  }

  async function onType(subcategory: string, category: CategoryId) {
    const next: Partial<ItemRecord> = { subcategory, category }
    const d = defaultsFor(data!.taxonomy, subcategory, item!.material)
    if (!item!.userEdited.includes('warmth')) next.warmth = d.warmth
    if (!item!.userEdited.includes('formality')) next.formality = d.formality
    await userEditItem(id, next)
  }

  async function remove() {
    if (!confirm(t('item.deleteConfirm'))) return
    await deleteItem(id)
    navigate({ name: 'wardrobe' })
  }

  const inWash = item.status === 'wash'

  return (
    <Screen
      title={label.itemName(item)}
      action={
        <Button tone="ghost" onClick={() => navigate({ name: 'wardrobe' })}>
          {t('common.back')}
        </Button>
      }
    >
      <div className="mb-4 flex justify-center overflow-hidden rounded-2xl border border-[var(--line)] bg-white p-2">
        {url ? <img src={url} alt={label.itemName(item)} className="max-h-80 object-contain" /> : <span className="py-10 text-sm text-[var(--muted)]">{label.subcategory(item.subcategory)}</span>}
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap gap-2">
          <Chip active={inWash} onClick={() => void setStatus(id, inWash ? 'active' : 'wash')}>
            {t('item.inWash')}
          </Chip>
          <Button tone="secondary" onClick={() => setEditing(true)}>
            {t('item.change')}
          </Button>
        </div>
        <p className="mt-3 text-sm text-[var(--muted)]">
          {item.wearCount === 0 ? t('item.neverWorn') : t('item.wornTimes', { count: item.wearCount })}
          {item.lastWorn && ` · ${t('item.lastWorn', { date: formatDate(item.lastWorn, label.lang, { day: 'numeric', month: 'short' }) })}`}
        </p>
      </Card>

      <Button tone="danger" onClick={() => void remove()}>
        {t('item.delete')}
      </Button>

      <Sheet open={editing} onClose={() => setEditing(false)} title={t('item.change')}>
        <TypeColourEditor subcategory={item.subcategory} colour={item.colourPrimary} data={data} onType={(sub, category) => void onType(sub, category)} onColour={(colourPrimary) => void userEditItem(id, { colourPrimary })} />
        <Button className="mb-2" onClick={() => setEditing(false)}>
          {t('common.done')}
        </Button>
      </Sheet>
    </Screen>
  )
}

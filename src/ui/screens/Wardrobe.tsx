import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { daysBetween } from '../../data/checkin'
import { db, today, type ItemRecord } from '../../data/db'
import { setStatus } from '../../data/items'
import { Button, Card, Chip, Empty, ItemThumb, Screen } from '../components'
import { useEngineData, useItems, useLabel } from '../hooks'
import { navigate } from '../router'

export function Wardrobe() {
  const { t } = useTranslation()
  const label = useLabel()
  const data = useEngineData()
  const items = useItems()
  const [category, setCategory] = useState<string>('all')
  const [status, setStatus_] = useState<string>('all')
  const [colour, setColour] = useState<string>('all')

  const filtered = useMemo(() => {
    if (!items) return []
    return items
      .filter((i) => (category === 'all' ? true : i.category === category))
      .filter((i) => (status === 'all' ? i.status !== 'retired' : i.status === status))
      .filter((i) => (colour === 'all' ? true : i.colourPrimary === colour))
      .sort((a, b) => (a.category === b.category ? a.subcategory.localeCompare(b.subcategory) : a.category.localeCompare(b.category)))
  }, [items, category, status, colour])

  const inWash = items?.filter((i) => i.status === 'wash') ?? []
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const i of items ?? []) if (i.status !== 'retired') map.set(i.category, (map.get(i.category) ?? 0) + 1)
    return map
  }, [items])

  const action = (
    <Button onClick={() => navigate({ name: 'add' })}>＋ {t('wardrobe.add')}</Button>
  )

  if (!items || !data) return <Screen title={t('wardrobe.title')} action={action}><p className="text-sm text-[var(--muted)]">{t('common.loading')}</p></Screen>
  if (items.length === 0) {
    return (
      <Screen title={t('wardrobe.title')}>
        <Empty title={t('wardrobe.empty.title')} body={t('wardrobe.empty.body')} cta={t('wardrobe.empty.cta')} onCta={() => navigate({ name: 'add' })} />
      </Screen>
    )
  }

  const badgeFor = (item: ItemRecord) => {
    if (item.status === 'wash') return t('wardrobe.badge.wash')
    if (item.status === 'stored') return t('wardrobe.badge.stored')
    if (daysBetween(item.addedAt, today()) < 14) return t('wardrobe.badge.new')
    return null
  }

  return (
    <Screen title={t('wardrobe.title')} action={action}>
      <p className="mb-3 text-sm text-[var(--muted)]">{t('wardrobe.count', { count: items.filter((i) => i.status !== 'retired').length })}</p>
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t('wardrobe.filter.category')}>
        <Chip active={category === 'all'} onClick={() => setCategory('all')}>
          {t('common.all')}
        </Chip>
        {data.taxonomy.categories.map((c) => (
          <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
            {label.category(c.id)} {counts.get(c.id) ? `· ${counts.get(c.id)}` : ''}
          </Chip>
        ))}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <select className="min-h-11 rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 text-sm" value={status} onChange={(e) => setStatus_(e.target.value)} aria-label={t('wardrobe.filter.status')}>
          <option value="all">{t('wardrobe.filter.status')}: {t('common.all')}</option>
          {(['active', 'wash', 'stored', 'retired'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`wardrobe.status.${s}`)}
            </option>
          ))}
        </select>
        <select className="min-h-11 rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 text-sm" value={colour} onChange={(e) => setColour(e.target.value)} aria-label={t('wardrobe.filter.colour')}>
          <option value="all">{t('wardrobe.filter.colour')}: {t('common.all')}</option>
          {data.palette.colours.map((c) => (
            <option key={c.id} value={c.id}>
              {label.colour(c.id)}
            </option>
          ))}
        </select>
      </div>

      {inWash.length > 0 && status === 'all' && (
        <Card className="mb-4 flex items-center justify-between gap-3">
          <span className="text-sm">{t('wardrobe.inWash', { count: inWash.length })}</span>
          <Button tone="secondary" onClick={() => void db.transaction('rw', db.items, () => Promise.all(inWash.map((i) => setStatus(i.id, 'active'))))}>
            {t('wardrobe.markAllClean')}
          </Button>
        </Card>
      )}

      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {filtered.map((item) => {
          const badge = badgeFor(item)
          return (
            <li key={item.id} className="flex flex-col items-center gap-1">
              <ItemThumb
                item={item}
                size="md"
                onClick={() => navigate({ name: 'item', id: item.id })}
                badge={badge ? <span className="rounded-full bg-[var(--fg)] px-1.5 text-[10px] text-[var(--bg)]">{badge}</span> : undefined}
              />
              <span className="line-clamp-1 text-center text-[11px] text-[var(--muted)]">{label.itemName(item)}</span>
            </li>
          )
        })}
      </ul>
    </Screen>
  )
}

import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { rateMoment, resolveWindow } from '../../app/today'
import { db, today, type MomentRecord, type OutfitRecord } from '../../data/db'
import { Button, Card, ItemThumb, Screen, Sheet } from '../components'
import { formatDate, useEngineData, useItems, useLabel } from '../hooks'
import { OutfitCard } from '../OutfitCard'

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function History() {
  const { t } = useTranslation()
  const label = useLabel()
  const data = useEngineData()
  const items = useItems()
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [selected, setSelected] = useState<string | null>(null)
  const key = monthKey(month)
  const moments = useLiveQuery(() => db.moments.where('date').between(`${key}-01`, `${key}-32`, true, true).toArray(), [key])
  const confirmed = useMemo(() => (moments ?? []).filter((m) => m.confirmedOutfitId).sort((a, b) => (a.confirmedAt ?? '').localeCompare(b.confirmedAt ?? '')), [moments])
  const outfitIds = useMemo(() => confirmed.map((m) => m.confirmedOutfitId as string), [confirmed])
  const outfits = useLiveQuery(async (): Promise<OutfitRecord[]> => (outfitIds.length ? db.outfits.where('id').anyOf(outfitIds).toArray() : []), [outfitIds.join(',')])
  const totalLogged = useLiveQuery(async () => {
    const all = await db.moments.filter((m) => !!m.confirmedOutfitId).toArray()
    return new Set(all.map((m) => m.date)).size
  }, [])
  const itemsById = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items])
  const outfitsById = useMemo(() => new Map((outfits ?? []).map((o) => [o.id, o])), [outfits])
  const byDate = useMemo(() => {
    const map = new Map<string, MomentRecord[]>()
    for (const m of confirmed) map.set(m.date, [...(map.get(m.date) ?? []), m])
    return map
  }, [confirmed])

  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const offset = (first.getDay() + 6) % 7 // Monday first
  const cells: (string | null)[] = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${key}-${String(i + 1).padStart(2, '0')}`)]
  const monthLabel = new Intl.DateTimeFormat(label.lang === 'el' ? 'el-GR' : 'en-GB', { month: 'long', year: 'numeric' }).format(month)
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((d) => t(`weekday.${d}`).slice(0, 2))

  function hoursOf(m: MomentRecord): string {
    const occasion = data?.occasions.occasions.find((o) => o.id === m.occasionId)
    if (!occasion) return ''
    const [start, end] = resolveWindow(m, occasion)
    return `${start}–${end}`
  }

  const selectedMoments = selected ? (byDate.get(selected) ?? []) : []

  return (
    <Screen title={t('history.title')}>
      <p className="mb-3 text-sm text-[var(--muted)]">{totalLogged ? t('history.logged', { count: totalLogged }) : t('history.empty')}</p>
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <button type="button" className="min-h-11 min-w-11" aria-label={t('history.prev')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            ‹
          </button>
          <h2 className="font-semibold">{monthLabel}</h2>
          <button type="button" className="min-h-11 min-w-11" aria-label={t('history.next')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-[var(--muted)]">
          {weekdays.map((w, i) => (
            <span key={i}>{w}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((date, i) => {
            if (!date) return <span key={`e${i}`} />
            const dayMoments = byDate.get(date) ?? []
            const firstOutfit = dayMoments[0]?.confirmedOutfitId ? outfitsById.get(dayMoments[0].confirmedOutfitId as string) : undefined
            const firstItem = firstOutfit ? itemsById.get(firstOutfit.slots.base ?? firstOutfit.itemIds[0]) : undefined
            const isFuture = date > today()
            return (
              <button
                key={date}
                type="button"
                disabled={isFuture}
                onClick={() => setSelected(date)}
                aria-label={`${formatDate(date, label.lang)}${dayMoments.length ? `, ${t('history.outfits', { count: dayMoments.length })}` : `, ${t('history.notLogged')}`}`}
                className={`relative flex aspect-square flex-col items-center justify-center rounded-lg p-0.5 text-xs ${dayMoments.length ? 'bg-[var(--bg)]' : ''} ${date === today() ? 'outline outline-2 outline-[var(--accent)]' : ''} disabled:opacity-30`}
              >
                {firstItem ? <ItemThumb item={firstItem} size="fill" /> : <span>{Number(date.slice(8))}</span>}
                {dayMoments.length > 1 && (
                  <span className="absolute right-0.5 top-0.5 rounded-full bg-[var(--accent)] px-1 text-[10px] font-semibold text-[var(--accent-fg)]" aria-hidden="true">
                    {dayMoments.length}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </Card>

      <Sheet open={!!selected} onClose={() => setSelected(null)} title={selected ? formatDate(selected, label.lang) : ''}>
        {selected && (
          <div className="pb-2">
            {selectedMoments.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                {t('history.notLogged')}. {t('history.logHint')}
              </p>
            ) : (
              selectedMoments.map((m) => {
                const outfit = m.confirmedOutfitId ? outfitsById.get(m.confirmedOutfitId) : undefined
                if (!outfit) return null
                return (
                  <section key={m.id} className="mb-5">
                    <p className="mb-2 text-sm text-[var(--muted)]">
                      {label.occasion(m.occasionId)} · {hoursOf(m)}
                    </p>
                    <OutfitCard outfit={outfit} itemsById={itemsById} size="md" />
                    <div className="mt-3 flex gap-2">
                      {m.rating ? (
                        <span className="text-sm text-[var(--muted)]">
                          {t('history.rating')}: {m.rating === 'up' ? '👍' : '👎'}
                        </span>
                      ) : (
                        <>
                          <Button tone="secondary" onClick={() => void rateMoment(m.id, 'up')}>
                            👍
                          </Button>
                          <Button tone="secondary" onClick={() => void rateMoment(m.id, 'down')}>
                            👎
                          </Button>
                        </>
                      )}
                    </div>
                  </section>
                )
              })
            )}
          </div>
        )}
      </Sheet>
    </Screen>
  )
}

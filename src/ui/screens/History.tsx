import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { rateDay } from '../../app/today'
import { db, today, type OutfitRecord } from '../../data/db'
import { Button, Card, ItemThumb, Screen, Sheet } from '../components'
import { formatDate, useItems, useLabel } from '../hooks'
import { OutfitCard } from '../OutfitCard'

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function History() {
  const { t } = useTranslation()
  const label = useLabel()
  const items = useItems()
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [selected, setSelected] = useState<string | null>(null)
  const key = monthKey(month)
  const plans = useLiveQuery(() => db.dayPlans.where('date').between(`${key}-01`, `${key}-32`, true, true).toArray(), [key])
  const outfitIds = useMemo(() => (plans ?? []).map((p) => p.confirmedOutfitId).filter((x): x is string => !!x), [plans])
  const outfits = useLiveQuery(async (): Promise<OutfitRecord[]> => (outfitIds.length ? db.outfits.where('id').anyOf(outfitIds).toArray() : []), [outfitIds.join(',')])
  const totalLogged = useLiveQuery(() => db.dayPlans.filter((p) => !!p.confirmedOutfitId).count(), [])
  const itemsById = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items])
  const outfitsById = useMemo(() => new Map((outfits ?? []).map((o) => [o.id, o])), [outfits])
  const plansByDate = useMemo(() => new Map((plans ?? []).map((p) => [p.date, p])), [plans])

  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const offset = (first.getDay() + 6) % 7 // Monday first
  const cells: (string | null)[] = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${key}-${String(i + 1).padStart(2, '0')}`)]
  const monthLabel = new Intl.DateTimeFormat(label.lang === 'el' ? 'el-GR' : 'en-GB', { month: 'long', year: 'numeric' }).format(month)
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((d) => t(`weekday.${d}`).slice(0, 2))

  const selectedPlan = selected ? plansByDate.get(selected) : undefined
  const selectedOutfit = selectedPlan?.confirmedOutfitId ? outfitsById.get(selectedPlan.confirmedOutfitId) : undefined

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
            const plan = plansByDate.get(date)
            const outfit = plan?.confirmedOutfitId ? outfitsById.get(plan.confirmedOutfitId) : undefined
            const firstItem = outfit ? itemsById.get(outfit.slots.base ?? outfit.itemIds[0]) : undefined
            const isFuture = date > today()
            return (
              <button
                key={date}
                type="button"
                disabled={isFuture}
                onClick={() => setSelected(date)}
                aria-label={`${formatDate(date, label.lang)}${outfit ? '' : `, ${t('history.notLogged')}`}`}
                className={`flex aspect-square flex-col items-center justify-center rounded-lg text-xs ${outfit ? 'bg-[var(--bg)]' : ''} ${date === today() ? 'outline outline-2 outline-[var(--accent)]' : ''} disabled:opacity-30`}
              >
                {firstItem ? <ItemThumb item={firstItem} size="sm" /> : <span>{Number(date.slice(8))}</span>}
              </button>
            )
          })}
        </div>
      </Card>

      <Sheet open={!!selected} onClose={() => setSelected(null)} title={selected ? formatDate(selected, label.lang) : ''}>
        {selected && (
          <div className="pb-2">
            {selectedOutfit ? (
              <>
                <p className="mb-2 text-sm text-[var(--muted)]">{label.occasion(selectedPlan?.occasionId ?? '')}</p>
                <OutfitCard outfit={selectedOutfit} itemsById={itemsById} size="md" />
                <div className="mt-4 flex gap-2">
                  {selectedPlan?.rating ? (
                    <span className="text-sm text-[var(--muted)]">{t('history.rating')}: {selectedPlan.rating === 'up' ? '👍' : '👎'}</span>
                  ) : (
                    <>
                      <Button tone="secondary" onClick={() => void rateDay(selected, 'up')}>
                        👍
                      </Button>
                      <Button tone="secondary" onClick={() => void rateDay(selected, 'down')}>
                        👎
                      </Button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-[var(--muted)]">{t('history.notLogged')}. {t('history.logHint')}</p>
            )}
          </div>
        )}
      </Sheet>
    </Screen>
  )
}

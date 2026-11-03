import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addMoment, alternativesFor, clearPlan, formatAge, loadDay, occasionFor, PLAN_MAX_DAYS, planAhead, rateMoment, removeMoment, undoWear, wearOutfit, windowForToday, type DayModel, type MomentView } from '../../app/today'
import { momentsBetween, shiftDate } from '../../data/checkin'
import { db, today as todayDate, type OutfitRecord } from '../../data/db'
import type { OutfitProposal } from '../../engine/types'
import { estimatedWindow } from '../../engine/weather'
import { Button, Card, Chip, Empty, Screen, Sheet } from '../components'
import { formatDate, useLabel } from '../hooks'
import { OutfitCard } from '../OutfitCard'
import { composeReason } from '../reason'
import { navigate } from '../router'
import { useAppStore } from '../store'

const PLAN_CHOICES = [1, 2, 3, 5, 7, 14]

/**
 * Today: "Where are you going?" → the outfit. Tap an occasion, the outfit
 * appears with its reason; wear it, ask for another one, or swap one piece.
 * Going somewhere else later gives the day a second outfit. The next days are
 * planned from a sheet; yesterday can still be logged.
 */
export function Today() {
  const { t } = useTranslation()
  const label = useLabel()
  const toast = useAppStore((s) => s.toast)
  const today = todayDate()
  const [date, setDate] = useState(today)
  const [day, setDay] = useState<DayModel | null>(null)
  const [loading, setLoading] = useState(true)
  /** Per moment: the index of the suggestion on show, or a swapped outfit. */
  const [picked, setPicked] = useState<Record<string, number>>({})
  const [swapped, setSwapped] = useState<Record<string, OutfitProposal>>({})
  const [swap, setSwap] = useState<{ key: string; slot: string; options: OutfitProposal[] } | null>(null)
  const [planOpen, setPlanOpen] = useState(false)
  const [planDays, setPlanDays] = useState(3)
  const [planOccasion, setPlanOccasion] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const model = await loadDay(date)
      setDay(model)
      setPicked({})
      setSwapped({})
      setPlanDays(model.settings.planDays || 3)
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    void reload()
  }, [reload])

  // Yesterday (still open for a late check-in) and the planned days ahead.
  const from = shiftDate(today, -1)
  const to = shiftDate(today, PLAN_MAX_DAYS)
  const around = useLiveQuery(() => momentsBetween(from, to), [from, to])
  const yesterdayLogged = (around ?? []).some((m) => m.date === from && m.confirmedOutfitId)
  const coming = useMemo(
    () =>
      (around ?? [])
        .filter((m) => m.date > today && m.plannedOutfitId)
        .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)),
    [around, today],
  )
  const comingIds = coming.map((m) => m.plannedOutfitId as string).join(',')
  const comingOutfits = useLiveQuery(async (): Promise<OutfitRecord[]> => (comingIds ? db.outfits.where('id').anyOf(comingIds.split(',')).toArray() : []), [comingIds])
  const outfitsById = useMemo(() => new Map((comingOutfits ?? []).map((o) => [o.id, o])), [comingOutfits])

  const lang = label.lang
  const isToday = date === today
  const daily = day?.forecast?.record.daily.find((d) => d.date === date)

  function currentFor(view: MomentView): OutfitProposal | null {
    return swapped[view.key] ?? view.outfits[picked[view.key] ?? 0] ?? null
  }

  async function act(fn: () => Promise<void>): Promise<void> {
    setBusy(true)
    try {
      await fn()
      await reload()
    } catch (error) {
      toast((error as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  /** The answer to "where are you going?": a moment for that occasion, from now when it is today. */
  async function go(occasionId: string) {
    if (!day) return
    const occasion = occasionFor(day.data, day.settings, occasionId)
    const window = isToday ? windowForToday(occasion) : null
    setPlanOccasion(occasionId)
    await act(() => addMoment(date, occasionId, window).then(() => undefined))
  }

  async function onPlan() {
    if (!day) return
    const occasionId = planOccasion ?? day.moments[0]?.occasion.id ?? day.data.occasions.occasions[0].id
    setPlanOpen(false)
    await act(async () => {
      const result = await planAhead(planDays, occasionId)
      toast(t('today.planDone', { count: result.planned }), 'success')
    })
  }

  async function onClearPlan() {
    setPlanOpen(false)
    await act(async () => {
      await clearPlan()
      toast(t('today.planCleared'), 'success')
    })
  }

  async function onSwapOpen(view: MomentView, slot: string) {
    if (!day) return
    const current = currentFor(view)
    if (!current) return
    const options = await alternativesFor(day, view, current, slot)
    setSwap({ key: view.key, slot, options })
  }

  const swapView = swap && day ? day.moments.find((m) => m.key === swap.key) : undefined

  function renderMoment(view: MomentView) {
    if (!day) return null
    const current = currentFor(view)
    const weather = view.weather
    const reasonText = current ? composeReason(current.reasons, t, label, day.itemsById) : ''
    const index = picked[view.key] ?? 0
    return (
      <Card key={view.key} className="mb-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm">
            <span className="font-semibold">{label.occasion(view.occasion.id)}</span>
            <span className="text-[var(--muted)]"> · {view.occasion.window[0]}–{view.occasion.window[1]}</span>
          </p>
          {!view.confirmedOutfit && (
            <button type="button" className="min-h-11 min-w-11 text-lg text-[var(--muted)]" aria-label={t('today.remove')} onClick={() => void act(() => removeMoment(view.moment.id))} disabled={busy}>
              ×
            </button>
          )}
        </div>

        {weather && (
          <p className="mb-3 text-sm text-[var(--muted)]">
            {t('today.feelsLike', { min: Math.round(weather.apparentMin), max: Math.round(weather.apparentMax) })} · {label.band(weather.band)} · {t('today.rain', { rain: Math.round(weather.rainProbabilityMax) })}
            {weather.estimated && <span className="block text-xs">{t('today.estimated', { band: label.band(weather.band) })}</span>}
          </p>
        )}

        {view.confirmedOutfit ? (
          <>
            <h2 className="text-lg font-semibold">{t('today.worn')}</h2>
            <div className="mt-3">
              <OutfitCard outfit={view.confirmedOutfit} itemsById={day.itemsById} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {view.moment.rating ? (
                <span className="text-sm text-[var(--muted)]">{t('today.rated')}</span>
              ) : (
                <>
                  <Button tone="secondary" onClick={() => void act(() => rateMoment(view.moment.id, 'up'))} disabled={busy}>
                    {t('today.rateUp')}
                  </Button>
                  <Button tone="secondary" onClick={() => void act(() => rateMoment(view.moment.id, 'down'))} disabled={busy}>
                    {t('today.rateDown')}
                  </Button>
                </>
              )}
              <Button tone="ghost" onClick={() => void act(() => undoWear(view.moment.id))} disabled={busy}>
                {t('common.undo')}
              </Button>
            </div>
          </>
        ) : !current ? (
          <Empty
            title={label.occasion(view.occasion.id)}
            body={
              view.reason?.key === 'reason.nothingEligible'
                ? t('today.nothingEligible')
                : view.reason?.key === 'reason.missingSlots'
                  ? t('today.missingSlots', { slots: String(view.reason.params?.slots ?? '').split(',').map((s) => t(`slots.${s}`)).join(', ') })
                  : t('today.noCombination')
            }
            cta={t('today.addItems')}
            onCta={() => navigate({ name: 'add' })}
          />
        ) : (
          <>
            <OutfitCard outfit={current} itemsById={day.itemsById} onItemTap={(slot) => void onSwapOpen(view, slot)} />
            {reasonText && <p className="mt-4 text-sm">{reasonText}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                onClick={() =>
                  void act(async () => {
                    await wearOutfit(day, view, current, weather ?? estimatedWindow('mild', 20))
                    toast(t('today.confirmed'), 'success')
                  })
                }
                disabled={busy}
              >
                {isToday ? t('today.wearThis') : t('today.woreThis')}
              </Button>
              <Button
                tone="secondary"
                disabled={view.outfits.length < 2}
                onClick={() => {
                  const next = (index + 1) % view.outfits.length
                  setPicked((p) => ({ ...p, [view.key]: next }))
                  setSwapped((s) => {
                    const copy = { ...s }
                    delete copy[view.key]
                    return copy
                  })
                }}
              >
                {t('today.another')}
              </Button>
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">{t('today.tapToSwap')}</p>
          </>
        )}
      </Card>
    )
  }

  const title = isToday ? t('today.title') : formatDate(date, lang, { weekday: 'long', day: 'numeric' })

  return (
    <Screen
      title={title}
      action={
        isToday ? (
          <Button tone="ghost" onClick={() => setPlanOpen(true)}>
            {t('today.plan')}
          </Button>
        ) : (
          <Button tone="ghost" onClick={() => setDate(today)}>
            {t('today.backToToday')}
          </Button>
        )
      }
    >
      <p className="mb-4 text-sm text-[var(--muted)]">
        {formatDate(date, lang)}
        {daily && ` · ${t('today.feelsLike', { min: Math.round(daily.apparentMin), max: Math.round(daily.apparentMax) })} · ${t('today.rain', { rain: Math.round(daily.precipitationProbabilityMax) })}`}
        {day?.forecast?.stale && <span className="block text-xs">{t('today.stale', { age: formatAge(day.forecast.ageMinutes, lang) })}</span>}
      </p>

      {loading && !day && <p className="text-sm text-[var(--muted)]">{t('common.loading')}</p>}
      {day && (
        <>
          {!day.forecast && (
            <Card className="mb-4">
              <p className="text-sm">{t('today.noLocation')}</p>
              <Button tone="secondary" className="mt-3" onClick={() => navigate({ name: 'settings' })}>
                {t('today.setLocation')}
              </Button>
            </Card>
          )}

          {day.items.length === 0 ? (
            <Empty title={t('wardrobe.empty.title')} body={t('today.noItems')} cta={t('today.addItems')} onCta={() => navigate({ name: 'add' })} />
          ) : (
            <>
              {day.moments.map(renderMoment)}

              <Card className="mb-4">
                <h2 className="text-lg font-semibold">{day.moments.length === 0 ? (isToday ? t('today.where') : t('today.logDay')) : t('today.whereLater')}</h2>
                {day.moments.length === 0 && isToday && <p className="mt-1 text-sm text-[var(--muted)]">{t('today.whereBody')}</p>}
                <ul className="mt-3 flex flex-wrap gap-2">
                  {day.data.occasions.occasions.map((o) => (
                    <li key={o.id}>
                      <Chip onClick={() => void go(o.id)}>{label.occasion(o.id)}</Chip>
                    </li>
                  ))}
                </ul>
              </Card>

              {isToday && !yesterdayLogged && (
                <Button tone="ghost" className="mb-4" onClick={() => setDate(from)}>
                  {t('today.logYesterday')}
                </Button>
              )}

              {isToday && coming.length > 0 && (
                <Card className="mb-4">
                  <h2 className="text-lg font-semibold">{t('today.comingDays')}</h2>
                  <ul className="mt-3 flex flex-col gap-4">
                    {coming.map((m) => {
                      const outfit = outfitsById.get(m.plannedOutfitId as string)
                      if (!outfit) return null
                      return (
                        <li key={m.id}>
                          <p className="mb-2 text-sm">
                            <span className="font-semibold">{formatDate(m.date, lang, { weekday: 'long', day: 'numeric', month: 'short' })}</span>
                            <span className="text-[var(--muted)]"> · {label.occasion(m.occasionId)}</span>
                          </p>
                          <OutfitCard outfit={outfit} itemsById={day.itemsById} size="md" />
                        </li>
                      )
                    })}
                  </ul>
                </Card>
              )}
            </>
          )}
        </>
      )}

      {/* Plan the next days */}
      {day && (
        <Sheet open={planOpen} onClose={() => setPlanOpen(false)} title={t('today.planTitle')}>
          <p className="text-sm text-[var(--muted)]">{t('today.planBody')}</p>
          <p className="mt-4 text-sm font-semibold">{t('today.planWhere')}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {day.data.occasions.occasions.map((o) => {
              const active = (planOccasion ?? day.moments[0]?.occasion.id ?? day.data.occasions.occasions[0].id) === o.id
              return (
                <li key={o.id}>
                  <Chip active={active} onClick={() => setPlanOccasion(o.id)}>
                    {label.occasion(o.id)}
                  </Chip>
                </li>
              )
            })}
          </ul>
          <p className="mt-4 text-sm font-semibold">{t('today.planHowMany')}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {PLAN_CHOICES.map((n) => (
              <li key={n}>
                <Chip active={planDays === n} onClick={() => setPlanDays(n)}>
                  {t('common.days', { count: n })}
                </Chip>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2 pb-2">
            <Button onClick={() => void onPlan()} disabled={busy}>
              {t('today.planGo', { count: planDays })}
            </Button>
            {coming.length > 0 && (
              <Button tone="ghost" onClick={() => void onClearPlan()} disabled={busy}>
                {t('today.clearPlan')}
              </Button>
            )}
          </div>
        </Sheet>
      )}

      {/* Swap one piece */}
      {day && swapView && (
        <Sheet open={!!swap} onClose={() => setSwap(null)} title={t('today.swapTitle', { slot: swap ? t(`slots.${swap.slot}`) : '' })}>
          {swap &&
            (swap.options.length === 0 ? (
              <p className="pb-2 text-sm text-[var(--muted)]">{t('today.noAlternatives')}</p>
            ) : (
              <ul className="grid grid-cols-3 gap-3 pb-2">
                {swap.options.map((o) => {
                  const id = o.slots[swap.slot]
                  const item = day.itemsById.get(id)
                  if (!item) return null
                  return (
                    <li key={id} className="flex flex-col items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSwapped((s) => ({ ...s, [swap.key]: o }))
                          setSwap(null)
                        }}
                        className="w-full rounded-xl"
                        aria-label={label.itemName(item)}
                      >
                        <OutfitCard outfit={{ slots: { [swap.slot]: id }, itemIds: [id] }} itemsById={day.itemsById} size="md" />
                      </button>
                      <span className="text-center text-[11px] text-[var(--muted)]">{label.itemName(item)}</span>
                    </li>
                  )
                })}
              </ul>
            ))}
        </Sheet>
      )}
    </Screen>
  )
}

import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  addMoment,
  alternativesFor,
  changeMoment,
  clearPlan,
  formatAge,
  keepOutfit,
  loadDay,
  nowWindow,
  occasionFor,
  PLAN_MAX_DAYS,
  planAhead,
  rateMoment,
  removeMoment,
  sameIds,
  toggleLock,
  undoWear,
  wearOutfit,
  type DayModel,
  type MomentView,
} from '../../app/today'
import { momentsBetween, shiftDate } from '../../data/checkin'
import { today as todayDate } from '../../data/db'
import type { OutfitProposal } from '../../engine/types'
import { estimatedWindow } from '../../engine/weather'
import { Button, Card, Chip, Empty, Screen, Sheet } from '../components'
import { formatDate, useLabel } from '../hooks'
import { OutfitCard } from '../OutfitCard'
import { composeReason } from '../reason'
import { navigate } from '../router'
import { useAppStore } from '../store'

const PLAN_CHOICES = [1, 2, 3, 5, 7, 14]
const inputClass = 'min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-sm'

interface Editor {
  /** The moment being edited, or null for a new one. */
  key: string | null
  occasionId: string
  start: string
  end: string
  /** Hours set by hand: an occasion tap no longer resets them. */
  touched: boolean
  /** A "right now" outfit: the hours follow the clock and the occasion's end. */
  now: boolean
}

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
  const [editor, setEditor] = useState<Editor | null>(null)
  const [planOpen, setPlanOpen] = useState(false)
  const [planDays, setPlanDays] = useState(3)
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

  // The day strip: the two days still open for a late check-in, today, and the planning horizon.
  const stripFrom = shiftDate(today, -2)
  const stripTo = shiftDate(today, PLAN_MAX_DAYS - 1)
  const stripMoments = useLiveQuery(() => momentsBetween(stripFrom, stripTo), [stripFrom, stripTo])
  const stripDays = useMemo(() => {
    const days: { date: string; confirmed: number; pending: number }[] = []
    for (let i = -2; i < PLAN_MAX_DAYS; i++) {
      const d = shiftDate(today, i)
      const ms = (stripMoments ?? []).filter((m) => m.date === d)
      days.push({ date: d, confirmed: ms.filter((m) => m.confirmedOutfitId).length, pending: ms.filter((m) => !m.confirmedOutfitId).length })
    }
    return days
  }, [stripMoments, today])

  const lang = label.lang
  const isToday = date === today
  const isFuture = date > today

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

  function openNew(now: boolean) {
    if (!day) return
    const occasionId = day.defaultOccasionId ?? day.data.occasions.occasions[0].id
    const occasion = occasionFor(day.data, day.settings, occasionId)
    const [start, end] = now ? nowWindow(occasion) : occasion.window
    setEditor({ key: null, occasionId, start, end, touched: now, now })
  }

  function openEditor(view: MomentView) {
    setEditor({ key: view.key, occasionId: view.occasion.id, start: view.occasion.window[0], end: view.occasion.window[1], touched: view.moment.start !== null || view.moment.end !== null, now: false })
  }

  function editorPick(occasionId: string) {
    if (!day) return
    const occasion = occasionFor(day.data, day.settings, occasionId)
    setEditor((e) => {
      if (!e) return e
      if (e.now) {
        const [start, end] = nowWindow(occasion)
        return { ...e, occasionId, start, end }
      }
      if (e.touched) return { ...e, occasionId }
      return { ...e, occasionId, start: occasion.window[0], end: occasion.window[1] }
    })
  }

  async function saveEditor() {
    if (!day || !editor) return
    const occasion = occasionFor(day.data, day.settings, editor.occasionId)
    const custom = editor.start !== occasion.window[0] || editor.end !== occasion.window[1]
    const window: [string, string] | null = custom ? [editor.start, editor.end] : null
    const target = editor.key === null ? null : day.moments.find((m) => m.key === editor.key)
    setEditor(null)
    await act(async () => {
      if (!target) await addMoment(date, editor.occasionId, window)
      else await changeMoment(target, { occasionId: editor.occasionId, start: window?.[0] ?? null, end: window?.[1] ?? null })
    })
  }

  async function onPlan() {
    setPlanOpen(false)
    await act(async () => {
      const result = await planAhead(planDays)
      toast(t('today.planDone', { count: result.planned }), 'success')
      if (result.skipped > 0) toast(t('today.planSkipped', { count: result.skipped }), 'info')
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
  const swapCurrent = swapView ? currentFor(swapView) : null

  function renderMoment(view: MomentView) {
    if (!day) return null
    const current = currentFor(view)
    const locked = new Set(view.moment.lockedItemIds)
    const weather = view.weather
    const kept = !!current && !!view.plannedOutfit && sameIds(view.plannedOutfit.itemIds, current.itemIds)
    const reasonText = current ? composeReason(current.reasons, t, label, day.itemsById) : ''
    const hours = `${view.occasion.window[0]}–${view.occasion.window[1]}`
    const index = picked[view.key] ?? 0
    return (
      <Card key={view.key} className="mb-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Chip active onClick={() => openEditor(view)} ariaLabel={t('today.editMoment')}>
            {label.occasion(view.occasion.id)}
          </Chip>
          <button type="button" className="min-h-11 text-sm text-[var(--muted)]" onClick={() => openEditor(view)} aria-label={t('today.hours')}>
            {hours}
          </button>
          {kept && !view.confirmedOutfit && <span className="rounded-full bg-[var(--bg)] px-2 py-1 text-xs text-[var(--muted)]">{t('today.kept')}</span>}
          {view.stored && !view.confirmedOutfit && (
            <button type="button" className="ml-auto min-h-11 min-w-11 text-lg text-[var(--muted)]" aria-label={t('today.remove')} onClick={() => void act(() => removeMoment(view.moment.id))} disabled={busy}>
              ×
            </button>
          )}
        </div>

        {weather && (
          <p className="mb-3 text-sm">
            <span className="font-semibold">{t('today.feelsLike', { min: Math.round(weather.apparentMin), max: Math.round(weather.apparentMax) })}</span>
            {` · ${label.band(weather.band)} · ${t('today.rain', { rain: Math.round(weather.rainProbabilityMax) })} · ${t('today.humidity', { humidity: Math.round(weather.humidityMean) })}`}
            {weather.uvMax > 0 && ` · ${t('today.uv', { uv: Math.round(weather.uvMax) })}`}
            {weather.estimated && <span className="block text-xs text-[var(--muted)]">{t('today.estimated', { band: label.band(weather.band) })}</span>}
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
                    👍 {t('today.rateUp')}
                  </Button>
                  <Button tone="secondary" onClick={() => void act(() => rateMoment(view.moment.id, 'down'))} disabled={busy}>
                    👎 {t('today.rateDown')}
                  </Button>
                </>
              )}
              <Button tone="ghost" onClick={() => void act(() => undoWear(view.moment.id))} disabled={busy}>
                {t('common.undo')}
              </Button>
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">{t('today.wornHint')}</p>
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
            <OutfitCard outfit={current} itemsById={day.itemsById} locked={locked} onItemTap={(slot) => void onSwapOpen(view, slot)} />
            {reasonText && <p className="mt-4 text-sm">{reasonText}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {isFuture ? (
                <Button onClick={() => void act(() => keepOutfit(view, current))} disabled={busy || kept}>
                  {kept ? t('today.kept') : t('today.keep')}
                </Button>
              ) : (
                <Button
                  onClick={() =>
                    void act(async () => {
                      await wearOutfit(day, view, current, weather ?? estimatedWindow('mild', 20))
                      toast(t('today.confirmed'), 'success')
                    })
                  }
                  disabled={busy}
                >
                  {t('today.wear')}
                </Button>
              )}
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
                {t('today.shuffle')}
              </Button>
              {isToday && !isFuture && !kept && (
                <Button tone="ghost" onClick={() => void act(() => keepOutfit(view, current))} disabled={busy}>
                  {t('today.keep')}
                </Button>
              )}
            </div>
            {view.outfits.length > 1 && (
              <section className="mt-5">
                <h3 className="mb-2 text-sm font-semibold text-[var(--muted)]">{t('today.alternatives')}</h3>
                <div className="grid grid-cols-2 gap-3">
                  {view.outfits
                    .map((o, i) => ({ o, i }))
                    .filter(({ i }) => i !== index || swapped[view.key] !== undefined)
                    .filter(({ o }) => !sameIds(o.itemIds, current.itemIds))
                    .slice(0, 2)
                    .map(({ o, i }) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setPicked((p) => ({ ...p, [view.key]: i }))
                          setSwapped((s) => {
                            const copy = { ...s }
                            delete copy[view.key]
                            return copy
                          })
                        }}
                        className="rounded-2xl border border-[var(--line)] bg-[var(--bg)] p-3 text-left"
                      >
                        <OutfitCard outfit={o} itemsById={day.itemsById} size="sm" />
                      </button>
                    ))}
                </div>
              </section>
            )}
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
        <Button tone="secondary" onClick={() => setPlanOpen(true)}>
          {t('today.plan')}
        </Button>
      }
    >
      <p className="mb-3 text-sm text-[var(--muted)]">{formatDate(date, lang)}</p>

      {/* Day strip */}
      <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1" role="tablist" aria-label={t('today.days')}>
        {stripDays.map((d) => {
          const active = d.date === date
          const past = d.date < today
          const dow = new Date(`${d.date}T12:00:00`).getDay()
          return (
            <button
              key={d.date}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={formatDate(d.date, lang)}
              onClick={() => setDate(d.date)}
              className={`flex min-w-[3.25rem] shrink-0 flex-col items-center rounded-xl border px-2 py-1.5 ${active ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]' : d.date === today ? 'border-[var(--accent)] bg-[var(--card)]' : 'border-[var(--line)] bg-[var(--card)]'} ${past && !active ? 'opacity-60' : ''}`}
            >
              <span className="text-[10px] uppercase">{t(`weekday.${dow}`).slice(0, 3)}</span>
              <span className="text-base font-semibold leading-tight">{Number(d.date.slice(8))}</span>
              <span className="mt-1 flex h-1.5 gap-0.5" aria-hidden="true">
                {Array.from({ length: Math.min(3, d.confirmed) }).map((_, i) => (
                  <i key={`c${i}`} className="block h-1.5 w-1.5 rounded-full bg-current" />
                ))}
                {Array.from({ length: Math.min(3, d.pending) }).map((_, i) => (
                  <i key={`p${i}`} className="block h-1.5 w-1.5 rounded-full border border-current" />
                ))}
              </span>
            </button>
          )
        })}
      </div>

      {loading && !day && <p className="text-sm text-[var(--muted)]">{t('common.loading')}</p>}
      {day && (
        <>
          {day.forecast ? (
            <p className="mb-3 text-xs text-[var(--muted)]">
              {day.forecast.stale ? t('today.stale', { age: formatAge(day.forecast.ageMinutes, lang) }) : t('today.forecastAge', { age: formatAge(day.forecast.ageMinutes, lang) })}
            </p>
          ) : (
            <Card className="mb-4">
              <p className="text-sm">{t('today.noLocation')}</p>
              <Button tone="secondary" className="mt-3" onClick={() => navigate({ name: 'settings' })}>
                {t('today.setLocation')}
              </Button>
            </Card>
          )}

          {day.items.length === 0 ? (
            <Empty title={t('wardrobe.empty.title')} body={t('today.noItems')} cta={t('today.addItems')} onCta={() => navigate({ name: 'add' })} />
          ) : day.moments.length === 0 ? (
            <Card className="mb-4">
              <h2 className="text-lg font-semibold">{t('today.whatFor')}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{t('today.whatForBody')}</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {day.data.occasions.occasions.map((o) => (
                  <li key={o.id}>
                    <Chip onClick={() => void act(() => addMoment(date, o.id, null).then(() => undefined))}>{label.occasion(o.id)}</Chip>
                  </li>
                ))}
              </ul>
              {isToday && (
                <Button tone="secondary" className="mt-4" onClick={() => openNew(true)}>
                  {t('today.nowOutfit')}
                </Button>
              )}
            </Card>
          ) : (
            <>
              {day.moments.map(renderMoment)}
              <div className="flex flex-wrap gap-2">
                <Button tone="secondary" onClick={() => openNew(false)} disabled={busy}>
                  + {t('today.addMoment')}
                </Button>
                {isToday && (
                  <Button tone="secondary" onClick={() => openNew(true)} disabled={busy}>
                    {t('today.nowOutfit')}
                  </Button>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Moment editor */}
      {day && (
        <Sheet open={!!editor} onClose={() => setEditor(null)} title={editor?.key === null ? (editor.now ? t('today.nowOutfit') : t('today.addMoment')) : t('today.editMoment')}>
          {editor && (
            <div className="pb-2">
              <p className="mb-2 text-sm text-[var(--muted)]">{t('today.pickOccasion')}</p>
              <ul className="flex flex-wrap gap-2">
                {day.data.occasions.occasions.map((o) => (
                  <li key={o.id}>
                    <Chip active={o.id === editor.occasionId} onClick={() => editorPick(o.id)}>
                      {label.occasion(o.id)}
                    </Chip>
                  </li>
                ))}
              </ul>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                  {t('today.from')}
                  <input type="time" className={inputClass} value={editor.start} onChange={(e) => setEditor({ ...editor, start: e.target.value || editor.start, touched: true, now: false })} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                  {t('today.to')}
                  <input type="time" className={inputClass} value={editor.end} onChange={(e) => setEditor({ ...editor, end: e.target.value || editor.end, touched: true, now: false })} />
                </label>
              </div>
              {isToday && !editor.now && (
                <Button
                  tone="ghost"
                  className="mt-2"
                  onClick={() => {
                    const [start, end] = nowWindow(occasionFor(day.data, day.settings, editor.occasionId))
                    setEditor({ ...editor, start, end, touched: true, now: true })
                  }}
                >
                  {t('today.fromNow')}
                </Button>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={() => void saveEditor()} disabled={busy}>
                  {t('common.save')}
                </Button>
                <Button tone="secondary" onClick={() => setEditor(null)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          )}
        </Sheet>
      )}

      {/* Plan ahead */}
      <Sheet open={planOpen} onClose={() => setPlanOpen(false)} title={t('today.planTitle')}>
        <p className="text-sm text-[var(--muted)]">{t('today.planBody')}</p>
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
          <Button tone="ghost" onClick={() => void onClearPlan()} disabled={busy}>
            {t('today.clearPlan')}
          </Button>
        </div>
      </Sheet>

      {/* Swap sheet */}
      {day && swapView && swapCurrent && (
        <Sheet open={!!swap} onClose={() => setSwap(null)} title={t('today.swapTitle', { slot: swap ? t(`slots.${swap.slot}`) : '' })}>
          {swap && (
            <>
              {(() => {
                const currentId = swapCurrent.slots[swap.slot]
                const item = currentId ? day.itemsById.get(currentId) : undefined
                return item ? (
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className="text-sm">{label.itemName(item)}</span>
                    <Button
                      tone="secondary"
                      onClick={() => {
                        setSwap(null)
                        void act(() => toggleLock(swapView, item.id))
                      }}
                    >
                      {swapView.moment.lockedItemIds.includes(item.id) ? t('today.unlock') : t('today.lock')}
                    </Button>
                  </div>
                ) : null
              })()}
              {swap.options.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">{t('today.noAlternatives')}</p>
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
                          className="rounded-xl"
                          aria-label={label.itemName(item)}
                        >
                          <OutfitCard outfit={{ slots: { [swap.slot]: id }, itemIds: [id] }} itemsById={day.itemsById} size="md" />
                        </button>
                        <span className="text-center text-[11px] text-[var(--muted)]">{label.itemName(item)}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
        </Sheet>
      )}
    </Screen>
  )
}

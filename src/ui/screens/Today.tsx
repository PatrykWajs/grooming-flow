import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { alternativesFor, formatAge, graceDays, loadToday, rateDay, setOccasion, toggleLock, undoWear, wearThis, type TodayModel } from '../../app/today'
import { today as todayDate } from '../../data/db'
import { estimatedWindow } from '../../engine/weather'
import type { OutfitProposal } from '../../engine/types'
import { Button, Card, Chip, Empty, Screen, Sheet } from '../components'
import { formatDate, useLabel } from '../hooks'
import { OutfitCard } from '../OutfitCard'
import { composeReason } from '../reason'
import { navigate } from '../router'
import { useAppStore } from '../store'

export function Today() {
  const { t } = useTranslation()
  const label = useLabel()
  const toast = useAppStore((s) => s.toast)
  const [date, setDate] = useState(todayDate())
  const [model, setModel] = useState<TodayModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [index, setIndex] = useState(0)
  const [current, setCurrent] = useState<OutfitProposal | null>(null)
  const [occasionOpen, setOccasionOpen] = useState(false)
  const [swap, setSwap] = useState<{ slot: string; options: OutfitProposal[] } | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const m = await loadToday(date)
      setModel(m)
      setIndex(0)
      setCurrent(m.outfits[0] ?? null)
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    void reload()
  }, [reload])

  const lang = label.lang
  const locked = new Set(model?.plan?.lockedItemIds ?? [])
  const weather = model?.weather ?? null
  const isToday = date === todayDate()

  async function onWear() {
    if (!model || !current) return
    setBusy(true)
    try {
      await wearThis(model, current, weather ?? estimatedWindow('mild', 20))
      toast(t('today.confirmed'), 'success')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function onSwapOpen(slot: string) {
    if (!model || !current) return
    const options = await alternativesFor(model, current, slot)
    setSwap({ slot, options })
  }

  function onShuffle() {
    if (!model || model.outfits.length === 0) return
    const next = (index + 1) % model.outfits.length
    setIndex(next)
    setCurrent(model.outfits[next])
  }

  const reasonText = model && current ? composeReason(current.reasons, t, label, model.itemsById) : ''

  const dateChips = graceDays(todayDate())
  const header = (
    <div className="flex items-center gap-2">
      {!isToday && (
        <Chip onClick={() => setDate(todayDate())} ariaLabel={t('nav.today')}>
          {t('nav.today')}
        </Chip>
      )}
    </div>
  )

  return (
    <Screen title={isToday ? t('today.title') : formatDate(date, lang, { weekday: 'long', day: 'numeric' })} action={header}>
      {loading && !model && <p className="text-sm text-[var(--muted)]">{t('common.loading')}</p>}
      {model && (
        <>
          <p className="mb-3 text-sm text-[var(--muted)]">{formatDate(date, lang)}</p>

          {/* Weather strip */}
          {weather ? (
            <Card className="mb-4">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                <span className="text-lg font-semibold">{t('today.feelsLike', { min: Math.round(weather.apparentMin), max: Math.round(weather.apparentMax) })}</span>
                <span>{label.band(weather.band)}</span>
                <span>{t('today.rain', { rain: Math.round(weather.rainProbabilityMax) })}</span>
                <span>{t('today.humidity', { humidity: Math.round(weather.humidityMean) })}</span>
                {weather.uvMax > 0 && <span>{t('today.uv', { uv: Math.round(weather.uvMax) })}</span>}
              </div>
              {weather.estimated && <p className="mt-1 text-xs text-[var(--muted)]">{t('today.estimated', { band: label.band(weather.band) })}</p>}
              {model.forecast && !weather.estimated && (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {model.forecast.stale ? t('today.stale', { age: formatAge(model.forecast.ageMinutes, lang) }) : t('today.forecastAge', { age: formatAge(model.forecast.ageMinutes, lang) })}
                </p>
              )}
            </Card>
          ) : (
            <Card className="mb-4">
              <p className="text-sm">{t('today.noLocation')}</p>
              <Button tone="secondary" className="mt-3" onClick={() => navigate({ name: 'settings' })}>
                {t('today.setLocation')}
              </Button>
            </Card>
          )}

          {/* Occasion */}
          <div className="mb-4 flex items-center gap-2">
            <span className="text-sm text-[var(--muted)]">{t('today.occasion')}</span>
            <Chip active onClick={() => setOccasionOpen(true)} ariaLabel={t('today.pickOccasion')}>
              {label.occasion(model.occasion.id)}
            </Chip>
          </div>

          {/* Confirmed state */}
          {model.confirmedOutfit ? (
            <Card>
              <h2 className="text-lg font-semibold">{t('today.worn')}</h2>
              <div className="mt-3">
                <OutfitCard outfit={model.confirmedOutfit} itemsById={model.itemsById} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {model.plan?.rating ? (
                  <span className="text-sm text-[var(--muted)]">{t('today.rated')}</span>
                ) : (
                  <>
                    <Button tone="secondary" onClick={() => void rateDay(date, 'up').then(reload)}>
                      👍 {t('today.rateUp')}
                    </Button>
                    <Button tone="secondary" onClick={() => void rateDay(date, 'down').then(reload)}>
                      👎 {t('today.rateDown')}
                    </Button>
                  </>
                )}
                <Button tone="ghost" onClick={() => void undoWear(date).then(reload)}>
                  {t('common.undo')}
                </Button>
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">{t('today.wornHint')}</p>
            </Card>
          ) : model.items.length === 0 ? (
            <Empty title={t('wardrobe.empty.title')} body={t('today.noItems')} cta={t('today.addItems')} onCta={() => navigate({ name: 'add' })} />
          ) : !current ? (
            <Empty
              title={t('today.title')}
              body={
                model.reason?.key === 'reason.nothingEligible'
                  ? t('today.nothingEligible')
                  : model.reason?.key === 'reason.missingSlots'
                    ? t('today.missingSlots', { slots: String(model.reason.params?.slots ?? '').split(',').map((s) => t(`slots.${s}`)).join(', ') })
                    : t('today.noCombination')
              }
              cta={t('today.addItems')}
              onCta={() => navigate({ name: 'add' })}
            />
          ) : (
            <>
              <Card>
                <OutfitCard outfit={current} itemsById={model.itemsById} locked={locked} onItemTap={(slot) => void onSwapOpen(slot)} />
                {reasonText && <p className="mt-4 text-sm">{reasonText}</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button onClick={() => void onWear()} disabled={busy}>
                    {t('today.wear')}
                  </Button>
                  <Button tone="secondary" onClick={onShuffle} disabled={model.outfits.length < 2}>
                    {t('today.shuffle')}
                  </Button>
                </div>
              </Card>
              {model.outfits.length > 1 && (
                <section className="mt-5">
                  <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">{t('today.alternatives')}</h2>
                  <div className="grid grid-cols-2 gap-3">
                    {model.outfits
                      .map((o, i) => ({ o, i }))
                      .filter(({ i }) => i !== index)
                      .slice(0, 2)
                      .map(({ o, i }) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            setIndex(i)
                            setCurrent(o)
                          }}
                          className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3 text-left"
                        >
                          <OutfitCard outfit={o} itemsById={model.itemsById} size="sm" />
                        </button>
                      ))}
                  </div>
                </section>
              )}
            </>
          )}

          {/* Grace check-in for the two previous days */}
          {isToday && (
            <div className="mt-6 flex flex-wrap gap-2">
              {dateChips.slice(1).map((d) => (
                <Chip key={d} onClick={() => setDate(d)}>
                  {t('history.logDay')}: {formatDate(d, lang, { weekday: 'short', day: 'numeric' })}
                </Chip>
              ))}
            </div>
          )}
        </>
      )}

      {/* Occasion sheet */}
      {model && (
        <Sheet open={occasionOpen} onClose={() => setOccasionOpen(false)} title={t('today.pickOccasion')}>
          <ul className="flex flex-wrap gap-2 pb-2">
            {model.data.occasions.occasions.map((o) => (
              <li key={o.id}>
                <Chip
                  active={o.id === model.occasion.id}
                  onClick={() => {
                    setOccasionOpen(false)
                    void setOccasion(date, o.id).then(reload)
                  }}
                >
                  {label.occasion(o.id)}
                </Chip>
              </li>
            ))}
          </ul>
        </Sheet>
      )}

      {/* Swap sheet */}
      {model && current && (
        <Sheet open={!!swap} onClose={() => setSwap(null)} title={t('today.swapTitle', { slot: swap ? t(`slots.${swap.slot}`) : '' })}>
          {swap && (
            <>
              {(() => {
                const currentId = current.slots[swap.slot]
                const item = currentId ? model.itemsById.get(currentId) : undefined
                return item ? (
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className="text-sm">{label.itemName(item)}</span>
                    <Button
                      tone="secondary"
                      onClick={() => {
                        setSwap(null)
                        void toggleLock(date, item.id).then(reload)
                      }}
                    >
                      {locked.has(item.id) ? t('today.unlock') : t('today.lock')}
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
                    const item = model.itemsById.get(id)
                    if (!item) return null
                    return (
                      <li key={id} className="flex flex-col items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setCurrent(o)
                            setSwap(null)
                          }}
                          className="rounded-xl"
                          aria-label={label.itemName(item)}
                        >
                          <OutfitCard outfit={{ slots: { [swap.slot]: id }, itemIds: [id] }} itemsById={model.itemsById} size="md" />
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

export function useLanguageTag(): string {
  const { i18n } = useTranslation()
  return i18n.language
}

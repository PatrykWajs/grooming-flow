import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { aiClient } from '../../ai/client'
import { applySubcategoryChange, cardFromIntake, intakeResult, MAX_BATCH, newCard, processCard, requestPersistence, saveCard, type EditableFields, type ReviewCard } from '../../app/addItems'
import { updateSettings } from '../../data/db'
import { intakeAll, intakeDone, intakeDuplicate, intakeFields, intakeFinish, intakeStart } from '../../data/intake'
import { Button, Card, Screen } from '../components'
import { FieldEditor } from '../FieldEditor'
import { useEngineData, useItems, useLabel, useSettings } from '../hooks'
import { navigate } from '../router'
import { useAppStore } from '../store'

export function AddItems() {
  const { t } = useTranslation()
  const data = useEngineData()
  const items = useItems()
  const settings = useSettings()
  const label = useLabel()
  const toast = useAppStore((s) => s.toast)
  const progress = useAppStore((s) => s.modelProgress)
  const setProgress = useAppStore((s) => s.setModelProgress)
  const backend = useAppStore((s) => s.backend)
  const setBackend = useAppStore((s) => s.setBackend)
  const setAddBusy = useAppStore((s) => s.setAddBusy)
  const [cards, setCards] = useState<ReviewCard[]>([])
  const [bgRemoval, setBgRemoval] = useState<boolean | null>(null)
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const restoredRef = useRef(false)
  const pickRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  useEffect(() => aiClient.onProgress(setProgress), [setProgress])
  useEffect(() => {
    void aiClient.ready().then(setBackend)
  }, [setBackend])

  const removeBg = bgRemoval ?? settings?.bgRemoval ?? true

  const downloading = useMemo(() => {
    const entries = Object.values(progress).filter((p) => p.status === 'download' && p.total > 0)
    if (entries.length === 0) return null
    const loaded = entries.reduce((a, p) => a + p.loaded, 0)
    const total = entries.reduce((a, p) => a + p.total, 0)
    const done = entries.every((p) => p.loaded >= p.total)
    return done ? null : Math.round((loaded / total) * 100)
  }, [progress])

  function update(id: string, patch: Partial<ReviewCard> | ((c: ReviewCard) => ReviewCard)) {
    setCards((prev) => prev.map((c) => (c.id === id ? (typeof patch === 'function' ? patch(c) : { ...c, ...patch }) : c)))
  }

  /**
   * One photo after another. The card is already in the queue on disk; the
   * result replaces it there, and the row goes only when the user confirms or
   * discards the card.
   */
  function queueProcess(card: ReviewCard) {
    if (!data) return
    const existing = items ?? []
    const remove = removeBg
    queueRef.current = queueRef.current
      .then(async () => {
        update(card.id, { status: 'processing' })
        const done = await processCard(card, data, existing, remove)
        update(card.id, () => done)
        await intakeFinish(card.id, intakeResult(done))
      })
      .catch((error: unknown) => {
        update(card.id, { status: 'error', error: (error as Error).message ?? String(error) })
      })
  }

  // After a reload, the queue on disk comes back as cards: ready ones for review, queued ones processed again.
  useEffect(() => {
    if (!data || !items || restoredRef.current) return
    restoredRef.current = true
    void (async () => {
      const rows = await intakeAll()
      if (rows.length === 0) return
      const restored = rows.map((row) => {
        const card = cardFromIntake(row, items)
        return card.thumb ? { ...card, thumbUrl: URL.createObjectURL(card.thumb) } : card
      })
      setCards((prev) => [...restored, ...prev.filter((c) => !restored.some((r) => r.id === c.id))])
      toast(t('add.restored', { count: rows.length }))
      for (const card of restored) if (card.status === 'queued') queueProcess(card)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, items])

  /** Every picked photo is on disk within milliseconds, before the first one is processed (processing can take minutes on first use). */
  async function enqueue(files: FileList | null) {
    if (!files || !data) return
    const list = Array.from(files).slice(0, MAX_BATCH)
    if (files.length > MAX_BATCH) toast(t('add.limit'))
    const fresh = list.map(newCard)
    setCards((prev) => [...prev, ...fresh])
    for (const card of fresh) await intakeStart(card.id, card.source, card.name)
    for (const card of fresh) queueProcess(card)
  }

  async function confirm(card: ReviewCard) {
    if (!data || card.status !== 'ready') return
    const record = await saveCard(card, data)
    await intakeDone(card.id)
    update(card.id, { status: 'saved' })
    const persisted = await requestPersistence()
    if (persisted !== null && settings?.persistGranted !== persisted) await updateSettings({ persistGranted: persisted })
    return record
  }

  async function confirmAll() {
    const ready = cards.filter((c) => c.status === 'ready' && !c.duplicateOf)
    for (const c of ready) await confirm(c)
    toast(t('add.saved', { count: ready.length }), 'success')
  }

  function discard(card: ReviewCard) {
    void intakeDone(card.id)
    if (card.thumbUrl) URL.revokeObjectURL(card.thumbUrl)
    update(card.id, { status: 'discarded' })
  }

  function edit(card: ReviewCard, patch: Partial<EditableFields>, field: string) {
    if (!data) return
    const next = field === 'subcategory' && patch.subcategory ? applySubcategoryChange(card, patch.subcategory, data) : { ...card, fields: { ...(card.fields as EditableFields), ...patch }, userEdited: new Set([...card.userEdited, field]) }
    update(card.id, () => next)
    if (next.fields) void intakeFields(card.id, next.fields, [...next.userEdited])
  }

  const pending = cards.filter((c) => c.status === 'queued' || c.status === 'processing').length
  const total = cards.filter((c) => c.status !== 'discarded').length
  const savedCount = cards.filter((c) => c.status === 'saved').length
  const mb = backend && aiClient.models ? aiClient.models.classifier.approxMB[backend] + (removeBg ? aiClient.models.bgRemoval.approxMB[backend] : 0) : 0

  // While photos are processed the update banner stays away.
  useEffect(() => {
    setAddBusy(pending > 0)
    return () => setAddBusy(false)
  }, [pending, setAddBusy])

  return (
    <Screen
      title={t('add.title')}
      action={
        <Button tone="ghost" onClick={() => navigate({ name: 'wardrobe' })}>
          {t('common.done')}
        </Button>
      }
    >
      <Card className="mb-4">
        <p className="text-sm text-[var(--muted)]">{t('add.hint')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => pickRef.current?.click()}>{t('add.pick')}</Button>
          <Button tone="secondary" onClick={() => cameraRef.current?.click()}>
            {t('add.camera')}
          </Button>
        </div>
        <input ref={pickRef} type="file" accept="image/*" multiple hidden onChange={(e) => void enqueue(e.target.files)} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void enqueue(e.target.files)} />
        <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={removeBg} onChange={(e) => setBgRemoval(e.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />
          {t('add.bgRemoval')}
        </label>
        <p className="mt-2 text-xs text-[var(--muted)]">
          {backend ? t('add.backend', { backend: backend === 'webgpu' ? 'WebGPU' : 'WASM' }) : t('common.loading')}
          {mb > 0 && ` · ${t('add.modelsHint', { mb })}`}
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">{t('add.resumeHint')}</p>
      </Card>

      {downloading !== null && (
        <Card className="mb-4">
          <p className="text-sm">{t('add.models', { percent: downloading })}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--line)]">
            <div className="h-full bg-[var(--accent)] transition-[width] duration-300" style={{ width: `${downloading}%` }} />
          </div>
        </Card>
      )}

      {total > 0 && (
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-[var(--muted)]">{pending > 0 ? t('add.processing', { done: total - pending, total }) : t('add.review')}</span>
          {cards.some((c) => c.status === 'ready') && <Button onClick={() => void confirmAll()}>{t('add.confirmAll')}</Button>}
        </div>
      )}

      <ul className="flex flex-col gap-4">
        {cards
          .filter((c) => c.status !== 'discarded')
          .map((card) => (
            <li key={card.id}>
              <Card>
                <div className="flex gap-3">
                  <div className="h-28 w-28 shrink-0 overflow-hidden rounded-xl bg-[var(--bg)]">
                    {card.thumbUrl ? <img src={card.thumbUrl} alt="" className="h-full w-full object-contain" /> : <span className="flex h-full items-center justify-center text-xs text-[var(--muted)]">{card.status === 'error' ? '!' : '…'}</span>}
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    {card.status === 'processing' && <p className="text-[var(--muted)]">{t('common.loading')}</p>}
                    {card.status === 'queued' && <p className="text-[var(--muted)]">…</p>}
                    {card.status === 'error' && (
                      <>
                        <p className="text-[#8c2f2f]">{card.error?.startsWith('UNSUPPORTED_IMAGE') ? t('add.unsupported', { type: card.error.split(':')[1] }) : `${t('add.error')}: ${card.error}`}</p>
                        <Button tone="ghost" className="mt-2" onClick={() => discard(card)}>
                          {t('add.discard')}
                        </Button>
                      </>
                    )}
                    {card.status === 'saved' && <p className="font-semibold text-[var(--accent)]">{t('item.saved')}</p>}
                    {card.status === 'ready' && card.fields && (
                      <>
                        <p className="font-semibold">{label.itemName(card.fields)}</p>
                        {card.prediction && (
                          <p className="text-xs text-[var(--muted)]">
                            {card.prediction.subcategory
                              .slice(0, 3)
                              .map((s) => `${label.subcategory(s.id)} ${Math.round(s.score * 100)} %`)
                              .join(' · ')}
                          </p>
                        )}
                        {card.duplicateOf && (
                          <div className="mt-2 rounded-xl bg-[var(--bg)] p-2 text-xs">
                            <p>{t('add.duplicate', { name: label.itemName(card.duplicateOf) })}</p>
                            <div className="mt-2 flex gap-2">
                              <Button tone="secondary" className="min-h-9 px-3 text-xs" onClick={() => discard(card)}>
                                {t('add.duplicateYes')}
                              </Button>
                              <Button
                                tone="secondary"
                                className="min-h-9 px-3 text-xs"
                                onClick={() => {
                                  update(card.id, { duplicateOf: null })
                                  void intakeDuplicate(card.id, null)
                                }}
                              >
                                {t('add.duplicateNo')}
                              </Button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {card.status === 'ready' && card.fields && data && (
                  <div className="mt-3">
                    <FieldEditor fields={card.fields} data={data} guessed={new Set(['material', 'pattern'].filter((f) => !card.userEdited.has(f)))} onChange={(patch, field) => edit(card, patch, field)} />
                    <div className="mt-3 flex gap-2">
                      <Button onClick={() => void confirm(card)} disabled={!!card.duplicateOf}>
                        {t('add.confirm')}
                      </Button>
                      <Button tone="ghost" onClick={() => discard(card)}>
                        {t('add.discard')}
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            </li>
          ))}
      </ul>
      {savedCount > 0 && pending === 0 && cards.every((c) => c.status === 'saved' || c.status === 'discarded' || c.status === 'error') && (
        <div className="mt-4">
          <Button onClick={() => navigate({ name: 'wardrobe' })}>{t('common.done')}</Button>
        </div>
      )}
    </Screen>
  )
}

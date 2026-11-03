import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { aiClient } from '../../ai/client'
import { applySubcategoryChange, MAX_BATCH, newCard, processCard, requestPersistence, saveCard, type EditableFields, type ReviewCard } from '../../app/addItems'
import { updateSettings } from '../../data/db'
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
  const [cards, setCards] = useState<ReviewCard[]>([])
  const [bgRemoval, setBgRemoval] = useState<boolean | null>(null)
  const queueRef = useRef<Promise<void>>(Promise.resolve())
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

  function enqueue(files: FileList | null) {
    if (!files || !data) return
    const existing = items ?? []
    const list = Array.from(files).slice(0, MAX_BATCH)
    if (files.length > MAX_BATCH) toast(t('add.limit'))
    const fresh = list.map(newCard)
    setCards((prev) => [...prev, ...fresh])
    for (const card of fresh) {
      queueRef.current = queueRef.current.then(async () => {
        update(card.id, { status: 'processing' })
        const done = await processCard(card, data, existing, removeBg)
        update(card.id, () => done)
      })
    }
  }

  async function confirm(card: ReviewCard) {
    if (!data || card.status !== 'ready') return
    const record = await saveCard(card, data)
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

  const pending = cards.filter((c) => c.status === 'queued' || c.status === 'processing').length
  const total = cards.filter((c) => c.status !== 'discarded').length
  const savedCount = cards.filter((c) => c.status === 'saved').length
  const mb = backend && aiClient.models ? aiClient.models.classifier.approxMB[backend] + (removeBg ? aiClient.models.bgRemoval.approxMB[backend] : 0) : 0

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
        <input ref={pickRef} type="file" accept="image/*" multiple hidden onChange={(e) => enqueue(e.target.files)} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => enqueue(e.target.files)} />
        <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={removeBg} onChange={(e) => setBgRemoval(e.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />
          {t('add.bgRemoval')}
        </label>
        <p className="mt-2 text-xs text-[var(--muted)]">
          {backend ? t('add.backend', { backend: backend === 'webgpu' ? 'WebGPU' : 'WASM' }) : t('common.loading')}
          {mb > 0 && ` · ${t('add.modelsHint', { mb })}`}
        </p>
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
                      <p className="text-[#8c2f2f]">{card.error?.startsWith('UNSUPPORTED_IMAGE') ? t('add.unsupported', { type: card.error.split(':')[1] }) : `${t('add.error')}: ${card.error}`}</p>
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
                              <Button tone="secondary" className="min-h-9 px-3 text-xs" onClick={() => update(card.id, { status: 'discarded' })}>
                                {t('add.duplicateYes')}
                              </Button>
                              <Button tone="secondary" className="min-h-9 px-3 text-xs" onClick={() => update(card.id, { duplicateOf: null })}>
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
                    <FieldEditor
                      fields={card.fields}
                      data={data}
                      guessed={new Set(['material', 'pattern'].filter((f) => !card.userEdited.has(f)))}
                      onChange={(patch, field) =>
                        update(card.id, (c) => {
                          if (field === 'subcategory' && patch.subcategory) return applySubcategoryChange(c, patch.subcategory, data)
                          return { ...c, fields: { ...(c.fields as EditableFields), ...patch }, userEdited: new Set([...c.userEdited, field]) }
                        })
                      }
                    />
                    <div className="mt-3 flex gap-2">
                      <Button onClick={() => void confirm(card)} disabled={!!card.duplicateOf}>
                        {t('add.confirm')}
                      </Button>
                      <Button tone="ghost" onClick={() => update(card.id, { status: 'discarded' })}>
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

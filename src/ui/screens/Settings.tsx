import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { clearModelCache, deleteEverything, downloadBlob, exportBackup, importBackup, storageEstimate } from '../../app/backup'
import { updateSettings, type SettingsRecord } from '../../data/db'
import { LANGUAGE_STORAGE_KEY } from '../../i18n'
import { collectDiagnostics, type Diagnostics } from '../../platform/diagnostics'
import { openMeteo } from '../../weather/openMeteo'
import type { GeoResult } from '../../weather/provider'
import { Button, Card, Screen } from '../components'
import { formatDate, useEngineData, useLabel, useSettings } from '../hooks'
import { useAppStore } from '../store'

declare const __APP_VERSION__: string

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <input type="checkbox" role="switch" aria-checked={checked} checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />
    </label>
  )
}

const selectClass = 'min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-sm'

export function LocationPicker({ settings, compact = false }: { settings: SettingsRecord; compact?: boolean }) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoResult[]>([])
  const [locating, setLocating] = useState(false)
  const toast = useAppStore((s) => s.toast)

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      openMeteo.search(query.trim(), i18n.language, controller.signal).then(setResults).catch(() => setResults([]))
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, i18n.language])

  async function pick(r: GeoResult) {
    await updateSettings({ locationName: [r.name, r.admin1, r.country].filter(Boolean).join(', '), lat: r.lat, lon: r.lon })
    setQuery('')
    setResults([])
  }

  function gps() {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await updateSettings({ locationName: `${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)}`, lat: pos.coords.latitude, lon: pos.coords.longitude })
        setLocating(false)
      },
      () => {
        setLocating(false)
        toast(t('settings.noLocation'), 'error')
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    )
  }

  return (
    <div>
      {!compact && <p className="mb-2 text-sm">{settings.locationName || t('settings.noLocation')}</p>}
      <div className="flex gap-2">
        <input className={`${selectClass} flex-1`} placeholder={t('settings.locationSearch')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('settings.locationSearch')} />
        <Button tone="secondary" onClick={gps} disabled={locating}>
          {locating ? t('settings.locating') : t('settings.useGps')}
        </Button>
      </div>
      {results.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {results.map((r, i) => (
            <li key={i}>
              <button type="button" onClick={() => void pick(r)} className="min-h-11 w-full rounded-xl bg-[var(--bg)] px-3 text-left text-sm">
                {[r.name, r.admin1, r.country].filter(Boolean).join(', ')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {compact && settings.locationName && <p className="mt-2 text-sm font-semibold">{settings.locationName}</p>}
    </div>
  )
}

export function WeekdayDefaults({ settings }: { settings: SettingsRecord }) {
  const { t } = useTranslation()
  const data = useEngineData()
  const label = useLabel()
  if (!data) return null
  return (
    <div className="grid grid-cols-2 gap-2">
      {[1, 2, 3, 4, 5, 6, 0].map((d) => (
        <label key={d} className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          {t(`weekday.${d}`)}
          <select className={selectClass} value={settings.weekdayDefaults[String(d)] ?? 'casual'} onChange={(e) => void updateSettings({ weekdayDefaults: { ...settings.weekdayDefaults, [String(d)]: e.target.value } })}>
            {data.occasions.occasions.map((o) => (
              <option key={o.id} value={o.id}>
                {label.occasion(o.id)}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  )
}

export function Settings() {
  const { t, i18n } = useTranslation()
  const settings = useSettings()
  const label = useLabel()
  const data = useEngineData()
  const toast = useAppStore((s) => s.toast)
  const [storage, setStorage] = useState<{ usedMB: number; quotaMB: number } | null>(null)
  const [diag, setDiag] = useState<Diagnostics | null>(null)
  const [deleteText, setDeleteText] = useState('')
  const restoreRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void storageEstimate().then(setStorage)
    void collectDiagnostics().then(setDiag)
  }, [])

  if (!settings || !data) return <Screen title={t('settings.title')}><p className="text-sm text-[var(--muted)]">{t('common.loading')}</p></Screen>

  const yesNo = (v: boolean | null) => (v === null ? t('common.unknown') : v ? t('common.yes') : t('common.no'))
  const storagePct = storage && storage.quotaMB > 0 ? storage.usedMB / storage.quotaMB : 0
  const daysSinceBackup = settings.lastBackupAt ? (Date.now() - Date.parse(settings.lastBackupAt)) / 86400000 : Infinity
  const nudge = daysSinceBackup > 30 ? t('settings.backupNudgeDays') : settings.itemsSinceBackup >= 25 ? t('settings.backupNudgeItems') : null

  async function backup() {
    const { blob, filename } = await exportBackup()
    downloadBlob(blob, filename)
    toast(t('settings.backupNow'), 'success')
  }

  async function restore(file: File | undefined) {
    if (!file || !confirm(t('settings.restoreConfirm'))) return
    try {
      const r = await importBackup(file)
      toast(t('settings.restored', { items: r.items, days: r.days }), 'success')
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }

  async function changeLanguage(value: 'auto' | 'el' | 'en') {
    await updateSettings({ language: value })
    if (value === 'auto') {
      try {
        localStorage.removeItem(LANGUAGE_STORAGE_KEY)
      } catch {
        /* ignore */
      }
      void i18n.changeLanguage(navigator.language.toLowerCase().startsWith('el') ? 'el' : 'en')
    } else void i18n.changeLanguage(value)
  }

  return (
    <Screen title={t('settings.title')}>
      <div className="flex flex-col gap-4">
        <Card>
          <h2 className="mb-2 font-semibold">{t('settings.location')}</h2>
          <LocationPicker settings={settings} />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
              {t('settings.unit')}
              <select className={selectClass} value={settings.tempUnit} onChange={(e) => void updateSettings({ tempUnit: e.target.value as 'C' | 'F' })}>
                <option value="C">°C</option>
                <option value="F">°F</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
              {t('settings.runsHot')} ({settings.runsHotCold > 0 ? '+' : ''}
              {settings.runsHotCold} °C)
              <input type="range" min={-3} max={3} step={1} value={settings.runsHotCold} onChange={(e) => void updateSettings({ runsHotCold: Number(e.target.value) })} className="accent-[var(--accent)]" />
            </label>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">{t('settings.runsHotHint')}</p>
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">{t('settings.weekday')}</h2>
          <WeekdayDefaults settings={settings} />
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">{t('settings.cooldowns')}</h2>
          <p className="mb-2 text-xs text-[var(--muted)]">{t('settings.cooldownsHint')}</p>
          <div className="grid grid-cols-3 gap-2">
            {(['base', 'bottoms', 'shoes', 'outer', 'layer'] as const).map((role) => (
              <label key={role} className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                {t(`slots.${role}`)}
                <input type="number" min={0} max={7} className={selectClass} value={settings.cooldownDays[role] ?? 1} onChange={(e) => void updateSettings({ cooldownDays: { ...settings.cooldownDays, [role]: Number(e.target.value) } })} />
              </label>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">{t('settings.wash')}</h2>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(settings.washDefaults).map(([sub, n]) => (
              <label key={sub} className="flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
                {label.subcategory(sub)}
                <input type="number" min={1} max={20} className={`${selectClass} w-20`} value={n} onChange={(e) => void updateSettings({ washDefaults: { ...settings.washDefaults, [sub]: Number(e.target.value) } })} />
              </label>
            ))}
          </div>
        </Card>

        <Card>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
              {t('settings.language')}
              <select className={selectClass} value={settings.language} onChange={(e) => void changeLanguage(e.target.value as 'auto' | 'el' | 'en')}>
                <option value="auto">{t('settings.languageAuto')}</option>
                <option value="el">Ελληνικά</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
              {t('settings.theme')}
              <select className={selectClass} value={settings.theme} onChange={(e) => void updateSettings({ theme: e.target.value as SettingsRecord['theme'] })}>
                <option value="auto">{t('settings.themeAuto')}</option>
                <option value="light">{t('settings.themeLight')}</option>
                <option value="dark">{t('settings.themeDark')}</option>
              </select>
            </label>
          </div>
          <div className="mt-2 flex flex-col">
            <Toggle label={t('settings.bgRemoval')} checked={settings.bgRemoval} onChange={(v) => void updateSettings({ bgRemoval: v })} />
            <Toggle label={t('settings.sneakersAtWork')} checked={settings.sneakersAtWork} onChange={(v) => void updateSettings({ sneakersAtWork: v })} />
            <Toggle label={t('settings.suedeInRain')} checked={settings.allowSuedeInRain} onChange={(v) => void updateSettings({ allowSuedeInRain: v })} />
          </div>
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">{t('settings.storage')}</h2>
          {storage && <p className="text-sm">{t('settings.storageUsed', { used: storage.usedMB, quota: storage.quotaMB })}</p>}
          {storage && (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--line)]">
              <div className={`h-full ${storagePct > 0.8 ? 'bg-[#8c2f2f]' : 'bg-[var(--accent)]'}`} style={{ width: `${Math.min(100, storagePct * 100)}%` }} />
            </div>
          )}
          {storagePct > 0.8 && <p className="mt-2 text-xs text-[#8c2f2f]">{t('settings.storageWarning')}</p>}
          <p className="mt-2 text-sm">
            {t('settings.persisted')}: {yesNo(diag?.persisted ?? null)}
          </p>
          {diag && diag.persisted === false && <p className="text-xs text-[var(--muted)]">{t('settings.persistedNo')}</p>}
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">{t('settings.backup')}</h2>
          <p className="text-sm text-[var(--muted)]">{settings.lastBackupAt ? t('settings.lastBackup', { date: formatDate(settings.lastBackupAt.slice(0, 10), label.lang, { day: 'numeric', month: 'short', year: 'numeric' }) }) : t('settings.neverBackedUp')}</p>
          {nudge && <p className="mt-1 text-sm text-[#8c2f2f]">{t('settings.backupNudge', { reason: nudge })}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => void backup()}>{t('settings.backupNow')}</Button>
            <Button tone="secondary" onClick={() => restoreRef.current?.click()}>
              {t('settings.restore')}
            </Button>
            <input ref={restoreRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => void restore(e.target.files?.[0])} />
          </div>
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">{t('settings.models')}</h2>
          <p className="text-sm text-[var(--muted)]">{t('settings.modelsBody', { classifier: 'Marqo fashionSigLIP', bg: 'RMBG-1.4' })}</p>
          <Button tone="secondary" className="mt-3" onClick={() => void clearModelCache().then((n) => toast(`${n} caches`, 'success'))}>
            {t('settings.clearModels')}
          </Button>
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">{t('settings.privacy.title')}</h2>
          <p className="text-sm text-[var(--muted)]">{t('settings.privacy.body')}</p>
          <p className="mt-2 text-xs text-[var(--muted)]">{t('settings.attribution')}</p>
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">{t('settings.diagnostics')}</h2>
          {diag && (
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
              <dt>{t('diag.standalone')}</dt>
              <dd>{yesNo(diag.standalone)}</dd>
              <dt>{t('diag.webgpu')}</dt>
              <dd>{yesNo(diag.webgpu)}</dd>
              <dt>{t('diag.wasmThreads')}</dt>
              <dd>{yesNo(diag.wasmThreads)}</dd>
              <dt>{t('diag.quota')}</dt>
              <dd>{diag.quotaMB != null ? `${diag.quotaMB} MB` : t('common.unknown')}</dd>
            </dl>
          )}
          {diag && !diag.standalone && <p className="mt-2 text-xs text-[var(--muted)]">{t('diag.installHint')}</p>}
          <p className="mt-2 text-xs text-[var(--muted)]">{t('settings.version', { version: __APP_VERSION__ })}</p>
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold text-[#8c2f2f]">{t('settings.deleteAll')}</h2>
          <p className="text-xs text-[var(--muted)]">{t('settings.deleteAllHint')}</p>
          <div className="mt-2 flex gap-2">
            <input className={`${selectClass} flex-1`} value={deleteText} onChange={(e) => setDeleteText(e.target.value)} aria-label="DELETE" />
            <Button
              tone="danger"
              disabled={deleteText !== 'DELETE'}
              onClick={() => {
                void deleteEverything().then(() => {
                  toast(t('settings.deleted'), 'success')
                  location.hash = '#/onboarding'
                  location.reload()
                })
              }}
            >
              {t('common.delete')}
            </Button>
          </div>
        </Card>
      </div>
    </Screen>
  )
}

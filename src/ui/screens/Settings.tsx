import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteEverything, downloadBlob, exportBackup, importBackup } from '../../app/backup'
import { updateSettings, type SettingsRecord } from '../../data/db'
import { LANGUAGE_STORAGE_KEY } from '../../i18n'
import { collectDiagnostics, type Diagnostics } from '../../platform/diagnostics'
import { openMeteo } from '../../weather/openMeteo'
import type { GeoResult } from '../../weather/provider'
import { Button, Card, Screen } from '../components'
import { formatDate, useLabel, useSettings } from '../hooks'
import { useAppStore } from '../store'

declare const __APP_VERSION__: string

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

/** Settings: location, language, backup, how outfits are chosen, delete everything. The rules themselves are not knobs. */
export function Settings() {
  const { t, i18n } = useTranslation()
  const settings = useSettings()
  const label = useLabel()
  const toast = useAppStore((s) => s.toast)
  const [diag, setDiag] = useState<Diagnostics | null>(null)
  const [deleteText, setDeleteText] = useState('')
  const restoreRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void collectDiagnostics().then(setDiag)
  }, [])

  if (!settings) {
    return (
      <Screen title={t('settings.title')}>
        <p className="text-sm text-[var(--muted)]">{t('common.loading')}</p>
      </Screen>
    )
  }

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
        </Card>

        <Card>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            {t('settings.language')}
            <select className={selectClass} value={settings.language} onChange={(e) => void changeLanguage(e.target.value as 'auto' | 'el' | 'en')}>
              <option value="auto">{t('settings.languageAuto')}</option>
              <option value="el">Ελληνικά</option>
              <option value="en">English</option>
            </select>
          </label>
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
          <h2 className="mb-2 font-semibold">{t('settings.rules')}</h2>
          <p className="text-sm text-[var(--muted)]">{t('settings.rulesBody')}</p>
          <p className="mt-2 text-xs text-[var(--muted)]">{t('settings.attribution')}</p>
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">{t('settings.privacy.title')}</h2>
          <p className="text-sm text-[var(--muted)]">{t('settings.privacy.body')}</p>
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

        <p className="text-xs text-[var(--muted)]">
          {t('settings.version', { version: __APP_VERSION__ })}
          {diag && ` · ${t('settings.phone', { backend: diag.webgpu ? t('diag.webgpu') : t('diag.wasm'), installed: diag.standalone ? t('diag.installed') : t('diag.notInstalled') })}`}
          {diag && !diag.standalone && <span className="block">{t('diag.installHint')}</span>}
        </p>
      </div>
    </Screen>
  )
}

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { getSettings } from './data/db'
import { BottomNav, Toasts } from './ui/components'
import { useEngineData, useSettings } from './ui/hooks'
import { navigate, useRoute } from './ui/router'
import { AddItems } from './ui/screens/AddItems'
import { History } from './ui/screens/History'
import { ItemDetail } from './ui/screens/ItemDetail'
import { Onboarding } from './ui/screens/Onboarding'
import { Settings } from './ui/screens/Settings'
import { Today } from './ui/screens/Today'
import { Wardrobe } from './ui/screens/Wardrobe'
import { useAppStore } from './ui/store'

/** A new build is waiting: offered, never forced (a forced reload once lost a photo batch). */
function UpdateBanner() {
  const { t } = useTranslation()
  const addBusy = useAppStore((s) => s.addBusy)
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })
  if (!needRefresh || addBusy) return null
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-3 bg-[var(--fg)] px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-sm text-[var(--bg)]" role="status">
      <span>{t('app.updateReady')}</span>
      <span className="flex items-center gap-1">
        <button type="button" className="min-h-9 rounded-full bg-[var(--bg)] px-3 font-semibold text-[var(--fg)]" onClick={() => void updateServiceWorker(true)}>
          {t('app.updateNow')}
        </button>
        <button type="button" className="min-h-9 min-w-9 text-lg" aria-label={t('common.close')} onClick={() => setNeedRefresh(false)}>
          ×
        </button>
      </span>
    </div>
  )
}

export default function App() {
  const route = useRoute()
  const settings = useSettings()
  const data = useEngineData()
  const { i18n } = useTranslation()

  useEffect(() => {
    void getSettings()
  }, [])

  useEffect(() => {
    if (!settings) return
    document.documentElement.dataset.theme = settings.theme === 'auto' ? '' : settings.theme
    if (settings.language !== 'auto' && !i18n.language.startsWith(settings.language)) void i18n.changeLanguage(settings.language)
  }, [settings, i18n])

  useEffect(() => {
    if (settings && !settings.onboarded && route.name !== 'onboarding') navigate({ name: 'onboarding' })
  }, [settings, route.name])

  if (!settings || !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <span className="text-sm text-[var(--muted)]">…</span>
      </div>
    )
  }

  let screen: React.ReactNode
  switch (route.name) {
    case 'onboarding':
      screen = <Onboarding />
      break
    case 'wardrobe':
      screen = <Wardrobe />
      break
    case 'add':
      screen = <AddItems />
      break
    case 'item':
      screen = <ItemDetail id={route.id} />
      break
    case 'history':
      screen = <History />
      break
    case 'settings':
      screen = <Settings />
      break
    default:
      screen = <Today />
  }

  return (
    <>
      <UpdateBanner />
      {screen}
      {route.name !== 'onboarding' && <BottomNav current={route.name} />}
      <Toasts />
    </>
  )
}

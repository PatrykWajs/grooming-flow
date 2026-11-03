import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
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
      {screen}
      {route.name !== 'onboarding' && <BottomNav current={route.name} />}
      <Toasts />
    </>
  )
}

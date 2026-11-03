import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { updateSettings } from '../../data/db'
import { Button, Card } from '../components'
import { useSettings } from '../hooks'
import { navigate } from '../router'
import { LocationPicker } from './Settings'

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** Three screens: install, where you are (for the forecast), add your first clothes. */
export function Onboarding() {
  const { t } = useTranslation()
  const settings = useSettings()
  const [step, setStep] = useState(() => (isStandalone() ? 1 : 0))

  if (!settings) return null

  async function finish() {
    await updateSettings({ onboarded: true })
    navigate({ name: 'add' })
  }

  const steps = [
    {
      title: t('onboarding.install.title'),
      body: t('onboarding.install.body'),
      content: null,
      next: t('onboarding.install.later'),
    },
    {
      title: t('onboarding.step1.title'),
      body: t('onboarding.step1.body'),
      content: <LocationPicker settings={settings} compact />,
      next: t('common.next'),
    },
    {
      title: t('onboarding.step2.title'),
      body: t('onboarding.step2.body'),
      content: null,
      next: t('onboarding.start'),
    },
  ]
  const current = steps[step]

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 pb-8 pt-[max(2rem,env(safe-area-inset-top))]">
      <p className="mb-6 text-sm text-[var(--muted)]">{t('app.name')}</p>
      <h1 className="text-3xl font-semibold">{current.title}</h1>
      <p className="mt-3 text-base text-[var(--muted)]">{current.body}</p>
      {current.content && <Card className="mt-6">{current.content}</Card>}
      <div className="mt-auto flex items-center justify-between pt-8">
        <span className="text-xs text-[var(--muted)]">
          {step + 1} / {steps.length}
        </span>
        <div className="flex gap-2">
          {step > 0 && (
            <Button tone="ghost" onClick={() => setStep(step - 1)}>
              {t('common.back')}
            </Button>
          )}
          <Button onClick={() => (step === steps.length - 1 ? void finish() : setStep(step + 1))}>{current.next}</Button>
        </div>
      </div>
    </div>
  )
}

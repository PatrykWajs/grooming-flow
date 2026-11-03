import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { collectDiagnostics, type Diagnostics } from './platform/diagnostics'

const TABS = ['today', 'wardrobe', 'history', 'settings'] as const

export default function App() {
  const { t, i18n } = useTranslation()
  const [diag, setDiag] = useState<Diagnostics | null>(null)

  useEffect(() => {
    void collectDiagnostics().then(setDiag)
  }, [])

  const isGreek = i18n.language.startsWith('el')
  const yesNo = (value: boolean | null) =>
    value === null ? t('common.unknown') : value ? t('common.yes') : t('common.no')

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-xl items-center justify-between px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl font-semibold">{t('app.name')}</h1>
        <button
          type="button"
          className="min-h-11 min-w-11 text-sm underline"
          aria-label={t('settings.language')}
          onClick={() => void i18n.changeLanguage(isGreek ? 'en' : 'el')}
        >
          {isGreek ? 'EN' : 'ΕΛ'}
        </button>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-24">
        <p className="text-[var(--muted)]">{t('app.tagline')}</p>

        <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
          <h2 className="text-lg font-semibold">{t('m0.title')}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t('m0.lead')}</p>
          {diag && (
            <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
              <dt>{t('m0.standalone')}</dt>
              <dd className="font-semibold">{yesNo(diag.standalone)}</dd>
              <dt>{t('m0.webgpu')}</dt>
              <dd className="font-semibold">{yesNo(diag.webgpu)}</dd>
              <dt>{t('m0.wasmThreads')}</dt>
              <dd className="font-semibold">{yesNo(diag.wasmThreads)}</dd>
              <dt>{t('m0.persisted')}</dt>
              <dd className="font-semibold">{yesNo(diag.persisted)}</dd>
              <dt>{t('m0.quota')}</dt>
              <dd className="font-semibold">
                {diag.quotaMB != null ? `${diag.quotaMB} MB` : t('common.unknown')}
              </dd>
              <dt>{t('m0.usage')}</dt>
              <dd className="font-semibold">
                {diag.usageMB != null ? `${diag.usageMB} MB` : t('common.unknown')}
              </dd>
              <dt>{t('m0.language')}</dt>
              <dd className="font-semibold">{diag.language}</dd>
            </dl>
          )}
          {diag && !diag.standalone && <p className="mt-4 text-sm">{t('m0.installHint')}</p>}
          {diag && (
            <p className="mt-3 break-all text-xs text-[var(--muted)]">{diag.userAgent}</p>
          )}
        </section>
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 border-t border-[var(--line)] bg-[var(--bg)] pb-[env(safe-area-inset-bottom)]"
        aria-label={t('nav.today')}
      >
        <ul className="mx-auto grid max-w-xl grid-cols-4">
          {TABS.map((tab) => (
            <li key={tab}>
              <a
                href={`#/${tab}`}
                className="flex min-h-14 flex-col items-center justify-center text-xs"
              >
                {t(`nav.${tab}`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ItemRecord } from '../data/db'
import { useBlobUrl, useLabel } from './hooks'
import { navigate, type Route } from './router'
import { useAppStore } from './store'

export function Button({
  tone = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const tones = {
    primary: 'bg-[var(--accent)] text-[var(--accent-fg)] font-semibold',
    secondary: 'border border-[var(--line)] bg-[var(--card)] text-[var(--fg)]',
    ghost: 'text-[var(--fg)] underline-offset-4 hover:underline',
    danger: 'bg-[#8c2f2f] text-white font-semibold',
  }
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm transition-[transform,opacity] duration-150 active:scale-[0.98] disabled:opacity-40 ${tones[tone]} ${className}`}
    />
  )
}

export function Chip({ active, children, onClick, ariaLabel }: { active?: boolean; children: ReactNode; onClick?: () => void; ariaLabel?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`min-h-11 rounded-full border px-4 text-sm ${active ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]' : 'border-[var(--line)] bg-[var(--card)]'}`}
    >
      {children}
    </button>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 ${className}`}>{children}</section>
}

/** `fill` takes the width of its cell (square); the fixed sizes are for rows and lists. */
export function ItemThumb({ item, size = 'md', onClick, badge }: { item: ItemRecord; size?: 'sm' | 'md' | 'lg' | 'fill'; onClick?: () => void; badge?: ReactNode }) {
  const url = useBlobUrl(item.thumbBlobId ?? item.photoBlobId)
  const label = useLabel()
  const sizes = { sm: 'h-16 w-16', md: 'h-24 w-24', lg: 'h-36 w-36', fill: 'aspect-square w-full' }
  const content = (
    <span className={`relative block ${sizes[size]} overflow-hidden rounded-xl bg-[var(--bg)]`}>
      {url ? (
        <img src={url} alt={label.itemName(item)} className="h-full w-full object-contain" loading="lazy" decoding="async" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-xs text-[var(--muted)]">{label.subcategory(item.subcategory)}</span>
      )}
      {badge && <span className="absolute left-1 top-1">{badge}</span>}
    </span>
  )
  if (!onClick) return content
  return (
    <button type="button" onClick={onClick} aria-label={label.itemName(item)} className={`rounded-xl focus:outline-2 focus:outline-[var(--accent)] ${size === 'fill' ? 'block w-full' : ''}`}>
      {content}
    </button>
  )
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className="m-0 mt-auto w-full max-w-xl self-end justify-self-center rounded-t-3xl border-0 bg-[var(--card)] p-0 text-[var(--fg)] backdrop:bg-black/40 open:flex open:flex-col"
      style={{ maxHeight: '85dvh' }}
    >
      <div className="flex items-center justify-between px-5 pt-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 text-xl">
          ×
        </button>
      </div>
      <div className="overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2">{children}</div>
    </dialog>
  )
}

export function Toasts() {
  const toasts = useAppStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-full px-4 py-2 text-sm shadow ${t.tone === 'error' ? 'bg-[#8c2f2f] text-white' : t.tone === 'success' ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'bg-[var(--fg)] text-[var(--bg)]'}`}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}

export function BottomNav({ current }: { current: Route['name'] }) {
  const { t } = useTranslation()
  const tabs: { name: Route['name']; label: string; icon: string }[] = [
    { name: 'today', label: t('nav.today'), icon: '☀' },
    { name: 'wardrobe', label: t('nav.wardrobe'), icon: '▦' },
    { name: 'history', label: t('nav.history'), icon: '▤' },
    { name: 'settings', label: t('nav.settings'), icon: '⚙' },
  ]
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[var(--bg)] pb-[env(safe-area-inset-bottom)]" aria-label={t('nav.main')}>
      <ul className="mx-auto grid max-w-xl grid-cols-4">
        {tabs.map((tab) => {
          const active = current === tab.name || (tab.name === 'wardrobe' && (current === 'add' || current === 'item'))
          return (
            <li key={tab.name}>
              <button
                type="button"
                onClick={() => navigate({ name: tab.name } as Route)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-xs ${active ? 'font-semibold text-[var(--accent)]' : 'text-[var(--muted)]'}`}
              >
                <span aria-hidden="true" className="text-base leading-none">
                  {tab.icon}
                </span>
                {tab.label}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export function Screen({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-28 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {action}
      </header>
      {children}
    </div>
  )
}

export function Empty({ title, body, cta, onCta }: { title: string; body: string; cta?: string; onCta?: () => void }) {
  return (
    <Card className="text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">{body}</p>
      {cta && onCta && (
        <Button className="mt-4" onClick={onCta}>
          {cta}
        </Button>
      )}
    </Card>
  )
}
